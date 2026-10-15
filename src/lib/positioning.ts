/**
 * 포지션·심리 계산 (순수 함수 — 서버·브라우저·테스트 공용)
 *
 * 서로 다른 자료를 섞지 않는다:
 * - 투자심리 설문(AAII): 전망 설문. 실제 포지션이 아니다.
 * - 공매도 잔고(FINRA): 결제일 기준 보유 중인 숏 포지션 수량. 월 2회.
 * - 일일 공매도 거래량(FINRA Reg SHO): 그날 장외 보고분 거래 중 공매도 비중. 잔고가 아니다.
 * - 옵션 통계: 풋·콜 거래량과 미결제약정. 헤지·스프레드가 섞여 방향성 포지션을 알 수 없다.
 * - 기관 13F: 분기 말 롱 보유 스냅샷. 지금도 같은 수량을 보유한다는 뜻이 아니다.
 * 계산할 수 없으면(분모 0·자료 없음) null 을 돌려준다. 다른 지표 값으로 대신 채우지 않는다.
 */

const DAY = 86400_000;

/** 분모가 0 이하이거나 숫자가 아니면 null */
export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (typeof num !== "number" || typeof den !== "number" || !Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num < 0) return null;
  return num / den;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** ISO 날짜(YYYY-MM-DD)부터 지금까지 지난 일수 */
export function ageDays(iso: string | null | undefined, now: number): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return Math.floor((now - Date.parse(`${iso}T00:00:00Z`)) / DAY);
}

export function isStale(iso: string | null | undefined, now: number, maxDays: number): boolean {
  const a = ageDays(iso, now);
  return a === null || a > maxDays;
}

/** 과거 값들 중 지금 값보다 작거나 같은 비율 (%) — 표본 20개 미만이면 null */
export function percentileOf(value: number | null, history: number[]): number | null {
  if (value === null || history.length < 20) return null;
  return (history.filter((x) => x <= value).length / history.length) * 100;
}

// ───────────────────────────── 투자심리 설문 ─────────────────────────────

export interface SentimentRow {
  week: string;
  bullish: number;
  neutral: number;
  bearish: number;
}

/** 각 값 0~100, 합계 100 ± 0.5 (소수 한 자리 반올림 오차 허용) */
export function sentimentValid(r: SentimentRow): { ok: boolean; reason?: string } {
  const v = [r.bullish, r.neutral, r.bearish];
  if (v.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 100)) return { ok: false, reason: "비율이 0~100 범위 밖이거나 숫자가 아님" };
  const sum = v[0] + v[1] + v[2];
  if (Math.abs(sum - 100) > 0.5) return { ok: false, reason: `세 비율 합계 ${sum.toFixed(1)}% (100% 가 아님)` };
  return { ok: true };
}

export interface SentimentSummary {
  latest: (SentimentRow & { spread: number }) | null;
  previous: (SentimentRow & { spread: number }) | null;
  /** 장기 평균(출처 공표) 대비 차이 (%p) */
  vsAverage: { bullish: number; neutral: number; bearish: number } | null;
  /** 최근 8주 강세−약세 평균 (유효한 주 8개 이상일 때) */
  spreadAvg8: number | null;
  /** 이 사이트가 모은 최근 52주 중 최고·최저 */
  range52: { bullHigh: { value: number; week: string }; bearHigh: { value: number; week: string }; weeks: number } | null;
  invalid: { week: string; reason: string }[];
  valid: (SentimentRow & { spread: number })[];
}

export function sentimentSummary(rows: SentimentRow[], averages: { bullish: number; neutral: number; bearish: number } | null): SentimentSummary {
  const invalid: { week: string; reason: string }[] = [];
  const valid: (SentimentRow & { spread: number })[] = [];
  for (const r of [...rows].sort((a, b) => (a.week < b.week ? -1 : 1))) {
    const c = sentimentValid(r);
    if (!c.ok) invalid.push({ week: r.week, reason: c.reason! });
    else valid.push({ ...r, spread: r.bullish - r.bearish });
  }
  const latest = valid.at(-1) ?? null;
  const previous = valid.at(-2) ?? null;
  const last8 = valid.slice(-8);
  const cutoff = latest ? new Date(Date.parse(`${latest.week}T00:00:00Z`) - 364 * DAY).toISOString().slice(0, 10) : "";
  const yr = valid.filter((r) => r.week > cutoff);
  const top = (k: "bullish" | "bearish") => yr.reduce((a, b) => (b[k] > a[k] ? b : a));
  return {
    latest,
    previous,
    vsAverage: latest && averages ? { bullish: latest.bullish - averages.bullish, neutral: latest.neutral - averages.neutral, bearish: latest.bearish - averages.bearish } : null,
    spreadAvg8: last8.length >= 8 ? mean(last8.map((r) => r.spread)) : null,
    range52: yr.length ? { bullHigh: { value: top("bullish").bullish, week: top("bullish").week }, bearHigh: { value: top("bearish").bearish, week: top("bearish").week }, weeks: yr.length } : null,
    invalid,
    valid,
  };
}

// ───────────────────────────── 공매도 잔고 ─────────────────────────────

export interface ShortInterestPoint {
  date: string;
  shortQty: number;
  prevQty: number | null;
  avgDailyVolume: number | null;
  revised: boolean;
  split: boolean;
}

export interface ShortInterestSummary {
  latest: ShortInterestPoint | null;
  /** 직전 보고 기간 수량 (모은 기록 → 없으면 FINRA 가 함께 준 직전 값) */
  previousQty: number | null;
  change: number | null;
  changePct: number | null;
  /** 이번 주기에 분할이 있어 직전 대비 비교가 맞지 않음 */
  splitNote: boolean;
  /** 공매도 잔고 ÷ 평균 일일 거래량 */
  daysToCover: number | null;
  /** 공매도 잔고 ÷ 유통주식 수 × 100 (유통주식 수가 없으면 null) */
  pctFloat: number | null;
  ageDays: number | null;
  history: ShortInterestPoint[];
}

export function shortInterestSummary(points: ShortInterestPoint[], floatShares: number | null, now: number): ShortInterestSummary {
  const h = points.filter((p) => Number.isFinite(p.shortQty) && p.shortQty >= 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = h.at(-1) ?? null;
  const prior = h.at(-2) ?? null;
  const previousQty = prior ? prior.shortQty : (latest?.prevQty ?? null);
  const splitNote = Boolean(latest?.split);
  const change = latest && previousQty !== null && !splitNote ? latest.shortQty - previousQty : null;
  return {
    latest,
    previousQty,
    change,
    changePct: change !== null && previousQty ? (change / previousQty) * 100 : null,
    splitNote,
    daysToCover: latest ? ratio(latest.shortQty, latest.avgDailyVolume) : null,
    pctFloat: latest && ratio(latest.shortQty, floatShares) !== null ? ratio(latest.shortQty, floatShares)! * 100 : null,
    ageDays: ageDays(latest?.date, now),
    history: h,
  };
}

// ───────────────────────────── 일일 공매도 거래량 ─────────────────────────────

export interface ShortVolumePoint {
  date: string;
  shortVolume: number;
  totalVolume: number;
}

export function shortVolumeSummary(points: ShortVolumePoint[]) {
  const h = [...points].sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => ({ ...p, ratioPct: ratio(p.shortVolume, p.totalVolume) !== null ? ratio(p.shortVolume, p.totalVolume)! * 100 : null }));
  const ok = h.filter((p) => p.ratioPct !== null);
  const latest = h.at(-1) ?? null;
  const last20 = ok.slice(-20).map((p) => p.ratioPct!);
  return { latest, avg20: last20.length >= 5 ? mean(last20) : null, samples: last20.length, history: h };
}

// ───────────────────────────── 옵션 ─────────────────────────────

export interface OptionPoint {
  date: string;
  callVolume: number | null;
  putVolume: number | null;
  callOI: number | null;
  putOI: number | null;
}

export interface PutCallSummary {
  latest: (OptionPoint & { volumeRatio: number | null; oiRatio: number | null }) | null;
  /** 최근 20개 거래량 기준 비율 평균 */
  volumeAvg20: number | null;
  /** 모은 기록 중 지금 거래량 비율보다 낮거나 같은 날의 비율 (%) */
  volumePercentile: number | null;
  history: (OptionPoint & { volumeRatio: number | null; oiRatio: number | null })[];
}

/** 풋/콜 비율: 거래량 기준(풋 거래량 ÷ 콜 거래량)과 미결제약정 기준을 따로 계산한다 */
export function putCallSummary(points: OptionPoint[]): PutCallSummary {
  const h = [...points].sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => ({ ...p, volumeRatio: ratio(p.putVolume, p.callVolume), oiRatio: ratio(p.putOI, p.callOI) }));
  const vols = h.map((p) => p.volumeRatio).filter((x): x is number => x !== null);
  const latest = h.at(-1) ?? null;
  const last20 = vols.slice(-20);
  return { latest, volumeAvg20: last20.length >= 5 ? mean(last20) : null, volumePercentile: percentileOf(latest?.volumeRatio ?? null, vols), history: h };
}

/** Cboe 공표 비율(소수 둘째 자리)과 거래량으로 직접 계산한 비율이 반올림 범위 안에서 같은지 */
export function publishedRatioConsistent(computed: number | null, published: number | null): boolean | null {
  if (computed === null || published === null) return null;
  return Math.abs(computed - published) <= 0.0051;
}

// ───────────────────────────── 기관 13F ─────────────────────────────

export interface FilingRef {
  accession: string;
  form: string;
  period: string;
  filed: string;
  /** 정정 공시 종류: RESTATEMENT(전체 대체) / NEW HOLDINGS(추가) / null(원 공시) */
  amendmentType: string | null;
}

export interface HoldingRow {
  accession: string;
  cusip: string;
  putCall: string;
  shares: number;
  value: number;
}

/**
 * 한 기관·한 보고 기간의 최종 보유: 원 공시(또는 가장 최근 '전체 대체' 정정)를 기준으로,
 * 그 뒤에 낸 '추가 보고' 정정의 행을 더한다. 종류를 알 수 없는 정정은 반영하지 않고 표시만 한다.
 */
export function composePeriod(filings: FilingRef[], rows: HoldingRow[]): { base: FilingRef | null; used: FilingRef[]; others: FilingRef[]; holdings: Map<string, { shares: number; value: number }> } {
  const sorted = [...filings].sort((a, b) => (a.filed === b.filed ? (a.accession < b.accession ? -1 : 1) : a.filed < b.filed ? -1 : 1));
  const isBase = (f: FilingRef) => f.form === "13F-HR" || f.amendmentType === "RESTATEMENT";
  const base = [...sorted].reverse().find(isBase) ?? null;
  const used: FilingRef[] = base ? [base, ...sorted.filter((f) => f !== base && f.filed >= base.filed && f.amendmentType === "NEW HOLDINGS")] : [];
  // 반영하지 않은 것: 나중 정정으로 대체된 공시, 종류를 알 수 없는 정정
  const others = sorted.filter((f) => !used.includes(f));
  const holdings = new Map<string, { shares: number; value: number }>();
  const accs = new Set(used.map((f) => f.accession));
  for (const r of rows) {
    if (!accs.has(r.accession)) continue;
    const k = `${r.cusip}|${r.putCall}`;
    const e = holdings.get(k) ?? { shares: 0, value: 0 };
    e.shares += r.shares;
    e.value += r.value;
    holdings.set(k, e);
  }
  return { base, used, others, holdings };
}

/** 정정 공시를 어떻게 반영했는지 사람이 읽을 문장으로 */
export function describeAmendments(c: { base: FilingRef | null; used: FilingRef[]; others: FilingRef[] }): string[] {
  const out: string[] = [];
  if (c.base && c.base.form !== "13F-HR") out.push(`전체 대체 정정(제출 ${c.base.filed})을 기준으로 씀`);
  for (const f of c.used) if (f !== c.base) out.push(`추가 보고 정정(제출 ${f.filed}) 반영`);
  for (const f of c.others) {
    const replaced = c.base && f.filed <= c.base.filed && (f.form === "13F-HR" || f.amendmentType === "RESTATEMENT" || f.amendmentType === "NEW HOLDINGS");
    out.push(replaced ? `이전 공시(제출 ${f.filed})는 정정 공시로 대체됨` : `종류를 알 수 없는 정정(제출 ${f.filed})은 반영 안 함`);
  }
  return out;
}

/**
 * 13F 가치 단위 점검: 2023년부터 달러 단위가 원칙이지만 천 달러로 보고하는 기관이 있다.
 * 주식 보유 행의 '가치 ÷ 수량'(= 기말 가격) 중앙값이 0.5달러 미만이면 천 달러 단위로 보고 1000을 곱한다.
 */
export function thousandsCorrection(rows: { value: number; shares: number }[]): { factor: 1 | 1000; medianPrice: number | null } {
  const px = rows.filter((r) => r.shares > 0 && r.value >= 0).map((r) => r.value / r.shares).sort((a, b) => a - b);
  if (px.length < 3) return { factor: 1, medianPrice: px.length ? px[Math.floor(px.length / 2)] : null };
  const med = px[Math.floor(px.length / 2)];
  return { factor: med < 0.5 ? 1000 : 1, medianPrice: med };
}

export type HoldingStatus = "new" | "increased" | "decreased" | "unchanged" | "exited" | "none";

/** 직전 공시 대비 변화. 직전 공시 자료가 없으면 비교하지 않는다(prevKnown=false) */
export function holdingChange(cur: number | null, prev: number | null, prevKnown: boolean): { status: HoldingStatus; change: number | null; changePct: number | null } {
  if (!prevKnown) return { status: "none", change: null, changePct: null };
  const c = cur ?? 0;
  const p = prev ?? 0;
  if (!c && !p) return { status: "none", change: null, changePct: null };
  if (!p) return { status: "new", change: c, changePct: null };
  if (!c) return { status: "exited", change: -p, changePct: -100 };
  const d = c - p;
  return { status: d > 0 ? "increased" : d < 0 ? "decreased" : "unchanged", change: d, changePct: (d / p) * 100 };
}

export const HOLDING_STATUS_KO: Record<HoldingStatus, string> = {
  new: "새로 보고",
  increased: "늘림",
  decreased: "줄임",
  unchanged: "같음",
  exited: "목록에서 빠짐",
  none: "-",
};

/** 13F 신고 가치 ÷ 수량 = 기말 가격이 실제 종가와 맞는지 (CUSIP 매핑·단위 오류 검사). 종가가 없으면 null */
export function impliedPriceCheck(value: number, shares: number, close: number | null, tolerance = 0.1): { implied: number | null; ok: boolean | null } {
  const implied = ratio(value, shares);
  if (implied === null || close === null || !(close > 0)) return { implied, ok: null };
  return { implied, ok: Math.abs(implied / close - 1) <= tolerance };
}

/** 2023-01-03 이전 제출분 13F 는 가치가 천 달러 단위 */
export function valueInDollars(value: number, filed: string): number {
  return filed < "2023-01-03" ? value * 1000 : value;
}

/** CUSIP 검사 숫자 (9번째 자리) 확인 */
export function cusipValid(cusip: string): boolean {
  if (!/^[0-9A-Z*@#]{8}[0-9]$/.test(cusip)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const ch = cusip[i];
    let v = /\d/.test(ch) ? Number(ch) : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : ch === "*" ? 36 : ch === "@" ? 37 : 38;
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (sum % 10)) % 10 === Number(cusip[8]);
}
