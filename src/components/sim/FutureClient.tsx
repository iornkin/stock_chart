"use client";
/** 미래 포트폴리오 시뮬레이터 — 가정에 따른 시나리오 계산과 과거 수익률 기반 몬테카를로 (예측 아님) */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useIncome, usePortfolio, useRuns, useSeriesMap, useStrategies } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import {
  DEFAULT_TOTAL_RETURN,
  historicalPriceCagr,
  monthlyHistory,
  runFuture,
  runMonteCarlo,
  SCENARIO_KO,
  scenarioHoldings,
  validateFuture,
  MC_MIN_MONTHS,
  type AssumptionMode,
  type FutureConfig,
  type FutureHolding,
  type FutureResult,
  type MonteCarloResult,
  type ScenarioKey,
} from "@/lib/sim/future";
import { REBALANCE_KO, type Rebalance } from "@/lib/sim/backtest";
import { Notice, Section } from "@/components/ui";
import { Disclaimer, Field, parseNum, pct, rowsFrom, rowsProblem, rowsToItems, Seg, tone, usd } from "./common";
import { SimLineChart, SERIES_VARS } from "./charts";
import PortfolioInputs, { defaultPortfolios, type PortfolioInput } from "./PortfolioInputs";
import BarChartSvg from "@/components/BarChartSvg";

const PERIODS = [
  { m: 1, l: "1개월" },
  { m: 3, l: "3개월" },
  { m: 6, l: "6개월" },
  { m: 12, l: "1년" },
  { m: 36, l: "3년" },
  { m: 60, l: "5년" },
];

type ScenarioId = ScenarioKey | "custom";
const SCEN: ScenarioId[] = ["conservative", "neutral", "optimistic", "custom"];
const SCEN_KO: Record<ScenarioId, string> = { ...SCENARIO_KO, custom: "사용자 지정" };

function nextMonthYm(): string {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function FutureClient() {
  const [tab, setTab] = useState<"scenario" | "mc">("scenario");
  const [list, setList] = useState<PortfolioInput[]>(defaultPortfolios(3));
  const [periodMode, setPeriodMode] = useState<number | "custom">(60);
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
  const [mode, setMode] = useState<AssumptionMode>("total");
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

  useEffect(() => {
    if (!strategies.loaded) return;
    const id = new URLSearchParams(window.location.search).get("strategy");
    const s = id ? strategies.value.find((x) => x.id === id) : null;
    if (s) setList((l) => [{ key: "A", name: s.name, rows: rowsFrom(s.items) }, ...l.slice(1)]);
  }, [strategies.loaded, strategies.value]);

  const months = periodMode === "custom" ? Math.round(parseNum(cy) * 12 + parseNum(cm)) : periodMode;
  const symbols = useMemo(() => [...new Set(list.flatMap((p) => rowsToItems(p.rows).map((i) => i.symbol)))].filter((s) => !rowsProblem([{ symbol: s, weight: "1" }])), [list]);
  const ser = useSeriesMap(symbols);

  const info = (s: string) => income.data?.items[s];
  const yieldOf = (s: string) => {
    if (yields[s] !== undefined && yields[s] !== "") return parseNum(yields[s]);
    return info(s)?.ttmYield ?? 0;
  };
  const neutralRate = parseNum(rates.neutral);
  const priceOfCustom = (s: string) => (customPrice[s] !== undefined && customPrice[s] !== "" ? parseNum(customPrice[s]) : mode === "total" ? neutralRate - yieldOf(s) : neutralRate);

  const loadMine = () => {
    if (mine.empty || mine.missingPrices.length || !mine.holdings.length) return;
    const total = mine.marketValue;
    setList((l) => [{ key: "A", name: "내 자산 (현재 보유 비중)", rows: mine.holdings.map((h) => ({ symbol: h.symbol, weight: String(Math.round(((h.value ?? 0) / total) * 10000) / 100) })) }, ...l.slice(1)]);
    setInitial(String(Math.round(total * 100) / 100));
  };

  const base = { months, startYm: nextMonthYm(), initial: parseNum(initial), monthly: parseNum(monthly), timing, reinvest, rebalance, costPct: parseNum(cost), taxPct: parseNum(tax), feePct: parseNum(fee) };

  const results = useMemo(() => {
    return list.map((p) => {
      const problem = rowsProblem(p.rows);
      if (problem) return { p, error: problem };
      const items = rowsToItems(p.rows);
      const b = items.map((i) => ({ symbol: i.symbol, weight: i.weight, yieldPct: yieldOf(i.symbol), monthWeights: info(i.symbol)?.monthWeights }));
      const per: Partial<Record<ScenarioId, { holdings: FutureHolding[]; res: FutureResult; alt: FutureResult }>> = {};
      for (const sc of SCEN) {
        const holdings: FutureHolding[] = sc === "custom" ? b.map((x) => ({ ...x, priceReturnPct: priceOfCustom(x.symbol) })) : scenarioHoldings(b, mode, parseNum(rates[sc]));
        const cfg: FutureConfig = { ...base, holdings };
        const err = validateFuture(cfg);
        if (err) return { p, error: err };
        per[sc] = { holdings, res: runFuture(cfg), alt: runFuture({ ...cfg, reinvest: !cfg.reinvest }) };
      }
      return { p, per: per as Record<ScenarioId, { holdings: FutureHolding[]; res: FutureResult; alt: FutureResult }> };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, months, initial, monthly, timing, reinvest, rebalance, cost, tax, fee, mode, rates, yields, customPrice, income.data]);

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

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="warn" title="예측이 아닌 시나리오 계산입니다">미래의 가격과 분배금은 확정할 수 없습니다. 아래 결과는 입력한 가정(또는 과거 수익률 분포)을 그대로 적용한 계산이며, 수익을 보장하지 않습니다.</Notice>
      <Section title="1. 포트폴리오" right={!mine.empty && !mine.missingPrices.length ? <button type="button" className="btn btn-sm" onClick={loadMine}>내 자산에서 불러오기</button> : undefined}>
        <PortfolioInputs list={list} onChange={setList} max={3} />
      </Section>

      <Section title="2. 기간과 투자 조건" description="시작 시점은 다음 달 초입니다. 기간은 직접 입력할 수 있습니다.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="기간">
            <div className="seg" role="group" aria-label="기간">
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
          <Field label="거래 비용 (%)">
            <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="거래 비용" />
          </Field>
          <Field label="분배금 세금 (%)">
            <input className="input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
          </Field>
          <Field label="추가 연간 비용 (%)" hint="가정 수익률에 보수가 이미 들어 있으면 0">
            <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="추가 연간 비용" />
          </Field>
        </div>
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

      {tab === "scenario" ? (
        <>
          <Section
            title="3. 수익률 가정"
            description={
              mode === "total"
                ? "총수익률 기준: 모든 종목의 연 총수익률을 같게 두고, 가격 수익률 = 총수익률 − 분배금 수익률로 정합니다. 분배금이 높다고 총수익이 높아지지 않는 중립적 가정입니다."
                : "가격 수익률 기준: 모든 종목의 가격이 같은 비율로 오른다고 보고 분배금을 더합니다. 분배금이 높은 종목이 유리하게 나오는 가정이니 주의하세요."
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="가정 방식">
                <Seg label="가정 방식" value={mode} onChange={setMode} options={[{ v: "total", l: "총수익률 고정" }, { v: "price", l: "가격 수익률 고정" }]} />
              </Field>
              {(["conservative", "neutral", "optimistic"] as ScenarioKey[]).map((k) => (
                <Field key={k} label={`${SCENARIO_KO[k]} (연 %)`}>
                  <input className="input w-24" inputMode="decimal" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} aria-label={`${SCENARIO_KO[k]} 가정 수익률`} />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">기본값 2% / 5% / 8%는 계산을 위한 임의의 가정이며 예측값이 아닙니다. 직접 바꿔 쓰세요.</p>
            <div className="mt-4 overflow-x-auto">
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
                    const months = inf ? inf.monthWeights.map((w, i) => (w > 0 ? i + 1 : 0)).filter(Boolean) : [];
                    return (
                      <tr key={s}>
                        <td className="font-semibold">{s}</td>
                        <td className="r">{inf?.ttmYield !== null && inf?.ttmYield !== undefined ? `${inf.ttmYield.toFixed(2)}%` : "기록 없음"}</td>
                        <td className="r">
                          <input className="input w-24 py-1 text-right" inputMode="decimal" value={yields[s] ?? (inf?.ttmYield !== null && inf?.ttmYield !== undefined ? inf.ttmYield.toFixed(2) : "0")} onChange={(e) => setYields({ ...yields, [s]: e.target.value })} aria-label={`${s} 분배금 수익률 가정`} />
                        </td>
                        <td className="text-xs">{months.length ? `${months.join("·")}월` : "지급 기록 없음 (균등 배분)"}</td>
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
          </Section>

          <ScenarioResults results={results} scenario={scenario} setScenario={setScenario} focus={focus} setFocus={setFocus} reinvest={reinvest} months={months} onSave={(title, summary) => runs.add({ kind: "future", title, summary })} />
          <Disclaimer>
            계산 기준: 매달 평가금액 × (1 + 연 가격 수익률)^(1/12). 분배금 = 그 달 평가금액 × 연 분배금 수익률 × (그 달 지급 비중). 가격 수익률은 분배금을 뺀 가격 변화이므로 분배금을 따로 더해도 이중 계산이 아닙니다. 세금은 분배금에서 원천징수, 거래 비용은 매수·재투자·리밸런싱 금액에 부과. 분배금은 바뀔 수 있으며 높은 분배금 수익률이 높은 총수익률을 뜻하지 않습니다.
          </Disclaimer>
        </>
      ) : (
        <MonteCarloPanel list={list} base={base} ser={ser} focus={focus} setFocus={setFocus} onSave={(title, summary) => runs.add({ kind: "montecarlo", title, summary })} />
      )}
    </div>
  );
}

type ResultRow = { p: PortfolioInput; error: string } | { p: PortfolioInput; per: Record<ScenarioId, { holdings: FutureHolding[]; res: FutureResult; alt: FutureResult }> };

function ScenarioResults({ results, scenario, setScenario, focus, setFocus, reinvest, months, onSave }: { results: ResultRow[]; scenario: ScenarioId; setScenario: (s: ScenarioId) => void; focus: number; setFocus: (n: number) => void; reinvest: boolean; months: number; onSave: (t: string, s: { label: string; value: string }[]) => void }) {
  const errs = results.filter((r): r is { p: PortfolioInput; error: string } => "error" in r);
  if (errs.length) return <Notice tone="critical" title="계산하지 않았습니다">{errs.map((e) => `포트폴리오 ${e.p.key}: ${e.error}`).join(" / ")}</Notice>;
  const ok = results as { p: PortfolioInput; per: Record<ScenarioId, { holdings: FutureHolding[]; res: FutureResult; alt: FutureResult }> }[];
  const f = ok[Math.min(focus, ok.length - 1)];
  const sel = f.per[scenario].res;
  return (
    <>
      <Section
        title={`4. 시나리오별 결과 — ${f.p.key}. ${f.p.name}`}
        description={`${months}개월 뒤 기준`}
        right={
          <div className="flex flex-wrap gap-2">
            <Seg label="포트폴리오" value={focus} onChange={setFocus} options={ok.map((r, i) => ({ v: i, l: r.p.key }))} />
            <button type="button" className="btn btn-sm" onClick={() => onSave(`미래 시나리오 ${months}개월 · ${f.p.name}`, SCEN.map((s) => ({ label: `${SCEN_KO[s]} 예상 자산`, value: usd(f.per[s].res.finalValue, 0) })))}>
              결과 저장
            </button>
          </div>
        }
      >
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
                  ["예상 수익률", (r: FutureResult) => <span className={tone(r.returnPct)}>{pct(r.returnPct)}</span>],
                  ["가격 변화 손익", (r: FutureResult) => <span className={tone(r.priceGainTotal)}>{usd(r.priceGainTotal, 0)}</span>],
                  ["분배금 합계 (세전)", (r: FutureResult) => usd(r.incomeGrossTotal, 0)],
                  ["분배금 합계 (세후)", (r: FutureResult) => usd(r.incomeNetTotal, 0)],
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
                    {usd(f.per[s].alt.finalValue, 0)} <span className={`text-[11px] ${tone(f.per[s].res.finalValue - f.per[s].alt.finalValue)}`}>({reinvest ? "재투자 효과 " : "차이 "}{usd(Math.abs(f.per[s].res.finalValue - f.per[s].alt.finalValue), 0)})</span>
                  </td>
                ))}
              </tr>
              <tr>
                <th className="text-left font-normal text-ink-2">적용한 가정 (가격 / 분배금, 연 %)</th>
                {SCEN.map((s) => (
                  <td key={s} className="r text-[11px] text-ink-2">
                    {f.per[s].holdings.map((h) => `${h.symbol} ${h.priceReturnPct.toFixed(1)} / ${h.yieldPct.toFixed(1)}`).join(", ")}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="월별 예상 자산" description="점선은 누적 납입 원금">
        <SimLineChart
          dates={f.per.neutral.res.months.map((m) => m.ym)}
          lines={[...SCEN.map((s, i) => ({ key: s, label: SCEN_KO[s], values: f.per[s].res.months.map((m) => m.value), color: SERIES_VARS[i] })), { key: "c", label: "납입 원금", values: f.per.neutral.res.months.map((m) => m.contributed), dashed: true, color: "--axis" }]}
          format="usd"
          ariaLabel="시나리오별 월별 예상 자산"
        />
      </Section>

      <Section title="예상 월별·연간 분배금" right={<Seg label="시나리오" value={scenario} onChange={setScenario} options={SCEN.map((s) => ({ v: s, l: SCEN_KO[s] }))} />} description="과거 실제 지급 월 비중대로 배분한 가정치입니다 (세전).">
        <BarChartSvg points={sel.months.map((m) => ({ label: m.ym, value: m.incomeGross, sub: `세후 ${usd(m.incomeNet)}` }))} valueFormat="usd2" ariaLabel="예상 월별 분배금" />
        <div className="mt-3 overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>연도</th>
                <th className="r">개월 수</th>
                <th className="r">예상 분배금 (세전)</th>
                <th className="r">세후</th>
              </tr>
            </thead>
            <tbody>
              {sel.annualIncome.map((a) => (
                <tr key={a.year}>
                  <td>{a.year}</td>
                  <td className="r">{a.months}</td>
                  <td className="r">{usd(a.gross)}</td>
                  <td className="r">{usd(a.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`포트폴리오 비교 — ${SCEN_KO[scenario]} 가정`}>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>포트폴리오</th>
                <th className="r">예상 자산</th>
                <th className="r">예상 수익률</th>
                <th className="r">가격 변화 손익</th>
                <th className="r">분배금 합계(세후)</th>
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
                    <td className="r">{usd(x.avgMonthlyIncomeNet)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function MonteCarloPanel({
  list,
  base,
  ser,
  focus,
  setFocus,
  onSave,
}: {
  list: PortfolioInput[];
  base: Omit<FutureConfig, "holdings">;
  ser: ReturnType<typeof useSeriesMap>;
  focus: number;
  setFocus: (n: number) => void;
  onSave: (t: string, s: { label: string; value: string }[]) => void;
}) {
  const [lookback, setLookback] = useState<number | null>(null);
  const [paths, setPaths] = useState("1000");
  const [block, setBlock] = useState("3");
  const [seed, setSeed] = useState("42");
  const [out, setOut] = useState<{ p: PortfolioInput; r?: MonteCarloResult; alt?: MonteCarloResult; error?: string }[] | null>(null);
  const run = () => {
    const res = list.map((p) => {
      const pr = rowsProblem(p.rows);
      if (pr) return { p, error: pr };
      const items = rowsToItems(p.rows);
      const sum = items.reduce((a, b) => a + b.weight, 0);
      if (Math.abs(sum - 100) > 0.01) return { p, error: `비중 합계가 ${sum}%입니다.` };
      const xs = items.map((i) => ser.series[i.symbol]);
      if (xs.some((x) => !x)) return { p, error: "가격 데이터를 불러오지 못한 종목이 있습니다." };
      const h = monthlyHistory(xs as NonNullable<(typeof xs)[number]>[], lookback);
      if ("error" in h) return { p, error: h.error };
      const cfg = { ...base, holdings: items, paths: Math.round(parseNum(paths)), blockMonths: Math.round(parseNum(block)), seed: Math.round(parseNum(seed)) || 1 };
      if (!(cfg.months >= 1)) return { p, error: "기간을 확인하세요." };
      const r = runMonteCarlo(cfg, h);
      if ("error" in r) return { p, error: r.error };
      const alt = runMonteCarlo({ ...cfg, reinvest: !cfg.reinvest }, h);
      return { p, r, alt: "error" in alt ? undefined : alt };
    });
    setOut(res);
  };
  const f = out?.[Math.min(focus, (out?.length ?? 1) - 1)];
  return (
    <>
      <Section title="3. 몬테카를로 설정" description={`과거 실제 월별 수익률(가격·분배금)을 무작위로 다시 뽑아 여러 경로를 만듭니다. 모든 종목에 공통으로 있는 기간만 쓰며, 공통 데이터가 ${MC_MIN_MONTHS}개월 미만이면 실행하지 않습니다.`}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="사용할 과거 기간">
            <Seg label="사용할 과거 기간" value={lookback ?? 0} onChange={(v) => setLookback(v || null)} options={[{ v: 0, l: "공통 전체" }, { v: 10, l: "최근 10년" }, { v: 5, l: "최근 5년" }]} />
          </Field>
          <Field label="경로 수">
            <input className="input w-24" inputMode="numeric" value={paths} onChange={(e) => setPaths(e.target.value)} aria-label="경로 수" />
          </Field>
          <Field label="묶음 길이 (개월)" hint="연속된 달을 함께 뽑아 추세를 일부 보존">
            <input className="input w-20" inputMode="numeric" value={block} onChange={(e) => setBlock(e.target.value)} aria-label="묶음 길이" />
          </Field>
          <Field label="난수 시드" hint="같은 시드 = 같은 결과">
            <input className="input w-20" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="난수 시드" />
          </Field>
          <button type="button" className="btn btn-primary" onClick={run} disabled={ser.loading}>
            {ser.loading ? "가격 데이터 불러오는 중…" : "몬테카를로 실행"}
          </button>
        </div>
      </Section>
      {out && (
        <Section
          title="4. 확률적 결과"
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
            <table className="table-basic">
              <thead>
                <tr>
                  <th>포트폴리오</th>
                  <th className="r">하위 5%</th>
                  <th className="r">하위 25%</th>
                  <th className="r">중앙값</th>
                  <th className="r">상위 25%</th>
                  <th className="r">상위 5%</th>
                  <th className="r">원금 손실 확률</th>
                  <th className="r">세후 분배금 합계 (중앙값)</th>
                  <th className="r">최대 낙폭 (중앙값)</th>
                  <th>사용한 과거 기간</th>
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
                      <td className="r">{x.r.lossProbPct.toFixed(1)}%</td>
                      <td className="r">{usd(x.r.income.p50, 0)}</td>
                      <td className="r text-down">{pct(x.r.medianMddPct, 1)}</td>
                      <td className="num text-xs">
                        {x.r.history.first} ~ {x.r.history.last} ({x.r.history.count}개월)
                      </td>
                    </tr>
                  ) : (
                    <tr key={x.p.key}>
                      <td>
                        {x.p.key}. {x.p.name}
                      </td>
                      <td colSpan={9} className="text-xs text-warn">
                        실행하지 않음: {x.error}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted">총 납입 원금 {f?.r ? usd(f.r.totalContributed, 0) : "-"}. &apos;원금 손실 확률&apos; = 최종 평가금액이 총 납입 원금보다 작은 경로의 비율.</p>
          {f?.r && (
            <div className="mt-4">
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
          )}
          <Disclaimer>과거 월별 수익률을 다시 섞어 만든 가능한 경로들의 분포입니다. 앞으로도 과거와 비슷한 분포가 나온다는 가정에 기대며, 과거에 없던 상황(더 큰 폭락 등)은 반영되지 않습니다. 짧은 기간의 데이터만 있는 ETF 는 결과가 특정 시장 국면에 치우칠 수 있습니다.</Disclaimer>
        </Section>
      )}
    </>
  );
}

