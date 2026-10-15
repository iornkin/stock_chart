"use client";
/** 미래 포트폴리오 시뮬레이터 — 가정에 따른 시나리오 계산과 과거 수익률 기반 몬테카를로 (예측 아님) */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFx, useIncome, usePortfolio, useRuns, useSeriesMap, useStrategies } from "@/lib/client/user-data";
import { ENGINE_VERSION } from "@/lib/sim/repro";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import {
  DEFAULT_TOTAL_RETURN,
  futureSensitivity,
  historicalPriceCagr,
  historicalReturnStats,
  monthlyHistory,
  probAtLeast,
  runFuture,
  runMonteCarlo,
  SCENARIO_KO,
  scenarioHoldings,
  totalReturnCagr,
  validateFuture,
  MC_MIN_MONTHS,
  type FutureConfig,
  type FutureHolding,
  type FutureResult,
  type HistoricalReturn,
  type MonteCarloResult,
  type ScenarioKey,
} from "@/lib/sim/future";
import { REBALANCE_KO, type Rebalance } from "@/lib/sim/backtest";
import { quantile } from "@/lib/sim/metrics";
import { getInstrument } from "@/lib/instruments";
import { Notice, Section } from "@/components/ui";
import { Disclaimer, downloadCsv, Field, krw, parseNum, pct, rowsFrom, rowsProblem, rowsToItems, Seg, tone, usd } from "./common";
import { SimLineChart, SERIES_VARS } from "./charts";
import PortfolioInputs, { defaultPortfolios, type PortfolioInput } from "./PortfolioInputs";
import BarChartSvg from "@/components/BarChartSvg";
import PanelTabs from "@/components/PanelTabs";

const PERIODS = [
  { m: 1, l: "1개월" },
  { m: 3, l: "3개월" },
  { m: 6, l: "6개월" },
  { m: 12, l: "1년" },
  { m: 36, l: "3년" },
  { m: 60, l: "5년" },
  { m: 120, l: "10년" },
  { m: 240, l: "20년" },
];

type ScenarioId = ScenarioKey | "custom";
const SCEN: ScenarioId[] = ["conservative", "neutral", "optimistic", "custom"];
const SCEN_KO: Record<ScenarioId, string> = { ...SCENARIO_KO, custom: "사용자 지정" };
/** total: 모든 종목 같은 총수익률 / price: 같은 가격 수익률 / history: 종목별 과거 이동 구간 총수익률 */
type Mode = "total" | "price" | "history";
const REF_SYMBOL = "SPY";

function nextMonthYm(): string {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

type PerScenario = Record<ScenarioId, { holdings: FutureHolding[]; res: FutureResult; alt: FutureResult; basis: Record<string, string> }>;
type ResultRow = { p: PortfolioInput; error: string } | { p: PortfolioInput; per: PerScenario };

export default function FutureClient() {
  const [tab, setTab] = useState<"scenario" | "mc">("scenario");
  const [list, setList] = useState<PortfolioInput[]>(defaultPortfolios(3));
  const [periodMode, setPeriodMode] = useState<number | "custom">(120);
  const [cy, setCy] = useState("2");
  const [cm, setCm] = useState("6");
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("500");
  const [timing, setTiming] = useState<"start" | "end">("start");
  const [reinvest, setReinvest] = useState(true);
  const [rebalance, setRebalance] = useState<Rebalance>("annual");
  const [cost, setCost] = useState("0.1");
  const [tax, setTax] = useState("15");
  const [fee, setFee] = useState("0");
  const [mode, setMode] = useState<Mode>("total");
  const [windowYears, setWindowYears] = useState(5);
  const [rates, setRates] = useState<Record<ScenarioKey, string>>({ conservative: String(DEFAULT_TOTAL_RETURN.conservative), neutral: String(DEFAULT_TOTAL_RETURN.neutral), optimistic: String(DEFAULT_TOTAL_RETURN.optimistic) });
  const [yields, setYields] = useState<Record<string, string>>({});
  const [customPrice, setCustomPrice] = useState<Record<string, string>>({});
  const [scenario, setScenario] = useState<ScenarioId>("neutral");
  const [focus, setFocus] = useState(0);
  const income = useIncome();
  const strategies = useStrategies();
  const portfolio = usePortfolio();
  const mine = usePortfolioSummary(portfolio.value);
  const runs = useRuns();
  const fxNow = useFx().rate;

  useEffect(() => {
    if (!strategies.loaded) return;
    const id = new URLSearchParams(window.location.search).get("strategy");
    const s = id ? strategies.value.find((x) => x.id === id) : null;
    if (s) setList((l) => [{ key: "A", name: s.name, rows: rowsFrom(s.items), auto: false }, ...l.slice(1)]);
  }, [strategies.loaded, strategies.value]);

  const months = periodMode === "custom" ? Math.round(parseNum(cy) * 12 + parseNum(cm)) : periodMode;
  const symbols = useMemo(() => [...new Set(list.flatMap((p) => rowsToItems(p.rows).map((i) => i.symbol)))].filter((s) => !rowsProblem([{ symbol: s, weight: "1" }])), [list]);
  const ser = useSeriesMap([...symbols, REF_SYMBOL]);

  const info = (s: string) => income.data?.items[s];
  const yieldOf = (s: string) => {
    if (yields[s] !== undefined && yields[s] !== "") return parseNum(yields[s]);
    return info(s)?.ttmYield ?? 0;
  };
  const neutralRate = parseNum(rates.neutral);
  const priceOfCustom = (s: string) => (customPrice[s] !== undefined && customPrice[s] !== "" ? parseNum(customPrice[s]) : mode === "price" ? neutralRate : neutralRate - yieldOf(s));

  // 종목별 과거 이동 구간 총수익률 (분배금 재투자)
  const hist = useMemo(() => {
    const out: Record<string, HistoricalReturn | { error: string }> = {};
    for (const s of symbols) {
      const x = ser.series[s];
      out[s] = x ? historicalReturnStats(x, windowYears) : { error: ser.errors[s] ?? "가격 데이터를 불러오는 중" };
    }
    return out;
  }, [symbols, ser, windowYears]);
  const ref = useMemo(() => {
    const x = ser.series[REF_SYMBOL];
    return x ? { all: totalReturnCagr(x, null), y10: totalReturnCagr(x, 10), y20: totalReturnCagr(x, 20) } : null;
  }, [ser]);
  const leveraged = symbols.filter((s) => getInstrument(s)?.leverage);

  const loadMine = () => {
    if (mine.empty || mine.missingPrices.length || !mine.holdings.length) return;
    const total = mine.marketValue;
    setList((l) => [{ key: "A", name: "내 자산 (현재 보유 비중)", auto: false, rows: mine.holdings.map((h) => ({ symbol: h.symbol, weight: String(Math.round(((h.value ?? 0) / total) * 10000) / 100) })) }, ...l.slice(1)]);
    setInitial(String(Math.round(total * 100) / 100));
  };

  const base = { months, startYm: nextMonthYm(), initial: parseNum(initial), monthly: parseNum(monthly), timing, reinvest, rebalance, costPct: parseNum(cost), taxPct: parseNum(tax), feePct: parseNum(fee) };

  const results: ResultRow[] = useMemo(() => {
    return list.map((p): ResultRow => {
      const problem = rowsProblem(p.rows);
      if (problem) return { p, error: problem };
      const items = rowsToItems(p.rows);
      const b = items.map((i) => ({ symbol: i.symbol, weight: i.weight, yieldPct: yieldOf(i.symbol), monthWeights: info(i.symbol)?.monthWeights }));
      const per: Partial<PerScenario> = {};
      for (const sc of SCEN) {
        let holdings: FutureHolding[];
        const basis: Record<string, string> = {};
        if (sc === "custom") holdings = b.map((x) => ({ ...x, priceReturnPct: priceOfCustom(x.symbol) }));
        else if (mode === "history") {
          holdings = b.map((x) => {
            const h = hist[x.symbol];
            const q = h && !("error" in h) ? (sc === "conservative" ? h.p25 : sc === "neutral" ? h.p50 : h.p75) : null;
            const total = q ?? parseNum(rates[sc]);
            basis[x.symbol] = q !== null ? `과거 ${windowYears}년 구간 ${sc === "conservative" ? "하위 25%" : sc === "neutral" ? "중앙값" : "상위 25%"}` : `기록 부족 → 같은 가정 ${rates[sc]}%`;
            return { ...x, priceReturnPct: total - x.yieldPct };
          });
        } else holdings = scenarioHoldings(b, mode, parseNum(rates[sc]));
        const cfg: FutureConfig = { ...base, holdings };
        const err = validateFuture(cfg);
        if (err) return { p, error: err };
        per[sc] = { holdings, res: runFuture(cfg), alt: runFuture({ ...cfg, reinvest: !cfg.reinvest }), basis };
      }
      return { p, per: per as PerScenario };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, months, initial, monthly, timing, reinvest, rebalance, cost, tax, fee, mode, rates, yields, customPrice, income.data, hist, windowYears]);

  const fillHistory = (years: number) => {
    const next: Record<string, string> = {};
    for (const s of symbols) {
      const x = ser.series[s];
      const h = x ? historicalPriceCagr(x, years) : null;
      if (h) next[s] = String(Math.round(h.pct * 100) / 100);
    }
    setCustomPrice(next);
    setScenario("custom");
  };

  const modeDesc: Record<Mode, string> = {
    total: "모든 종목 같은 총수익률: 가격 수익률 = 총수익률 − 분배금 수익률 (분배금이 높다고 유리해지지 않는 중립 가정)",
    price: "모든 종목 같은 가격 수익률: 가격이 같은 비율로 오르고 분배금을 더함 (분배금 높은 종목이 유리해지는 가정)",
    history: `종목별 과거 실적: 각 종목의 과거 ${windowYears}년 이동 구간 총수익률(분배금 재투자) 분포에서 하위 25% / 중앙값 / 상위 25%를 보수·중립·낙관으로 사용. 가격 수익률 = 그 값 − 분배금 수익률`,
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 포트폴리오" description="이름은 직접 입력할 수 있습니다. 비워 두면 종목·비중으로 자동으로 짓습니다." right={!mine.empty && !mine.missingPrices.length ? <button type="button" className="btn btn-sm" onClick={loadMine}>내 자산에서 불러오기</button> : undefined}>
        <PortfolioInputs list={list} onChange={setList} max={3} />
      </Section>

      <Section title="2. 기간과 투자 조건" description="다음 달 초부터 계산합니다">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="기간">
            <div className="seg flex-wrap" role="group" aria-label="기간">
              {PERIODS.map((x) => (
                <button key={x.m} type="button" aria-pressed={periodMode === x.m} onClick={() => setPeriodMode(x.m)}>
                  {x.l}
                </button>
              ))}
              <button type="button" aria-pressed={periodMode === "custom"} onClick={() => setPeriodMode("custom")}>
                직접 입력
              </button>
            </div>
          </Field>
          {periodMode === "custom" && (
            <>
              <Field label="년">
                <input className="input w-20" inputMode="numeric" value={cy} onChange={(e) => setCy(e.target.value)} aria-label="기간 년" />
              </Field>
              <Field label="개월">
                <input className="input w-20" inputMode="numeric" value={cm} onChange={(e) => setCm(e.target.value)} aria-label="기간 개월" />
              </Field>
            </>
          )}
          <span className="pb-2 text-sm text-ink-2">= {Number.isFinite(months) ? `${months}개월` : "-"}</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="초기 투자금 (USD)">
            <input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} aria-label="초기 투자금" />
          </Field>
          <Field label="매월 추가 투자금 (USD)">
            <input className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label="매월 추가 투자금" />
          </Field>
          <Field label="추가 투자 시점">
            <Seg label="추가 투자 시점" value={timing} onChange={setTiming} options={[{ v: "start", l: "월초" }, { v: "end", l: "월말" }]} />
          </Field>
          <Field label="분배금">
            <Seg label="분배금 재투자" value={reinvest} onChange={setReinvest} options={[{ v: true, l: "재투자" }, { v: false, l: "현금 수령" }]} />
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
        </div>
        <details className="mt-4 rounded-lg border border-line px-4 py-3">
          <summary className="text-sm font-semibold text-ink-2">
            세금·비용 <span className="ml-1 text-xs font-normal text-muted">거래 비용 {cost}% · 분배금 세금 {tax}% · 추가 비용 {fee}%</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="거래 비용 (%)">
              <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="거래 비용" />
            </Field>
            <Field label="분배금 세금 (%)" hint="한·미 조세조약 원천징수 15% 가정. 직접 바꿀 수 있습니다.">
              <input className="input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
            </Field>
            <Field label="추가 연간 비용 (%)" hint="가정 수익률에 보수가 이미 들어 있으면 0 (과거 실적·시세에는 보수가 반영되어 있음)">
              <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="추가 연간 비용" />
            </Field>
          </div>
        </details>
      </Section>

      <div role="tablist" aria-label="시뮬레이션 방식" className="flex gap-1 border-b border-line">
        {[
          ["scenario", "시나리오 계산 (가정 입력)"],
          ["mc", "몬테카를로 (과거 수익률 분포)"],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as "scenario" | "mc")} className={`border-b-2 px-3 py-2.5 text-sm ${tab === k ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2"}`}>
            {l}
          </button>
        ))}
      </div>

      {leveraged.length > 0 && (
        <Notice tone="warn" title="레버리지 ETF 가 포함되어 있습니다">
          {leveraged.join(", ")}: 하루 수익률의 배수를 목표로 해 장기 결과가 기초지수 수익률 × 배수와 다르고, 변동이 클수록 손실이 커질 수 있습니다. 같은 연 수익률 가정이나 과거 상승장 실적을 그대로 쓰면 결과가 비현실적으로 나올 수 있습니다.
        </Notice>
      )}

      {tab === "scenario" ? (
        <>
          <Section title="3. 수익률 가정" description={modeDesc[mode]}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="가정 방식">
                <Seg
                  label="가정 방식"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { v: "total", l: "같은 총수익률" },
                    { v: "price", l: "같은 가격 수익률" },
                    { v: "history", l: "종목별 과거 실적" },
                  ]}
                />
              </Field>
              {mode === "history" ? (
                <Field label="과거 구간 길이">
                  <Seg label="과거 구간 길이" value={windowYears} onChange={setWindowYears} options={[3, 5, 10].map((y) => ({ v: y, l: `${y}년` }))} />
                </Field>
              ) : (
                (["conservative", "neutral", "optimistic"] as ScenarioKey[]).map((k) => (
                  <Field key={k} label={`${SCENARIO_KO[k]} (연 %)`}>
                    <input className="input w-24" inputMode="decimal" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} aria-label={`${SCENARIO_KO[k]} 가정 수익률`} />
                  </Field>
                ))
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {mode !== "history" && <>기본값 4% / 7% / 10%는 계산용 가정이며 예측값이 아닙니다. </>}
              {ref?.all && (
                <>
                  참고 (실제 기록, {REF_SYMBOL} 분배금 재투자): 상장 이후 연 {ref.all.pct.toFixed(1)}% ({ref.all.from.slice(0, 4)}~{ref.all.to.slice(0, 4)}){ref.y20 ? ` · 최근 20년 연 ${ref.y20.pct.toFixed(1)}%` : ""}
                  {ref.y10 ? ` · 최근 10년 연 ${ref.y10.pct.toFixed(1)}%` : ""}. 과거 실적은 미래를 뜻하지 않습니다.
                </>
              )}
            </p>
            {mode === "history" && <HistoryTable symbols={symbols} hist={hist} windowYears={windowYears} rates={rates} yieldOf={yieldOf} loading={ser.loading} />}
            <details className="mt-4 rounded-lg border border-line px-4 py-3">
              <summary className="text-sm font-semibold text-ink-2">종목별 가정 (분배금 수익률·지급 월·사용자 지정 가격 수익률)</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th className="r">최근 12개월 실제 분배금 수익률</th>
                      <th className="r">분배금 수익률 가정 (연 %)</th>
                      <th>지급 월 (최근 12개월 실제)</th>
                      <th className="r">사용자 지정: 가격 수익률 (연 %)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map((s) => {
                      const inf = info(s);
                      const ms = inf ? inf.monthWeights.map((w, i) => (w > 0 ? i + 1 : 0)).filter(Boolean) : [];
                      return (
                        <tr key={s}>
                          <td className="font-semibold">{s}</td>
                          <td className="r">{inf?.ttmYield !== null && inf?.ttmYield !== undefined ? `${inf.ttmYield.toFixed(2)}%` : "기록 없음"}</td>
                          <td className="r">
                            <input className="input w-24 py-1 text-right" inputMode="decimal" value={yields[s] ?? (inf?.ttmYield !== null && inf?.ttmYield !== undefined ? inf.ttmYield.toFixed(2) : "0")} onChange={(e) => setYields({ ...yields, [s]: e.target.value })} aria-label={`${s} 분배금 수익률 가정`} />
                          </td>
                          <td className="text-xs">{ms.length ? `${ms.join("·")}월` : "지급 기록 없음 (균등 배분)"}</td>
                          <td className="r">
                            <input className="input w-24 py-1 text-right" inputMode="decimal" value={customPrice[s] ?? String(Math.round(priceOfCustom(s) * 100) / 100)} onChange={(e) => setCustomPrice({ ...customPrice, [s]: e.target.value })} aria-label={`${s} 사용자 지정 가격 수익률`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">사용자 지정 가격 수익률을 과거 실적으로 채우기:</span>
                {[5, 10].map((y) => (
                  <button key={y} type="button" className="btn btn-sm" onClick={() => fillHistory(y)} disabled={ser.loading}>
                    최근 {y}년 연환산 가격 수익률
                  </button>
                ))}
                <span className="text-muted">(과거 실적이며 미래를 뜻하지 않음. 레버리지 ETF 는 과거 값이 매우 클 수 있음)</span>
              </div>
            </details>
          </Section>

          <ScenarioResults results={results} scenario={scenario} setScenario={setScenario} focus={focus} setFocus={setFocus} reinvest={reinvest} months={months} taxPct={parseNum(tax)} baseCfg={base} fx={fxNow} onSave={(title, summary) => runs.add({ kind: "future", title, summary, meta: { engine: ENGINE_VERSION, assumptions: [`기간 ${months}개월`, `가정 방식 ${mode}`, `세율 ${tax}%`, `거래 비용 ${cost}%`, `연 비용 ${fee}%`] } })} />
          <Disclaimer>
            예측이 아닌 시나리오 계산이며 수익을 보장하지 않습니다. 계산 기준: 매달 평가금액 × (1 + 연 가격 수익률)^(1/12). 분배금 = 그 달 평가금액 × 연 분배금 수익률 × (그 달 지급 비중). 가격 수익률은 분배금을 뺀 가격 변화이므로 분배금을 따로 더해도 이중 계산이 아닙니다. 세금은 분배금에서 원천징수, 거래 비용은 매수·재투자·리밸런싱 금액에 부과. 분배금은 바뀔 수 있으며 높은 분배금 수익률이 높은 총수익률을 뜻하지 않습니다.
          </Disclaimer>
        </>
      ) : (
        <MonteCarloPanel list={list} base={base} ser={ser} focus={focus} setFocus={setFocus} defaultCenter={neutralRate} onSave={(title, summary) => runs.add({ kind: "montecarlo", title, summary })} />
      )}
    </div>
  );
}

function HistoryTable({ symbols, hist, windowYears, rates, yieldOf, loading }: { symbols: string[]; hist: Record<string, HistoricalReturn | { error: string }>; windowYears: number; rates: Record<ScenarioKey, string>; yieldOf: (s: string) => number; loading: boolean }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="table-basic min-w-[760px]">
        <thead>
          <tr>
            <th>종목</th>
            <th>사용한 기록</th>
            <th className="r">구간 수</th>
            <th className="r">보수적 (하위 25%)</th>
            <th className="r">중립적 (중앙값)</th>
            <th className="r">낙관적 (상위 25%)</th>
            <th className="r">가장 나빴던 / 좋았던 {windowYears}년</th>
            <th className="r">중립 가정의 가격 수익률</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((s) => {
            const h = hist[s];
            if (!h || "error" in h)
              return (
                <tr key={s}>
                  <td className="font-semibold">{s}</td>
                  <td colSpan={7} className="text-xs text-warn">
                    {loading ? "불러오는 중…" : `${h?.error ?? "데이터 없음"} → 이 종목은 같은 총수익률 가정(${rates.conservative}% / ${rates.neutral}% / ${rates.optimistic}%)을 씁니다.`}
                  </td>
                </tr>
              );
            return (
              <tr key={s}>
                <td className="font-semibold">{s}</td>
                <td className="num text-xs">
                  {h.from} ~ {h.to} ({h.years.toFixed(1)}년)
                </td>
                <td className="r">{h.windows}</td>
                <td className={`r ${tone(h.p25)}`}>{pct(h.p25, 1)}</td>
                <td className={`r font-semibold ${tone(h.p50)}`}>{pct(h.p50, 1)}</td>
                <td className={`r ${tone(h.p75)}`}>{pct(h.p75, 1)}</td>
                <td className="r text-xs">
                  <span className={tone(h.worst)}>{pct(h.worst, 1)}</span> / <span className={tone(h.best)}>{pct(h.best, 1)}</span>
                </td>
                <td className={`r ${tone(h.p50 - yieldOf(s))}`}>{pct(h.p50 - yieldOf(s), 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        각 종목의 실제 일봉·분배금 기록으로 {windowYears}년 길이 구간을 한 달씩 옮겨 가며 계산한 연환산 총수익률(분배금 재투자)입니다. 기록이 짧은 종목은 특정 시장 국면(상승장 등)에만 해당할 수 있습니다. 가격 수익률 = 총수익률 − 지금의 분배금 수익률 가정.
      </p>
    </div>
  );
}

function ScenarioResults({ results, scenario, setScenario, focus, setFocus, reinvest, months, taxPct, baseCfg, fx, onSave }: { results: ResultRow[]; scenario: ScenarioId; setScenario: (s: ScenarioId) => void; focus: number; setFocus: (n: number) => void; reinvest: boolean; months: number; taxPct: number; baseCfg: Omit<FutureConfig, "holdings">; fx: number | null; onSave: (t: string, s: { label: string; value: string }[]) => void }) {
  const errs = results.filter((r): r is { p: PortfolioInput; error: string } => "error" in r);
  if (errs.length) return <Notice tone="critical" title="계산하지 않았습니다">{errs.map((e) => `포트폴리오 ${e.p.key}: ${e.error}`).join(" / ")}</Notice>;
  const ok = results as { p: PortfolioInput; per: PerScenario }[];
  const f = ok[Math.min(focus, ok.length - 1)];
  const sel = f.per[scenario].res;
  const scenSeg = <Seg label="시나리오" value={scenario} onChange={setScenario} options={SCEN.map((s) => ({ v: s, l: SCEN_KO[s] }))} />;
  const symIncome = (r: FutureResult) =>
    r.perHolding
      .filter((h) => h.incomeNet > 0)
      .map((h) => `${h.symbol} ${usd(h.incomeNet, 0)}`)
      .join(" · ") || "없음";

  const scenarioTable = (
    <div className="overflow-x-auto">
      <table className="table-basic min-w-[560px]">
        <thead>
          <tr>
            <th />
            {SCEN.map((s) => (
              <th key={s} className="r">
                {SCEN_KO[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["기간 종료 시 예상 자산", (r: FutureResult) => <b>{usd(r.finalValue, 0)}</b>],
              ["총 납입 원금", (r: FutureResult) => usd(r.totalContributed, 0)],
              ["예상 손익", (r: FutureResult) => <span className={tone(r.profit)}>{usd(r.profit, 0)}</span>],
              ["예상 수익률 (원금 대비)", (r: FutureResult) => <span className={tone(r.returnPct)}>{pct(r.returnPct)}</span>],
              ["가격 변화 손익", (r: FutureResult) => <span className={tone(r.priceGainTotal)}>{usd(r.priceGainTotal, 0)}</span>],
              ["분배금 합계 (세전)", (r: FutureResult) => usd(r.incomeGrossTotal, 0)],
              ["분배금 합계 (세후)", (r: FutureResult) => usd(r.incomeNetTotal, 0)],
              ["└ 종목별 (세후)", (r: FutureResult) => <span className="text-[11px] text-ink-2">{symIncome(r)}</span>],
              ["거래 비용 합계", (r: FutureResult) => usd(r.costs, 0)],
              ["마지막 12개월 월평균 분배금 (세후)", (r: FutureResult) => usd(r.avgMonthlyIncomeNet)],
            ] as [string, (r: FutureResult) => ReactNode][]
          ).map(([label, fn]) => (
            <tr key={label}>
              <th className="text-left font-normal text-ink-2">{label}</th>
              {SCEN.map((s) => (
                <td key={s} className="r">
                  {fn(f.per[s].res)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th className="text-left font-normal text-ink-2">{reinvest ? "재투자하지 않으면" : "재투자하면"} 예상 자산</th>
            {SCEN.map((s) => (
              <td key={s} className="r">
                {usd(f.per[s].alt.finalValue, 0)}{" "}
                <span className={`text-[11px] ${tone(f.per[s].res.finalValue - f.per[s].alt.finalValue)}`}>
                  ({reinvest ? "재투자 효과 " : "차이 "}
                  {usd(Math.abs(f.per[s].res.finalValue - f.per[s].alt.finalValue), 0)})
                </span>
              </td>
            ))}
          </tr>
          <tr>
            <th className="text-left font-normal text-ink-2">적용한 가정 (가격 / 분배금, 연 %)</th>
            {SCEN.map((s) => (
              <td key={s} className="r text-[11px] text-ink-2">
                {f.per[s].holdings.map((h) => (
                  <span key={h.symbol} className="block whitespace-nowrap" title={f.per[s].basis[h.symbol]}>
                    {h.symbol} {h.priceReturnPct.toFixed(1)} / {h.yieldPct.toFixed(1)}
                    {f.per[s].basis[h.symbol]?.startsWith("기록 부족") && <span className="text-warn"> *</span>}
                  </span>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {SCEN.some((s) => Object.values(f.per[s].basis).some((b) => b.startsWith("기록 부족"))) && <p className="mt-1 text-[11px] text-warn">* 과거 기록이 부족해 같은 총수익률 가정을 쓴 종목</p>}
    </div>
  );

  const monthlyChart = (
    <div>
      <p className="mb-2 text-xs text-ink-2">점선은 누적 납입 원금</p>
      <SimLineChart
        dates={f.per.neutral.res.months.map((m) => m.ym)}
        lines={[...SCEN.map((s, i) => ({ key: s, label: SCEN_KO[s], values: f.per[s].res.months.map((m) => m.value), color: SERIES_VARS[i] })), { key: "c", label: "납입 원금", values: f.per.neutral.res.months.map((m) => m.contributed), dashed: true, color: "--axis" }]}
        format="usd"
        ariaLabel="시나리오별 월별 예상 자산"
      />
    </div>
  );

  const yearlyPanel = (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">{SCEN_KO[scenario]} 가정 · 연말 평가금액 = 연초 + 납입 + 가격 변화 + 세후 분배금 − 비용</p>
        <div className="flex flex-wrap gap-2">
          {scenSeg}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              downloadCsv(`future-${f.p.key}-${scenario}-monthly.csv`, [
                ["월", "평가금액", "누적 납입 원금", "그 달 납입", "그 달 가격 변화", "분배금 세전", "분배금 세후", "현금(미재투자 분배금)"],
                ...sel.months.map((m) => [m.ym, m.value, m.contributed, m.contribution, m.priceGainMonth, m.incomeGross, m.incomeNet, m.cash]),
              ])
            }
          >
            월별 CSV 저장
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[980px]">
          <thead>
            <tr>
              <th>연도</th>
              <th className="r">개월</th>
              <th className="r">연초 평가금액</th>
              <th className="r">납입</th>
              <th className="r">가격 변화</th>
              <th className="r">분배금 (세전)</th>
              <th className="r">세금</th>
              <th className="r">분배금 (세후)</th>
              <th className="r">{reinvest ? "재투자" : "현금으로 쌓임"}</th>
              <th className="r">비용</th>
              <th className="r">연말 평가금액</th>
              <th className="r">누적 원금 대비</th>
            </tr>
          </thead>
          <tbody>
            {sel.yearly.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="r">{y.months}</td>
                <td className="r">{usd(y.startValue, 0)}</td>
                <td className="r">{usd(y.contributions, 0)}</td>
                <td className={`r ${tone(y.priceGain)}`}>{usd(y.priceGain, 0)}</td>
                <td className="r">{usd(y.incomeGross, 0)}</td>
                <td className="r text-ink-2">{usd(y.incomeTax, 0)}</td>
                <td className="r">{usd(y.incomeNet, 0)}</td>
                <td className="r">{usd(reinvest ? y.reinvested : y.incomeNet, 0)}</td>
                <td className="r text-ink-2">{usd(y.costs, 0)}</td>
                <td className="r font-semibold">{usd(y.endValue, 0)}</td>
                <td className={`r ${tone(y.endValue - y.contributed)}`}>{pct(y.contributed > 0 ? (y.endValue / y.contributed - 1) * 100 : 0, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const years = [...new Set(sel.perHolding.flatMap((h) => h.years.map((y) => y.year)))].sort();
  const incomePanel = (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">과거 실제 지급 월 비중대로 배분한 가정치 · 세금 {taxPct}% 가정</p>
        {scenSeg}
      </div>
      <BarChartSvg points={sel.months.map((m) => ({ label: m.ym, value: m.incomeGross, sub: `세후 ${usd(m.incomeNet)}` }))} valueFormat="usd2" ariaLabel="예상 월별 분배금" />
      <p className="mb-1 mt-4 text-xs font-semibold text-ink-2">종목별 분배금 (기간 합계)</p>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">분배금 (세전)</th>
              <th className="r">세후</th>
              <th className="r">비중</th>
              <th className="r">기간 말 평가금액</th>
            </tr>
          </thead>
          <tbody>
            {sel.perHolding.map((h) => (
              <tr key={h.symbol}>
                <td className="font-semibold">{h.symbol}</td>
                <td className="r">{usd(h.incomeGross)}</td>
                <td className="r">{usd(h.incomeNet)}</td>
                <td className="r">{sel.incomeGrossTotal > 0 ? `${((h.incomeGross / sel.incomeGrossTotal) * 100).toFixed(1)}%` : "-"}</td>
                <td className="r">{usd(h.value, 0)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>합계</td>
              <td className="r">{usd(sel.incomeGrossTotal)}</td>
              <td className="r">{usd(sel.incomeNetTotal)}</td>
              <td className="r">100%</td>
              <td className="r">{usd(sel.perHolding.reduce((a, h) => a + h.value, 0), 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mb-1 mt-4 text-xs font-semibold text-ink-2">연도별 · 종목별 분배금 (세후)</p>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>연도</th>
              {sel.perHolding.map((h) => (
                <th key={h.symbol} className="r">
                  {h.symbol}
                </th>
              ))}
              <th className="r">합계 (세후)</th>
              <th className="r">월평균</th>
            </tr>
          </thead>
          <tbody>
            {years.map((yr) => {
              const row = sel.perHolding.map((h) => h.years.find((y) => y.year === yr)?.net ?? 0);
              const tot = row.reduce((a, b) => a + b, 0);
              const mcount = sel.yearly.find((y) => y.year === yr)?.months ?? 12;
              return (
                <tr key={yr}>
                  <td>{yr}</td>
                  {row.map((v, i) => (
                    <td key={i} className="r">
                      {usd(v)}
                    </td>
                  ))}
                  <td className="r font-semibold">{usd(tot)}</td>
                  <td className="r text-ink-2">
                    {usd(tot / mcount)} <span className="text-[10px]">({mcount}개월)</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const comparePanel = (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2">같은 기간·조건, {SCEN_KO[scenario]} 가정</p>
        {scenSeg}
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>포트폴리오</th>
              <th className="r">예상 자산</th>
              <th className="r">예상 수익률</th>
              <th className="r">가격 변화 손익</th>
              <th className="r">분배금 합계(세후)</th>
              <th>종목별 분배금 (세후)</th>
              <th className="r">월평균 분배금(세후, 마지막 12개월)</th>
            </tr>
          </thead>
          <tbody>
            {ok.map((r, i) => {
              const x = r.per[scenario].res;
              return (
                <tr key={r.p.key}>
                  <td>
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${SERIES_VARS[i]})` }} />
                    {r.p.key}. {r.p.name}
                  </td>
                  <td className="r font-semibold">{usd(x.finalValue, 0)}</td>
                  <td className={`r ${tone(x.returnPct)}`}>{pct(x.returnPct)}</td>
                  <td className={`r ${tone(x.priceGainTotal)}`}>{usd(x.priceGainTotal, 0)}</td>
                  <td className="r">{usd(x.incomeNetTotal, 0)}</td>
                  <td className="text-xs text-ink-2">{symIncome(x)}</td>
                  <td className="r">{usd(x.avgMonthlyIncomeNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <Section
      title="4. 결과"
      description={`${months}개월 뒤 기준 · 예측이 아닌 가정 계산`}
      right={
        <div className="flex flex-wrap gap-2">
          <Seg label="포트폴리오" value={focus} onChange={setFocus} options={ok.map((r, i) => ({ v: i, l: r.p.key }))} />
          <button type="button" className="btn btn-sm" onClick={() => onSave(`미래 시나리오 ${months}개월 · ${f.p.name}`, SCEN.map((s) => ({ label: `${SCEN_KO[s]} 예상 자산`, value: usd(f.per[s].res.finalValue, 0) })))}>
            결과 저장
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm font-semibold">
        {f.p.key}. {f.p.name}
      </p>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SCEN.map((sc, i) => {
          const r = f.per[sc].res;
          return (
            <div key={sc} className="rounded-xl border border-line p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${SERIES_VARS[i]})` }} />
                {SCEN_KO[sc]}
              </p>
              <p className="num mt-1 text-xl font-bold">{usd(r.finalValue, 0)}</p>
              <p className={`num text-xs font-semibold ${tone(r.returnPct)}`}>원금 대비 {pct(r.returnPct, 1)}</p>
              <p className="num mt-1 text-[11px] text-muted">마지막 12개월 월 분배금(세후) {usd(r.avgMonthlyIncomeNet, 0)}</p>
            </div>
          );
        })}
      </div>
      <PanelTabs
        label="시나리오 결과"
        tabs={[
          { key: "table", label: "시나리오 비교", content: scenarioTable },
          { key: "yearly", label: "연도별 상세", content: yearlyPanel },
          { key: "chart", label: "월별 자산", content: monthlyChart },
          { key: "income", label: "분배금 (종목별)", content: incomePanel },
          { key: "compare", label: "포트폴리오 비교", content: comparePanel },
          { key: "sens", label: "가정 민감도", content: <SensitivityPanel cfg={{ ...baseCfg, holdings: f.per[scenario].holdings }} fx={fx} name={`${f.p.key}. ${f.p.name} · ${SCEN_KO[scenario]}`} /> },
        ]}
      />
    </Section>
  );
}

type McRow = { p: PortfolioInput; r?: MonteCarloResult; alt?: MonteCarloResult; error?: string };

function MonteCarloPanel({
  list,
  base,
  ser,
  focus,
  setFocus,
  defaultCenter,
  onSave,
}: {
  list: PortfolioInput[];
  base: Omit<FutureConfig, "holdings">;
  ser: ReturnType<typeof useSeriesMap>;
  focus: number;
  setFocus: (n: number) => void;
  defaultCenter: number;
  onSave: (t: string, s: { label: string; value: string }[]) => void;
}) {
  const [lookback, setLookback] = useState<number | null>(null);
  const [paths, setPaths] = useState("2000");
  const [block, setBlock] = useState("6");
  const [seed, setSeed] = useState("42");
  const [centerMode, setCenterMode] = useState<"past" | "center">("past");
  const [center, setCenter] = useState(String(defaultCenter || 7));
  const [target, setTarget] = useState("");
  const [out, setOut] = useState<McRow[] | null>(null);
  const run = () => {
    const res = list.map((p): McRow => {
      const pr = rowsProblem(p.rows);
      if (pr) return { p, error: pr };
      const items = rowsToItems(p.rows);
      const sum = items.reduce((a, b) => a + b.weight, 0);
      if (Math.abs(sum - 100) > 0.01) return { p, error: `비중 합계가 ${sum}%입니다.` };
      const xs = items.map((i) => ser.series[i.symbol]);
      if (xs.some((x) => !x)) return { p, error: "가격 데이터를 불러오지 못한 종목이 있습니다." };
      const h = monthlyHistory(xs as NonNullable<(typeof xs)[number]>[], lookback);
      if ("error" in h) return { p, error: h.error };
      const cfg = { ...base, holdings: items, paths: Math.round(parseNum(paths)), blockMonths: Math.round(parseNum(block)), seed: Math.round(parseNum(seed)) || 1, centerAnnualPct: centerMode === "center" ? parseNum(center) : null };
      if (!(cfg.months >= 1)) return { p, error: "기간을 확인하세요." };
      const r = runMonteCarlo(cfg, h);
      if ("error" in r) return { p, error: r.error };
      const alt = runMonteCarlo({ ...cfg, reinvest: !cfg.reinvest }, h);
      return { p, r, alt: "error" in alt ? undefined : alt };
    });
    setOut(res);
  };
  const f = out?.[Math.min(focus, (out?.length ?? 1) - 1)];
  const tgt = parseNum(target);
  const hasTarget = target.trim() !== "" && tgt > 0;
  const firstOk = out?.find((x) => x.r)?.r;

  const warnings = (r: MonteCarloResult): string[] => {
    const w: string[] = [];
    if (r.history.count < 120) w.push(`뽑는 데 쓴 과거 기록이 ${r.history.count}개월(약 ${(r.history.count / 12).toFixed(1)}년)뿐이라 특정 시장 국면에 치우칠 수 있습니다.`);
    if (r.sample.mddPct > -25) w.push(`표본 기간의 최대 낙폭이 ${r.sample.mddPct.toFixed(1)}%로 큰 하락장이 거의 없어 하락 위험이 작게 나올 수 있습니다.`);
    if (r.centeredAt === null && r.sample.annualPct > 12) w.push(`표본 기간 연 수익률이 ${r.sample.annualPct.toFixed(1)}%로 높아 결과가 낙관적으로 나올 수 있습니다. '평균만 조정'으로 함께 비교해 보세요.`);
    return w;
  };

  const detailTabs = f?.r
    ? [
        {
          key: "dist",
          label: "분포 차트",
          content: (
            <div>
              <SimLineChart
                dates={f.r.months}
                lines={[
                  { key: "p95", label: "상위 5%", values: f.r.bands.p95, color: "--s3", dashed: true },
                  { key: "p75", label: "상위 25%", values: f.r.bands.p75, color: "--s3" },
                  { key: "p50", label: "중앙값", values: f.r.bands.p50, color: "--s1" },
                  { key: "p25", label: "하위 25%", values: f.r.bands.p25, color: "--s2" },
                  { key: "p5", label: "하위 5%", values: f.r.bands.p5, color: "--s2", dashed: true },
                  { key: "c", label: "납입 원금", values: f.r.contributed, color: "--axis", dashed: true },
                ]}
                format="usd"
                ariaLabel="몬테카를로 경로 분포"
              />
              {f.alt && (
                <p className="mt-2 text-sm">
                  분배금을 {base.reinvest ? "재투자하지 않으면" : "재투자하면"} 중앙값 {usd(f.alt.final.p50, 0)} (현재 설정 {usd(f.r.final.p50, 0)}, 차이 <span className={tone(f.r.final.p50 - f.alt.final.p50)}>{usd(f.r.final.p50 - f.alt.final.p50, 0)}</span>)
                </p>
              )}
            </div>
          ),
        },
        {
          key: "years",
          label: "연도별 분위수",
          content: (
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>시점</th>
                    <th className="r">누적 원금</th>
                    <th className="r">하위 5%</th>
                    <th className="r">하위 25%</th>
                    <th className="r">중앙값</th>
                    <th className="r">상위 25%</th>
                    <th className="r">상위 5%</th>
                  </tr>
                </thead>
                <tbody>
                  {f.r.yearEnd.map((y) => (
                    <tr key={y.month}>
                      <td>
                        {y.month % 12 === 0 ? `${y.month / 12}년 뒤` : `${y.month}개월 뒤`} <span className="text-[11px] text-muted">({y.ym})</span>
                      </td>
                      <td className="r text-ink-2">{usd(y.contributed, 0)}</td>
                      <td className={`r ${y.p5 < y.contributed ? "text-down" : ""}`}>{usd(y.p5, 0)}</td>
                      <td className="r">{usd(y.p25, 0)}</td>
                      <td className="r font-semibold">{usd(y.p50, 0)}</td>
                      <td className="r">{usd(y.p75, 0)}</td>
                      <td className="r">{usd(y.p95, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted">각 시점마다 {f.r.paths.toLocaleString()}개 경로의 평가금액을 줄 세운 위치입니다 (같은 경로를 이은 선이 아님).</p>
            </div>
          ),
        },
        {
          key: "deciles",
          label: "최종 금액 10분위",
          content: (
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>분위</th>
                    {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((q) => (
                      <th key={q} className="r">
                        {q}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-ink-2">최종 평가금액</td>
                    {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((q) => (
                      <td key={q} className="r">
                        {usd(quantile(f.r!.finalsSorted, q / 100), 0)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted">예: 10% 열 = 경로 10%가 이 금액보다 적게 끝남. 총 납입 원금 {usd(f.r.totalContributed, 0)}.</p>
            </div>
          ),
        },
        {
          key: "income",
          label: "분배금 (종목별)",
          content: (
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th className="r">세후 분배금 합계 (중앙값)</th>
                  </tr>
                </thead>
                <tbody>
                  {f.r.incomeBySymbol.map((x) => (
                    <tr key={x.symbol}>
                      <td className="font-semibold">{x.symbol}</td>
                      <td className="r">{usd(x.p50, 0)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>포트폴리오 전체 (중앙값)</td>
                    <td className="r">{usd(f.r.income.p50, 0)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-sm">
                마지막 12개월 월평균 세후 분배금: 하위 5% {usd(f.r.lastYearMonthlyIncome.p5, 0)} · 중앙값 <b>{usd(f.r.lastYearMonthlyIncome.p50, 0)}</b> · 상위 5% {usd(f.r.lastYearMonthlyIncome.p95, 0)}
              </p>
              <p className="mt-1 text-[11px] text-muted">종목별 중앙값은 종목마다 따로 줄 세운 값이라 더해도 전체 중앙값과 같지 않습니다.</p>
            </div>
          ),
        },
      ]
    : [];

  return (
    <>
      <Section title="3. 몬테카를로 설정" description={`과거 실제 월별 수익률(가격·분배금)을 무작위로 다시 뽑아 여러 경로를 만듭니다. 모든 종목에 공통으로 있는 기간만 쓰며, 공통 데이터가 ${MC_MIN_MONTHS}개월 미만이면 실행하지 않습니다.`}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="사용할 과거 기간">
            <Seg label="사용할 과거 기간" value={lookback ?? 0} onChange={(v) => setLookback(v || null)} options={[{ v: 0, l: "공통 전체" }, { v: 20, l: "최근 20년" }, { v: 10, l: "최근 10년" }, { v: 5, l: "최근 5년" }]} />
          </Field>
          <Field label="평균 수익률" hint={centerMode === "past" ? "과거 수익률을 그대로 다시 뽑음" : "변동성·분포 모양은 과거 그대로, 평균만 입력한 연 수익률로 맞춤"}>
            <Seg
              label="평균 수익률"
              value={centerMode}
              onChange={setCenterMode}
              options={[
                { v: "past", l: "과거 그대로" },
                { v: "center", l: "평균만 조정" },
              ]}
            />
          </Field>
          {centerMode === "center" && (
            <Field label="맞출 연 총수익률 (%)">
              <input className="input w-24" inputMode="decimal" value={center} onChange={(e) => setCenter(e.target.value)} aria-label="맞출 연 총수익률" />
            </Field>
          )}
          <Field label="목표 금액 (선택, USD)" hint="최종 평가금액이 이 금액 이상일 확률">
            <input className="input w-32" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="예: 200000" aria-label="목표 금액" />
          </Field>
        </div>
        <details className="mt-3 rounded-lg border border-line px-4 py-2">
          <summary className="text-xs font-semibold text-ink-2">
            고급 설정 <span className="font-normal text-muted">경로 {paths} · 묶음 {block}개월 · 시드 {seed}</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <Field label="경로 수">
              <input className="input w-24" inputMode="numeric" value={paths} onChange={(e) => setPaths(e.target.value)} aria-label="경로 수" />
            </Field>
            <Field label="묶음 길이 (개월)" hint="연속된 달을 함께 뽑아 추세·변동성 군집을 일부 보존 (최대 12)">
              <input className="input w-20" inputMode="numeric" value={block} onChange={(e) => setBlock(e.target.value)} aria-label="묶음 길이" />
            </Field>
            <Field label="난수 시드" hint="같은 시드 = 같은 결과">
              <input className="input w-20" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="난수 시드" />
            </Field>
          </div>
        </details>
        <button type="button" className="btn btn-primary mt-3" onClick={run} disabled={ser.loading}>
          {ser.loading ? "가격 데이터 불러오는 중…" : "몬테카를로 실행"}
        </button>
      </Section>
      {out && (
        <Section
          title="4. 확률적 결과"
          description={`${base.months}개월 뒤 기준 · ${firstOk && firstOk.centeredAt !== null ? `평균만 연 ${firstOk.centeredAt}%로 조정` : "과거 수익률 그대로"}`}
          right={
            <div className="flex gap-2">
              <Seg label="포트폴리오" value={focus} onChange={setFocus} options={out.map((x, i) => ({ v: i, l: x.p.key }))} />
              {f?.r && (
                <button type="button" className="btn btn-sm" onClick={() => onSave(`몬테카를로 ${base.months}개월 · ${f.p.name}`, [{ label: "중앙값", value: usd(f.r!.final.p50, 0) }, { label: "하위 5%", value: usd(f.r!.final.p5, 0) }, { label: "원금 손실 확률", value: `${f.r!.lossProbPct.toFixed(1)}%` }])}>
                  결과 저장
                </button>
              )}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[1080px]">
              <thead>
                <tr>
                  <th>포트폴리오</th>
                  <th className="r">하위 5%</th>
                  <th className="r">하위 25%</th>
                  <th className="r">중앙값</th>
                  <th className="r">상위 25%</th>
                  <th className="r">상위 5%</th>
                  <th className="r">연환산 수익률 (중앙값, 5~95%)</th>
                  <th className="r">원금 손실 확률</th>
                  {hasTarget && <th className="r">목표 {usd(tgt, 0)} 이상</th>}
                  <th className="r">최대 낙폭 (중앙값)</th>
                  <th>사용한 과거 기간 (표본 자체 연 수익률·최대 낙폭)</th>
                </tr>
              </thead>
              <tbody>
                {out.map((x) =>
                  x.r ? (
                    <tr key={x.p.key}>
                      <td>
                        {x.p.key}. {x.p.name}
                      </td>
                      <td className="r">{usd(x.r.final.p5, 0)}</td>
                      <td className="r">{usd(x.r.final.p25, 0)}</td>
                      <td className="r font-semibold">{usd(x.r.final.p50, 0)}</td>
                      <td className="r">{usd(x.r.final.p75, 0)}</td>
                      <td className="r">{usd(x.r.final.p95, 0)}</td>
                      <td className="r">
                        <span className={tone(x.r.cagr.p50)}>{pct(x.r.cagr.p50, 1)}</span>
                        <span className="block text-[11px] text-muted">
                          {pct(x.r.cagr.p5, 1)} ~ {pct(x.r.cagr.p95, 1)}
                          {!x.r.cagr.annualized && " (누적)"}
                        </span>
                      </td>
                      <td className="r">{x.r.lossProbPct.toFixed(1)}%</td>
                      {hasTarget && <td className="r font-semibold">{probAtLeast(x.r.finalsSorted, tgt).toFixed(1)}%</td>}
                      <td className="r text-down">{pct(x.r.medianMddPct, 1)}</td>
                      <td className="num text-xs">
                        {x.r.history.first} ~ {x.r.history.last} ({x.r.history.count}개월)
                        <span className="block text-muted">
                          표본 연 {pct(x.r.sample.annualPct, 1)} · 최대 낙폭 {pct(x.r.sample.mddPct, 1)}
                          {x.r.sample.worst12mPct !== null && ` · 최악 12개월 ${pct(x.r.sample.worst12mPct, 1)}`}
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={x.p.key}>
                      <td>
                        {x.p.key}. {x.p.name}
                      </td>
                      <td colSpan={hasTarget ? 10 : 9} className="text-xs text-warn">
                        실행하지 않음: {x.error}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted">총 납입 원금 {f?.r ? usd(f.r.totalContributed, 0) : "-"}. &apos;원금 손실 확률&apos; = 최종 평가금액이 총 납입 원금보다 작은 경로의 비율. 연환산 수익률은 납입 영향을 뺀 시간가중 기준.</p>
          {f?.r && warnings(f.r).length > 0 && (
            <div className="mt-3">
              <Notice tone="warn" title={`${f.p.key}. 결과를 읽을 때 주의`}>
                {warnings(f.r).join(" ")}
              </Notice>
            </div>
          )}
          {f?.r && (
            <div className="mt-4">
              <PanelTabs label="몬테카를로 상세" tabs={detailTabs} />
            </div>
          )}
          <Disclaimer>과거 월별 수익률을 다시 섞어 만든 가능한 경로들의 분포입니다. 앞으로도 과거와 비슷한 분포가 나온다는 가정에 기대며, 과거에 없던 상황(더 큰 폭락 등)은 반영되지 않습니다. &apos;평균만 조정&apos;은 과거의 변동성·분포 모양과 종목 간 움직임은 그대로 두고 평균 수익률만 입력값으로 옮긴 계산입니다. 짧은 기간의 데이터만 있는 ETF 는 결과가 특정 시장 국면에 치우칠 수 있습니다.</Disclaimer>
        </Section>
      )}
    </>
  );
}

/** 가정 하나씩 바꿔 다시 계산 — 결과가 어떤 가정에 가장 민감한지 */
function SensitivityPanel({ cfg, fx, name }: { cfg: FutureConfig; fx: number | null; name: string }) {
  const { base, rows } = useMemo(() => futureSensitivity(cfg, { fx }), [cfg, fx]);
  const sorted = [...rows].sort((a, b) => Math.abs(b.diffValuePct) - Math.abs(a.diffValuePct));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-2">
        {name} · 기준: 기간 말 {usd(base.finalValue, 0)}, 마지막 12개월 월 분배금(세후) {usd(base.avgMonthlyIncomeNet, 0)}. 한 번에 가정 하나만 바꾸고 나머지는 그대로 둔 결과입니다 (영향이 큰 순).
      </p>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>바꾼 가정</th>
              <th className="r">기간 말 자산</th>
              <th className="r">차이</th>
              <th className="r">월 분배금 (세후)</th>
              <th className="r">차이</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key}>
                <td>
                  <p className="font-semibold">{r.label}</p>
                  <p className="text-[11px] text-muted">{r.change}</p>
                </td>
                <td className="r num">{r.key.startsWith("fx") ? `${krw(base.finalValue * (fx ?? 0) * (1 + r.diffValuePct / 100))}` : usd(r.finalValue, 0)}</td>
                <td className={`r num ${tone(r.diffValuePct)}`}>
                  {r.key.startsWith("fx") ? "" : `${usd(r.diffValue, 0)} `}({pct(r.diffValuePct, 1)})
                </td>
                <td className="r num">{usd(r.monthlyIncomeNet, 0)}</td>
                <td className={`r num ${tone(r.diffIncome)}`}>{usd(r.diffIncome, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">가정에 따른 계산이며 미래 수익을 보장하지 않습니다. 여러 가정이 함께 나빠지면 영향은 이보다 클 수 있습니다 (스트레스 테스트·위험 예산 참고).</p>
    </div>
  );
}
