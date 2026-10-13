"use client";
/** 과거 백테스트 — 사용자가 정한 시작일·종료일, 여러 포트폴리오 동일 조건 비교, 벤치마크 비교 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRuns, useSeriesMap, useStrategies, etToday } from "@/lib/client/user-data";
import { compareWithBenchmark, fullPeriodStat, REBALANCE_KO, runBacktestSuite, toKrw, validateWeights, checkCoverage, type BacktestConfig, type BacktestResult, type Rebalance } from "@/lib/sim/backtest";
import { formatEt } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import { Disclaimer, Field, krw, parseNum, pct, rowsFrom, rowsToItems, rowsProblem, Seg, SymbolSelect, tone, usd } from "./common";
import { GroupedBars, ReturnHeatmap, SimLineChart, SERIES_VARS } from "./charts";
import PortfolioInputs, { defaultPortfolios, LETTERS, type PortfolioInput } from "./PortfolioInputs";
import BarChartSvg from "@/components/BarChartSvg";
import type { PriceSeries } from "@/lib/sim/series";

const QUICK: { label: string; months?: number; all?: boolean }[] = [
  { label: "1개월", months: 1 },
  { label: "3개월", months: 3 },
  { label: "6개월", months: 6 },
  { label: "1년", months: 12 },
  { label: "3년", months: 36 },
  { label: "5년", months: 60 },
  { label: "10년", months: 120 },
  { label: "공통 전체", all: true },
];

function minusMonths(d: string, m: number): string {
  const [y, mo, da] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 - m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(da, last)).padStart(2, "0")}`;
}

interface RunOutput {
  at: number;
  cfg: Omit<BacktestConfig, "holdings">;
  items: { p: PortfolioInput; suite: ReturnType<typeof runBacktestSuite> }[];
  bench: { symbol: string; suite: ReturnType<typeof runBacktestSuite> } | null;
  series: Record<string, PriceSeries>;
  normalizedNote: string[];
}

export default function BacktestClient() {
  const [list, setList] = useState<PortfolioInput[]>(defaultPortfolios(2));
  const today = etToday();
  const [start, setStart] = useState(minusMonths(today, 60));
  const [end, setEnd] = useState(today);
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("500");
  const [timing, setTiming] = useState<"month_start" | "month_end">("month_start");
  const [reinvest, setReinvest] = useState(true);
  const [rebalance, setRebalance] = useState<Rebalance>("annual");
  const [cost, setCost] = useState("0.1");
  const [tax, setTax] = useState("15");
  const [rfMode, setRfMode] = useState<"auto" | "manual">("auto");
  const [rf, setRf] = useState("0");
  const [bench, setBench] = useState("QQQ");
  const [normalize, setNormalize] = useState(false);
  const [showKrw, setShowKrw] = useState(false);
  const [out, setOut] = useState<RunOutput | null>(null);
  const [err, setErr] = useState<string[] | null>(null);
  const runs = useRuns();
  const strategies = useStrategies();

  // ?strategy=ID 또는 ?compare=ID,ID 로 저장한 전략 불러오기
  useEffect(() => {
    if (!strategies.loaded) return;
    const sp = new URLSearchParams(window.location.search);
    const ids = (sp.get("compare") ?? sp.get("strategy") ?? "").split(",").filter(Boolean);
    const picked = ids.map((id) => strategies.value.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (picked.length) setList(picked.slice(0, 4).map((s, i) => ({ key: LETTERS[i], name: s.name, rows: rowsFrom(s.items) })));
  }, [strategies.loaded, strategies.value]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of list) for (const it of rowsToItems(p.rows)) if (!rowsProblem([{ symbol: it.symbol, weight: "1" }])) set.add(it.symbol);
    if (bench) set.add(bench);
    return [...set];
  }, [list, bench]);
  const ser = useSeriesMap([...symbols, "^IRX", "KRW=X"]);
  const cov = useMemo(() => (symbols.every((s) => ser.series[s] || ser.errors[s]) ? checkCoverage(symbols, ser.series, start, end) : null), [symbols, ser, start, end]);

  const quick = (q: (typeof QUICK)[number]) => {
    const last = cov?.commonEnd ?? today;
    if (q.all) {
      if (cov?.commonStart) setStart(cov.commonStart);
      setEnd(last);
      return;
    }
    setEnd(last);
    setStart(minusMonths(last, q.months as number));
  };

  const run = () => {
    setErr(null);
    const problems: string[] = [];
    const notes: string[] = [];
    const ready: { p: PortfolioInput; holdings: { symbol: string; weight: number }[] }[] = [];
    for (const p of list) {
      const pr = rowsProblem(p.rows);
      if (pr) {
        problems.push(`포트폴리오 ${p.key}: ${pr}`);
        continue;
      }
      const v = validateWeights(rowsToItems(p.rows), normalize);
      if (!v.ok) problems.push(`포트폴리오 ${p.key}: ${v.error}`);
      else {
        if (v.normalized) notes.push(`포트폴리오 ${p.key}: 비중 합계 ${Math.round(v.sum * 100) / 100}%를 100%로 자동 정규화했습니다.`);
        ready.push({ p, holdings: v.holdings });
      }
    }
    const ini = parseNum(initial);
    const mon = parseNum(monthly);
    const c = parseNum(cost);
    const t = parseNum(tax);
    if (!(ini >= 0) || !(mon >= 0) || ini + mon <= 0) problems.push("초기 투자금과 매월 추가 투자금을 확인하세요.");
    if (!(c >= 0 && c < 10) || !(t >= 0 && t <= 100)) problems.push("거래 비용(0~10%)과 세율(0~100%)을 확인하세요.");
    if (ser.loading) problems.push("가격 데이터를 불러오는 중입니다. 잠시 후 다시 실행하세요.");
    if (problems.length) return setErr(problems);
    let rfPct = parseNum(rf);
    if (rfMode === "auto") {
      const irx = ser.series["^IRX"];
      const vals = irx ? irx.dates.map((d, i) => (d >= start && d <= end ? irx.close[i] : NaN)).filter((v) => Number.isFinite(v)) : [];
      rfPct = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      notes.push(vals.length ? `샤프 비율의 무위험 수익률: 미국 13주 국채금리(^IRX) 기간 평균 ${rfPct.toFixed(2)}%` : "무위험 수익률 데이터가 없어 0%로 계산했습니다.");
    }
    const base = { start, end, initial: ini, monthly: mon, timing, reinvest, rebalance, costPct: c, taxPct: t, riskFreePct: rfPct };
    const items = ready.map(({ p, holdings }) => ({ p, suite: runBacktestSuite({ ...base, holdings }, ser.series) }));
    const failed = items.filter((x) => !x.suite.main.ok);
    if (failed.length) {
      const f = failed.flatMap((x) => (x.suite.main.ok ? [] : x.suite.main.problems.map((m) => `포트폴리오 ${x.p.key}: ${m}`)));
      return setErr(f);
    }
    const b = bench ? { symbol: bench, suite: runBacktestSuite({ ...base, holdings: [{ symbol: bench, weight: 100 }], rebalance: "none" }, ser.series) } : null;
    if (b && !b.suite.main.ok) notes.push(`벤치마크 ${bench}: ${b.suite.main.problems.join(" ")}`);
    setOut({ at: Date.now(), cfg: base, items, bench: b, series: ser.series, normalizedNote: notes });
  };

  const save = () => {
    if (!out) return;
    const main = out.items.map((x) => x.suite.main as BacktestResult);
    runs.add({
      kind: "backtest",
      title: `백테스트 ${main[0].start}~${main[0].end} · ${out.items.map((x) => x.p.name).join(" vs ")}`,
      summary: main.flatMap((r, i) => [
        { label: `${out.items[i].p.key} 최종 평가금액`, value: usd(r.finalValue, 0) },
        { label: `${out.items[i].p.key} CAGR`, value: pct(r.cagrPct) },
        { label: `${out.items[i].p.key} 최대 낙폭`, value: pct(r.mddPct) },
      ]),
      config: { ...out.cfg, portfolios: out.items.map((x) => ({ name: x.p.name, items: rowsToItems(x.p.rows) })), benchmark: out.bench?.symbol ?? null },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 포트폴리오" description="티커와 비중을 직접 바꿀 수 있습니다. 비교할 포트폴리오는 모두 같은 기간·조건으로 계산합니다.">
        <PortfolioInputs list={list} onChange={setList} />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="h-4 w-4" />
          비중 합계가 100%가 아니면 자동 정규화 (끄면 오류로 알림)
        </label>
      </Section>

      <Section title="2. 기간" description="시작일과 종료일을 직접 입력하세요. 빠른 선택 버튼은 날짜 입력칸을 채워 주는 편의 기능이며, 입력칸의 날짜로 계산합니다.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="시작일">
            <input type="date" className="input" value={start} max={end} onChange={(e) => setStart(e.target.value)} aria-label="시작일" />
          </Field>
          <Field label="종료일">
            <input type="date" className="input" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} aria-label="종료일" />
          </Field>
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button key={q.label} type="button" className="btn btn-sm" onClick={() => quick(q)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <CoverageTable cov={cov} loading={ser.loading} errors={ser.errors} onAlign={(d) => setStart(d)} start={start} />
      </Section>

      <Section title="3. 투자 조건">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="초기 투자금 (USD)">
            <input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} aria-label="초기 투자금" />
          </Field>
          <Field label="매월 추가 투자금 (USD)">
            <input className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label="매월 추가 투자금" />
          </Field>
          <Field label="추가 투자 시점">
            <Seg label="추가 투자 시점" value={timing} onChange={setTiming} options={[{ v: "month_start", l: "월초 첫 거래일" }, { v: "month_end", l: "월말 마지막 거래일" }]} />
          </Field>
          <Field label="분배금">
            <Seg label="분배금 재투자" value={reinvest} onChange={setReinvest} options={[{ v: true, l: "재투자" }, { v: false, l: "현금 보유" }]} />
          </Field>
          <Field label="리밸런싱">
            <select className="input" value={rebalance} onChange={(e) => setRebalance(e.target.value as Rebalance)} aria-label="리밸런싱">
              {(Object.keys(REBALANCE_KO) as Rebalance[]).map((r) => (
                <option key={r} value={r}>
                  {REBALANCE_KO[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="거래 비용 (%)" hint="사고판 금액 기준">
            <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="거래 비용" />
          </Field>
          <Field label="분배금 세금 (%)" hint="미국 원천징수 15% 가정. 양도세는 반영하지 않음">
            <input className="input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
          </Field>
          <Field label="샤프 비율 무위험 수익률">
            <div className="flex gap-1">
              <select className="input" value={rfMode} onChange={(e) => setRfMode(e.target.value as "auto" | "manual")} aria-label="무위험 수익률 방식">
                <option value="auto">국채금리 기간 평균</option>
                <option value="manual">직접 입력(%)</option>
              </select>
              {rfMode === "manual" && <input className="input w-20" inputMode="decimal" value={rf} onChange={(e) => setRf(e.target.value)} aria-label="무위험 수익률" />}
            </div>
          </Field>
          <Field label="벤치마크 (같은 조건으로 비교)">
            <SymbolSelect value={bench} onChange={setBench} label="벤치마크" includeNone="비교 안 함" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={showKrw} onChange={(e) => setShowKrw(e.target.checked)} className="h-4 w-4" />
            원화(KRW) 환산도 보기
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={run} disabled={ser.loading}>
            {ser.loading ? "가격 데이터 불러오는 중…" : "백테스트 실행"}
          </button>
          {out && (
            <button type="button" className="btn" onClick={save}>
              결과 저장 (대시보드에 표시)
            </button>
          )}
        </div>
        {err && (
          <div className="mt-3">
            <Notice tone="critical" title="계산하지 않았습니다">
              <ul className="list-disc pl-4">
                {err.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {cov?.commonStart && cov.commonStart > start && (
                <button type="button" className="btn btn-sm mt-2" onClick={() => setStart(cov.commonStart as string)}>
                  모든 종목이 있는 공통 기간({cov.commonStart}~)으로 맞추기
                </button>
              )}
            </Notice>
          </div>
        )}
      </Section>

      {out && <Results out={out} showKrw={showKrw} />}
      <Disclaimer>과거 성과는 미래 수익을 보장하지 않습니다. 백테스트는 실제 수집된 일별 종가와 분배금 기록으로 계산한 결과이며, 실제 체결 가격·세금(양도소득세 등)·환전 비용·분배금 지급 시점에 따라 실제 결과는 달라집니다.</Disclaimer>
    </div>
  );
}

function CoverageTable({ cov, loading, errors, onAlign, start }: { cov: ReturnType<typeof checkCoverage> | null; loading: boolean; errors: Record<string, string>; onAlign: (d: string) => void; start: string }) {
  if (loading && !cov) return <p className="mt-3 text-xs text-muted">종목별 데이터 범위를 확인하는 중…</p>;
  if (!cov) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-semibold text-ink-2">종목별 실제 데이터 범위 (상장일·제공처 기록 시작일 이후만 계산)</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {cov.items.map((it) => {
          const bad = !it.first || start < it.first;
          return (
            <span key={it.symbol} className={`rounded-md border px-2 py-1 ${bad ? "border-critical/50 bg-critical-soft" : "border-line"}`}>
              <span className="font-semibold">{it.symbol}</span> <span className="num">{it.first ?? "데이터 없음"} ~ {it.last ?? ""}</span>
              {errors[it.symbol] && <span className="text-critical"> ({errors[it.symbol]})</span>}
            </span>
          );
        })}
      </div>
      {cov.commonStart && (
        <p className="mt-2 text-xs text-ink-2">
          모든 종목의 공통 기간: <span className="num">{cov.commonStart} ~ {cov.commonEnd}</span>
          {start < cov.commonStart && (
            <button type="button" className="btn btn-sm ml-2" onClick={() => onAlign(cov.commonStart as string)}>
              공통 기간으로 맞추기
            </button>
          )}
        </p>
      )}
    </div>
  );
}

const fmtYears = (y: number) => (y >= 1 ? `${y.toFixed(1)}년` : `${Math.round(y * 12)}개월`);

function Results({ out, showKrw }: { out: RunOutput; showKrw: boolean }) {
  const mains = out.items.map((x) => x.suite.main as BacktestResult);
  const benchMain = out.bench?.suite.main.ok ? (out.bench.suite.main as BacktestResult) : null;
  const all = [...mains, ...(benchMain ? [benchMain] : [])];
  const names = [...out.items.map((x) => `${x.p.key}. ${x.p.name}`), ...(benchMain ? [`벤치마크 ${out.bench?.symbol}`] : [])];
  const colors = [...out.items.map((_, i) => SERIES_VARS[i]), "--s5"];
  const r0 = mains[0];
  const [heat, setHeat] = useState(0);
  const [incomeIdx, setIncomeIdx] = useState(0);
  // 차트 공통 날짜 (첫 포트폴리오 기준)
  const dates = r0.dates;
  const align = (r: BacktestResult, arr: number[]) => {
    const m = new Map(r.dates.map((d, i) => [d, arr[i]]));
    return dates.map((d) => m.get(d) ?? null);
  };
  const years = [...new Set(all.flatMap((r) => r.annual.map((a) => a.year)))].sort();
  const lastData = Object.values(out.series)
    .filter((s) => mains.some((r) => r.holdings.some((h) => h.symbol === s.symbol)))
    .map((s) => ({ s: s.symbol, last: s.dates[s.dates.length - 1], src: s.source, at: s.fetchedAt }));

  const row = (label: string, f: (r: BacktestResult, i: number) => ReactNode, help?: string) => (
    <tr>
      <th className="text-left font-normal text-ink-2" title={help}>
        {label}
      </th>
      {all.map((r, i) => (
        <td key={i} className="r">
          {f(r, i)}
        </td>
      ))}
    </tr>
  );
  const flipped = (i: number) => (i < out.items.length ? out.items[i].suite.flipped : out.bench?.suite.flipped) ?? null;
  const priceOnly = (i: number) => (i < out.items.length ? out.items[i].suite.priceOnly : out.bench?.suite.priceOnly) ?? null;
  const comps = benchMain ? mains.map((r) => compareWithBenchmark(r, benchMain)) : [];

  return (
    <>
      <Section title="4. 결과 비교" description={`계산 기간 ${r0.start} ~ ${r0.end} (${fmtYears(r0.years)}, 거래일 ${r0.tradingDays}일) · 모든 포트폴리오에 같은 기간·납입·재투자·비용·세금 조건 적용`}>
        {[...out.normalizedNote, ...r0.notes].map((n) => (
          <p key={n} className="mb-1 text-xs text-ink-2">
            · {n}
          </p>
        ))}
        <div className="mt-2 overflow-x-auto">
          <table className="table-basic min-w-[560px]">
            <thead>
              <tr>
                <th />
                {names.map((n, i) => (
                  <th key={n} className="r">
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: `var(${colors[i]})` }} />
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("최종 평가금액", (r) => <span className="font-semibold">{usd(r.finalValue, 0)}</span>)}
              {row("총 납입 원금", (r) => `${usd(r.totalContributed, 0)} (${r.contributions}회 추가)`)}
              {row("손익", (r) => <span className={tone(r.profit)}>{usd(r.profit, 0)}</span>)}
              {row("총수익률 (납입 원금 대비)", (r) => <span className={tone(r.totalReturnPct)}>{pct(r.totalReturnPct)}</span>)}
              {row("시간가중 누적 수익률", (r) => pct(r.twrReturnPct), "추가 납입 시점의 영향을 뺀 전략 자체의 수익률")}
              {row("연환산 수익률 (CAGR)", (r) => pct(r.cagrPct), "시간가중 수익률 기준. 1년 미만은 표시하지 않음")}
              {row("금액가중 수익률 (IRR)", (r) => pct(r.irrPct), "납입 시점까지 반영한 실제 투자자 연 수익률")}
              {row("최대 낙폭 (MDD)", (r) => <span className="text-down">{pct(r.mddPct)}</span>)}
              {row("최대 낙폭 구간", (r) => <span className="text-[11px]">{r.mddPeak ? `${r.mddPeak} → ${r.mddTrough}${r.mddRecovery ? ` (회복 ${r.mddRecovery})` : " (미회복)"}` : "-"}</span>)}
              {row("변동성 (연환산)", (r) => pct(r.volPct, 1).replace("+", ""))}
              {row("샤프 비율", (r) => (r.sharpe !== null ? r.sharpe.toFixed(2) : "-"), `무위험 수익률 ${r0.riskFreePct.toFixed(2)}%`)}
              {row("누적 분배금 (세전)", (r) => usd(r.income.gross, 0))}
              {row("누적 분배금 (세후)", (r) => usd(r.income.net, 0))}
              {row(
                r0.config.reinvest ? "재투자 효과 (재투자 − 현금 보유)" : "재투자했다면 (차이)",
                (r, i) => {
                  const f = flipped(i);
                  if (!f || !f.ok) return "-";
                  const d = r0.config.reinvest ? r.finalValue - f.finalValue : f.finalValue - r.finalValue;
                  return <span className={tone(d)}>{usd(d, 0)}</span>;
                },
                "같은 조건에서 분배금 재투자 여부만 바꾼 결과와의 최종 평가금액 차이",
              )}
              {row("가격만의 수익률 (분배금 제외)", (r, i) => {
                const po = priceOnly(i);
                return po && po.ok ? pct(po.totalReturnPct) : "-";
              }, "분배금을 전혀 받지 않았다고 본 가격 변화만의 결과")}
              {row("거래 비용 합계", (r) => usd(r.costs, 0))}
              {benchMain && row("벤치마크 대비 초과 총수익률", (r, i) => (i < comps.length ? <span className={tone(comps[i].excessTotalPct)}>{pct(comps[i].excessTotalPct)}p</span> : "-"))}
              {benchMain && row("벤치마크 대비 초과 CAGR", (r, i) => (i < comps.length ? <span className={tone(comps[i].excessCagrPct)}>{pct(comps[i].excessCagrPct)}p</span> : "-"))}
              {benchMain && row("벤치마크 대비 최대 상대 낙폭", (r, i) => (i < comps.length ? pct(comps[i].relMddPct) : "-"), "벤치마크 대비 상대 성과가 고점에서 가장 많이 뒤처진 폭")}
            </tbody>
          </table>
        </div>
        {benchMain && (
          <p className="mt-2 text-sm">
            {mains.map((r, i) => (
              <span key={i} className="mr-3">
                {out.items[i].p.key}는 같은 기간 {out.bench?.symbol}보다 최종 평가금액이 <b className={tone(comps[i].finalDiff)}>{usd(Math.abs(comps[i].finalDiff), 0)} {comps[i].finalDiff >= 0 ? "많았습니다" : "적었습니다"}</b>.
              </span>
            ))}
          </p>
        )}
      </Section>

      <Section title="자산 가치 추이" description="각 날짜 종가 기준 평가금액 (분배금·추가 납입 포함). 점선은 총 납입 원금.">
        <SimLineChart
          dates={dates}
          lines={[...all.map((r, i) => ({ key: names[i], label: names[i], values: align(r, r.value), color: colors[i] })), { key: "c", label: "납입 원금", values: align(r0, r0.contributed), dashed: true, color: "--axis" }]}
          format="usd"
          logToggle
          height={320}
          ariaLabel="자산 가치 추이"
        />
      </Section>

      <Section title="낙폭" description="시간가중 수익 지수의 고점 대비 하락률 (추가 납입 효과 제외)">
        <SimLineChart dates={dates} lines={all.map((r, i) => ({ key: names[i], label: names[i], values: align(r, r.drawdown), color: colors[i] }))} format="pct" height={220} baseline={0} ariaLabel="낙폭 추이" />
      </Section>

      <Section title="연도별 수익률" description="시간가중 수익률. 첫해·마지막 해는 부분 기간일 수 있습니다.">
        <GroupedBars categories={years} series={all.map((r, i) => ({ label: names[i], values: years.map((y) => r.annual.find((a) => a.year === y)?.retPct ?? null), color: colors[i] }))} format="pct" ariaLabel="연도별 수익률 비교" />
      </Section>

      <Section
        title="월별 수익률 히트맵"
        right={<Seg label="히트맵 포트폴리오" value={heat} onChange={setHeat} options={all.map((_, i) => ({ v: i, l: i < mains.length ? out.items[i].p.key : "벤치마크" }))} />}
      >
        <ReturnHeatmap monthly={all[heat].monthly} annual={all[heat].annual} />
      </Section>

      <Section
        title="월별 분배금 현금흐름"
        description="받은 분배금(세전)을 지급일(없으면 배당락일) 기준 월로 합계. 재투자 여부와 관계없이 받은 금액입니다."
        right={<Seg label="분배금 포트폴리오" value={incomeIdx} onChange={setIncomeIdx} options={all.map((_, i) => ({ v: i, l: i < mains.length ? out.items[i].p.key : "벤치마크" }))} />}
      >
        {all[incomeIdx].monthlyIncome.length ? (
          <BarChartSvg points={all[incomeIdx].monthlyIncome.map((m) => ({ label: m.ym, value: m.gross, sub: `세후 ${usd(m.net)}` }))} valueFormat="usd2" ariaLabel="월별 분배금" />
        ) : (
          <p className="text-sm text-muted">이 기간에 받은 분배금이 없습니다.</p>
        )}
      </Section>

      {benchMain && (
        <Section title={`${out.bench?.symbol} 대비 상대 성과`} description="포트폴리오 시간가중 지수 ÷ 벤치마크 시간가중 지수 (시작 100). 100보다 크면 벤치마크보다 앞서 있는 상태.">
          <SimLineChart dates={comps[0].relDates} lines={comps.map((c, i) => ({ key: names[i], label: names[i], values: c.relative, color: colors[i] }))} format="index" baseline={100} height={240} ariaLabel="벤치마크 대비 상대 성과" />
        </Section>
      )}

      <Section title="종목별 기여 (기간 말 기준)">
        <div className="grid gap-3 lg:grid-cols-2">
          {mains.map((r, i) => (
            <div key={i} className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold">{names[i]}</p>
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th className="r">목표 비중</th>
                    <th className="r">기간 말 비중</th>
                    <th className="r">평가금액</th>
                    <th className="r">받은 분배금</th>
                  </tr>
                </thead>
                <tbody>
                  {r.holdings.map((h) => (
                    <tr key={h.symbol}>
                      <td className="font-semibold">{h.symbol}</td>
                      <td className="r">{h.targetWeight.toFixed(1)}%</td>
                      <td className="r">{h.endWeight.toFixed(1)}%</td>
                      <td className="r">{usd(h.value, 0)}</td>
                      <td className="r">{usd(h.dividendsGross, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>

      {showKrw && <KrwResults all={all} names={names} fx={out.series["KRW=X"]} />}

      <Section title="참고: 각 종목의 전체 이용 가능 기간 성과" description="종목마다 상장일이 달라 기간이 서로 다릅니다. 위의 공통 기간 결과와 섞어 비교하지 마세요. (분배금 재투자, 세금·비용 미반영)">
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th>기간</th>
                <th className="r">총수익률</th>
                <th className="r">연환산 총수익률</th>
                <th className="r">연환산 가격 수익률</th>
                <th className="r">최대 낙폭</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(all.flatMap((r) => r.holdings.map((h) => h.symbol)))].map((s) => {
                const f = out.series[s] ? fullPeriodStat(out.series[s]) : null;
                return f ? (
                  <tr key={s}>
                    <td className="font-semibold">{s}</td>
                    <td className="num text-xs">
                      {f.first} ~ {f.last} ({fmtYears(f.years)})
                    </td>
                    <td className="r">{pct(f.totalReturnPct, 1)}</td>
                    <td className="r">{pct(f.totalCagrPct)}</td>
                    <td className="r">{pct(f.priceCagrPct)}</td>
                    <td className="r text-down">{pct(f.mddPct, 1)}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="데이터 출처와 계산 가정">
        <ul className="list-disc pl-5 text-xs leading-relaxed text-ink-2">
          <li>가격: 일별 종가(주식분할만 반영, 분배금 미반영 가격). 분배금은 배당락일에 보유 수량 × 주당 지급액으로 한 번만 더합니다 — 수정주가를 쓰지 않아 이중 계산이 없습니다.</li>
          <li>분배금 재투자: 배당락일 종가로 같은 종목을 매수. 현금 보유: 세후 분배금을 이자 없는 현금으로 보유.</li>
          <li>
            추가 납입: {out.cfg.timing === "month_start" ? "매월 첫 거래일" : "매월 마지막 거래일"} 종가로 목표 비중대로 매수 ({usd(out.cfg.monthly)}). 리밸런싱: {REBALANCE_KO[out.cfg.rebalance as Rebalance]} (새 기간 첫 거래일 종가).
          </li>
          <li>거래 비용 {out.cfg.costPct}% (매수·리밸런싱 거래 금액), 분배금 세금 {out.cfg.taxPct}%. 양도소득세·환전 비용·운용사 보수 외 비용은 반영하지 않았습니다 (운용보수는 이미 가격에 반영됨).</li>
          <li>상장 이전 기간은 계산하지 않으며, 가격이 없는 날을 채우지 않습니다.</li>
          {lastData.map((d) => (
            <li key={d.s}>
              {d.s}: 출처 {d.src ?? "-"}, 마지막 데이터 {d.last}, 수집 {d.at ? formatEt(d.at) : "-"}
            </li>
          ))}
          <li>계산 시각: {new Date(out.at).toLocaleString("ko-KR")}</li>
        </ul>
      </Section>
    </>
  );
}

function KrwResults({ all, names, fx }: { all: BacktestResult[]; names: string[]; fx: PriceSeries | undefined }) {
  const views = all.map((r) => toKrw(r, fx));
  return (
    <Section title="원화(KRW) 환산" description="각 날짜의 원/달러 환율로 평가금액과 납입금을 환산했습니다. 원화 기준 수익률에는 환율 변동 효과가 포함됩니다 (환전 비용 미반영).">
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>포트폴리오</th>
              <th className="r">원화 납입 원금 (납입 당시 환율)</th>
              <th className="r">원화 최종 평가금액 (마지막 날 환율)</th>
              <th className="r">원화 기준 수익률</th>
              <th className="r">USD 기준 수익률</th>
              <th>환율</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v, i) => (
              <tr key={i}>
                <td>{names[i]}</td>
                {v.ok ? (
                  <>
                    <td className="r">{krw(v.contributedKrw)}</td>
                    <td className="r">{krw(v.finalKrw)}</td>
                    <td className={`r ${tone(v.returnPct)}`}>{pct(v.returnPct)}</td>
                    <td className={`r ${tone(all[i].totalReturnPct)}`}>{pct(all[i].totalReturnPct)}</td>
                    <td className="num text-xs">
                      {v.fxStart.date} ₩{v.fxStart.rate.toFixed(1)} → {v.fxEnd.date} ₩{v.fxEnd.rate.toFixed(1)}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="text-xs text-warn">
                    {v.reason}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

