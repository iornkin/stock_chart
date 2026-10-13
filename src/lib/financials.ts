/**
 * SEC XBRL companyfacts → 분기/연간 재무 시계열 변환
 * - 10-Q 손익 항목은 분기(약 90일) 값을 그대로 사용
 * - 현금흐름처럼 누적(YTD)으로만 보고되는 항목은 같은 회계연도 시작일의 누적값 차이로 분기 값을 계산
 *   (계산값은 derived=true 로 표시)
 * - 4분기(Q4) 값은 연간(10-K) − 3분기 누적으로 계산
 */
import type { CompanyFacts, SecFact } from "./providers/sec";

export type MetricKey =
  | "revenue"
  | "operatingIncome"
  | "netIncome"
  | "epsDiluted"
  | "operatingCashFlow"
  | "capex"
  | "equity"
  | "dividendsPerShare";

export const METRIC_CONCEPTS: Record<MetricKey, { concepts: string[]; unit: string; instant?: boolean; perShare?: boolean }> = {
  revenue: {
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    unit: "USD",
  },
  operatingIncome: { concepts: ["OperatingIncomeLoss"], unit: "USD" },
  netIncome: { concepts: ["NetIncomeLoss"], unit: "USD" },
  epsDiluted: { concepts: ["EarningsPerShareDiluted"], unit: "USD/shares", perShare: true },
  operatingCashFlow: { concepts: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD" },
  capex: { concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], unit: "USD" },
  equity: {
    concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    unit: "USD",
    instant: true,
  },
  dividendsPerShare: { concepts: ["CommonStockDividendsPerShareDeclared"], unit: "USD/shares", perShare: true },
};

export interface PeriodValue {
  start: string | null;
  end: string;
  value: number;
  fy: number | null;
  fp: string | null;
  form: string | null;
  derived: boolean;
  concept: string;
}

export interface FinancialSeries {
  quarterly: PeriodValue[];
  annual: PeriodValue[];
}

export type Financials = Partial<Record<MetricKey, FinancialSeries>> & {
  entityName: string;
  cik: number;
  extractedAt: number;
};

function days(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
}

/** 같은 기간(start,end)의 중복 보고 중 가장 최근 제출값을 사용 */
function dedupe(facts: SecFact[]): SecFact[] {
  const map = new Map<string, SecFact>();
  for (const f of facts) {
    if (!f.form || !/^10-[KQ]/.test(f.form)) continue;
    const k = `${f.start ?? ""}|${f.end}`;
    const prev = map.get(k);
    if (!prev || (f.filed ?? "") > (prev.filed ?? "")) map.set(k, f);
  }
  return [...map.values()];
}

function pickConcept(facts: CompanyFacts, key: MetricKey): { concept: string; rows: SecFact[] } | null {
  const spec = METRIC_CONCEPTS[key];
  const gaap = facts.facts?.["us-gaap"] ?? {};
  let best: { concept: string; rows: SecFact[]; latest: string } | null = null;
  for (const c of spec.concepts) {
    const rows = gaap[c]?.units?.[spec.unit];
    if (!rows?.length) continue;
    const latest = rows.reduce((m, r) => (r.end > m ? r.end : m), "");
    if (!best || latest > best.latest) best = { concept: c, rows, latest };
  }
  return best ? { concept: best.concept, rows: best.rows } : null;
}

function buildDuration(rows: SecFact[], concept: string, allowDerive: boolean): FinancialSeries {
  const facts = dedupe(rows).filter((f) => f.start);
  const quarterly = new Map<string, PeriodValue>();
  const annual = new Map<string, PeriodValue>();
  const toPV = (f: SecFact, derived = false): PeriodValue => ({
    start: f.start ?? null,
    end: f.end,
    value: f.val,
    fy: f.fy ?? null,
    fp: f.fp ?? null,
    form: f.form ?? null,
    derived,
    concept,
  });
  for (const f of facts) {
    const d = days(f.start as string, f.end);
    if (d >= 80 && d <= 100) quarterly.set(f.end, toPV(f));
    else if (d >= 350 && d <= 380 && f.form?.startsWith("10-K")) annual.set(f.end, toPV(f));
  }
  if (allowDerive) {
    // 같은 시작일을 가진 누적값들의 차이로 분기 값 계산
    const byStart = new Map<string, SecFact[]>();
    for (const f of facts) {
      const d = days(f.start as string, f.end);
      if (d < 80 || d > 380) continue;
      const list = byStart.get(f.start as string) ?? [];
      list.push(f);
      byStart.set(f.start as string, list);
    }
    for (const list of byStart.values()) {
      list.sort((a, b) => a.end.localeCompare(b.end));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        const gap = days(prev.end, cur.end);
        if (gap < 80 || gap > 100) continue;
        if (quarterly.has(cur.end)) continue;
        quarterly.set(cur.end, {
          start: prev.end,
          end: cur.end,
          value: cur.val - prev.val,
          fy: cur.fy ?? null,
          fp: cur.form?.startsWith("10-K") ? "Q4" : (cur.fp ?? null),
          form: cur.form ?? null,
          derived: true,
          concept,
        });
      }
    }
    // 분기 값이 개별 보고된 항목: 4분기 = 연간 − (1~3분기 합)
    for (const a of annual.values()) {
      if (quarterly.has(a.end) || !a.start) continue;
      const inside = [...quarterly.values()].filter((q) => q.start && q.start >= (a.start as string) && q.end < a.end);
      if (inside.length !== 3) continue;
      quarterly.set(a.end, {
        start: inside.map((q) => q.end).sort()[2],
        end: a.end,
        value: a.value - inside.reduce((s, q) => s + q.value, 0),
        fy: a.fy,
        fp: "Q4",
        form: a.form,
        derived: true,
        concept,
      });
    }
  }
  return {
    quarterly: [...quarterly.values()].sort((a, b) => a.end.localeCompare(b.end)),
    annual: [...annual.values()].sort((a, b) => a.end.localeCompare(b.end)),
  };
}

function buildInstant(rows: SecFact[], concept: string): FinancialSeries {
  const map = new Map<string, PeriodValue>();
  for (const f of dedupe(rows)) {
    if (f.start) continue;
    map.set(f.end, { start: null, end: f.end, value: f.val, fy: f.fy ?? null, fp: f.fp ?? null, form: f.form ?? null, derived: false, concept });
  }
  const all = [...map.values()].sort((a, b) => a.end.localeCompare(b.end));
  return { quarterly: all, annual: all.filter((v) => v.form?.startsWith("10-K")) };
}

export function extractFinancials(facts: CompanyFacts): Financials {
  const out: Financials = { entityName: facts.entityName, cik: facts.cik, extractedAt: Date.now() };
  for (const key of Object.keys(METRIC_CONCEPTS) as MetricKey[]) {
    const spec = METRIC_CONCEPTS[key];
    const picked = pickConcept(facts, key);
    if (!picked) continue;
    const series = spec.instant
      ? buildInstant(picked.rows, picked.concept)
      : buildDuration(picked.rows, picked.concept, !spec.perShare);
    // 저장 용량을 줄이기 위해 최근 12개 분기·6개 연도만 보관
    out[key] = { quarterly: series.quarterly.slice(-12), annual: series.annual.slice(-6) };
  }
  return out;
}

/** 최근 4개 분기 합 (연속성 확인) */
export function ttm(series: FinancialSeries | undefined): { value: number; end: string; derivedParts: number } | null {
  if (!series) return null;
  const q = series.quarterly.slice(-4);
  if (q.length < 4) return null;
  // 연속된 4개 분기인지 확인 (약 1년 범위)
  if (days(q[0].end, q[3].end) > 300 || days(q[0].end, q[3].end) < 250) return null;
  return { value: q.reduce((a, v) => a + v.value, 0), end: q[3].end, derivedParts: q.filter((v) => v.derived).length };
}

/** 1년 전 같은 분기 대비 성장률 */
export function yoyGrowth(series: FinancialSeries | undefined, which: "quarterly" | "annual" = "quarterly"): number | null {
  if (!series) return null;
  const list = series[which];
  const lastV = list[list.length - 1];
  if (!lastV) return null;
  const target = Date.parse(lastV.end) - 365 * 86400000;
  const prior = list.find((v) => Math.abs(Date.parse(v.end) - target) < 20 * 86400000);
  // 비교 기간 값이 0 이하이면 성장률이 의미 없으므로 계산하지 않는다
  if (!prior || prior.value <= 0) return null;
  return (lastV.value / prior.value - 1) * 100;
}
