"use client";
/** 스트레스 테스트 — 분배금 감소 / 하락장 (단순 충격·과거 실제 하락 구간) */
import { useEffect, useMemo, useRef, useState } from "react";
import { useIncome, usePortfolio, useQuotes, useRuns, useSeriesMap, useStrategies } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { crashVol, dailyVol, dividendStress, episodeImpact, estimateBeta, findEpisodes, pathShock, type DividendScenario } from "@/lib/sim/stress";
import { getInstrument } from "@/lib/instruments";
import { Notice, Section, Empty, Fold } from "@/components/ui";
import { Disclaimer, Field, HoldingsEditor, parseNum, pct, PRESETS, rowsFrom, rowsProblem, rowsToItems, Seg, tone, usd, type WeightRow } from "./common";
import { GroupedBars } from "./charts";
import RiskBudget from "./RiskBudget";

type Source = "mine" | "manual";

interface Pos {
  symbol: string;
  value: number;
  shares: number;
  price: number;
}

export default function StressClient() {
  const [tab, setTab] = useState<"dividend" | "market" | "budget">("dividend");
  const [source, setSource] = useState<Source>("manual");
  const [rows, setRows] = useState<WeightRow[]>(rowsFrom(PRESETS[0].items));
  const [amount, setAmount] = useState("100000");
  const portfolio = usePortfolio();
  const mine = usePortfolioSummary(portfolio.value);
  const strategies = useStrategies();
  const runs = useRuns();
  const manualSyms = rowsProblem(rows) ? [] : rowsToItems(rows).map((i) => i.symbol);
  const q = useQuotes(manualSyms);

  // 내 자산이 있으면 처음 한 번 '내 자산'을 기본 대상으로 (시세까지 받은 뒤 판단)
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !portfolio.loaded || mine.loading) return;
    autoPicked.current = true;
    if (!mine.empty && !mine.missingPrices.length && mine.holdings.length && !new URLSearchParams(window.location.search).get("strategy")) setSource("mine");
  }, [portfolio.loaded, mine.loading, mine.empty, mine.missingPrices.length, mine.holdings.length]);
  useEffect(() => {
    if (!strategies.loaded) return;
    const id = new URLSearchParams(window.location.search).get("strategy");
    const s = id ? strategies.value.find((x) => x.id === id) : null;
    if (s) {
      setRows(rowsFrom(s.items));
      setSource("manual");
    }
  }, [strategies.loaded, strategies.value]);

  const positions: { list: Pos[]; error: string | null } = useMemo(() => {
    if (source === "mine") {
      if (mine.empty) return { list: [], error: "내 자산에 입력한 보유 종목이 없습니다." };
      if (mine.missingPrices.length) return { list: [], error: `${mine.missingPrices.join(", ")} 시세가 없어 계산할 수 없습니다.` };
      return { list: mine.holdings.map((h) => ({ symbol: h.symbol, value: h.value as number, shares: h.shares, price: h.price as number })), error: null };
    }
    const pr = rowsProblem(rows);
    if (pr) return { list: [], error: pr };
    const items = rowsToItems(rows);
    const sum = items.reduce((a, b) => a + b.weight, 0);
    if (Math.abs(sum - 100) > 0.01) return { list: [], error: `비중 합계가 ${Math.round(sum * 100) / 100}%입니다. 100%로 맞추세요.` };
    const amt = parseNum(amount);
    if (!(amt > 0)) return { list: [], error: "투자 금액을 입력하세요." };
    if (q.loading) return { list: [], error: null };
    const missing = items.filter((i) => !q.prices[i.symbol]);
    if (missing.length) return { list: [], error: `${missing.map((m) => m.symbol).join(", ")} 시세가 없어 계산할 수 없습니다.` };
    return { list: items.map((i) => ({ symbol: i.symbol, value: (amt * i.weight) / 100, price: q.prices[i.symbol] as number, shares: (amt * i.weight) / 100 / (q.prices[i.symbol] as number) })), error: null };
  }, [source, mine, rows, amount, q.loading, q.prices]);

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 대상 포트폴리오">
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="대상" value={source} onChange={setSource} options={[{ v: "mine", l: "내 자산 (현재 보유)" }, { v: "manual", l: "직접 입력 / 저장한 전략" }]} />
          {source === "manual" && strategies.value.length > 0 && (
            <select className="input py-1 text-sm" value="" onChange={(e) => { const s = strategies.value.find((x) => x.id === e.target.value); if (s) setRows(rowsFrom(s.items)); }} aria-label="저장한 전략 불러오기">
              <option value="">저장한 전략 불러오기…</option>
              {strategies.value.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {source === "manual" && (
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px]">
            <HoldingsEditor rows={rows} onChange={setRows} label="스트레스 테스트 포트폴리오" />
            <Field label="투자 금액 (USD)" hint="현재 시세로 종목별 수량을 계산">
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="투자 금액" />
            </Field>
          </div>
        )}
        {positions.error && <p className="mt-2 text-sm text-critical">{positions.error}</p>}
        {positions.list.length > 0 && (
          <p className="mt-2 text-xs text-ink-2">
            평가금액 {usd(positions.list.reduce((a, p) => a + p.value, 0), 0)} · {positions.list.map((p) => `${p.symbol} ${p.shares.toFixed(2)}주`).join(", ")}
          </p>
        )}
      </Section>

      <div role="tablist" aria-label="스트레스 테스트 종류" className="flex gap-1 border-b border-line">
        {[
          ["dividend", "분배금 감소"],
          ["market", "하락장"],
          ["budget", "위험 예산"],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as "dividend" | "market" | "budget")} className={`border-b-2 px-3 py-2.5 text-sm ${tab === k ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2"}`}>
            {l}
          </button>
        ))}
      </div>
      {positions.list.length === 0 ? (
        <Empty>대상 포트폴리오를 정하면 계산합니다.</Empty>
      ) : tab === "dividend" ? (
        <DividendStress positions={positions.list} onSave={(t, s) => runs.add({ kind: "dividend_stress", title: t, summary: s })} />
      ) : tab === "budget" ? (
        <RiskBudget positions={positions.list} />
      ) : (
        <MarketStress positions={positions.list} onSave={(t, s) => runs.add({ kind: "market_stress", title: t, summary: s })} />
      )}
    </div>
  );
}

function DividendStress({ positions, onSave }: { positions: Pos[]; onSave: (t: string, s: { label: string; value: string }[]) => void }) {
  const income = useIncome();
  const [cuts, setCuts] = useState("10, 20, 30");
  const [tax, setTax] = useState("15");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [sel, setSel] = useState(0);
  if (income.loading) return <div className="skeleton h-40" />;
  if (income.error || !income.data) return <Notice tone="critical">분배금 기록을 불러오지 못했습니다: {income.error}</Notice>;
  const items = income.data.items;
  const ipos = positions.map((p) => ({ symbol: p.symbol, shares: p.shares, ttmPerShare: items[p.symbol]?.ttmPerShare ?? 0, monthWeights: items[p.symbol]?.monthWeights ?? [] }));
  const uniform = [...new Set(cuts.split(/[,\s]+/).map(parseNum).filter((v) => v > 0 && v <= 100))];
  const targeted = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, parseNum(v)]).filter(([, v]) => (v as number) > 0 && (v as number) <= 100));
  const scenarios: DividendScenario[] = [
    ...uniform.map((u) => ({ key: `u${u}`, label: `전체 ${u}% 감소`, uniformCutPct: u })),
    ...(Object.keys(targeted).length ? [{ key: "t", label: `특정 종목만 감소 (${Object.entries(targeted).map(([k, v]) => `${k} ${v}%`).join(", ")})`, targetedCuts: targeted as Record<string, number> }] : []),
  ];
  const r = dividendStress(ipos, scenarios, parseNum(tax));
  const row = r.rows[Math.min(sel, r.rows.length - 1)];
  const noIncome = ipos.filter((p) => p.ttmPerShare === 0).map((p) => p.symbol);
  return (
    <>
      <Section title="2. 분배금 감소 가정" description="기준 = 보유 수량 × 최근 12개월 실제 주당 정기 지급액 (특별분배 제외)">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="모든 종목 감소율 (%) · 쉼표로 여러 개">
            <input className="input w-56" value={cuts} onChange={(e) => setCuts(e.target.value)} aria-label="전체 감소율 목록" />
          </Field>
          <Field label="분배금 세금 (%)">
            <input className="input w-20" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
          </Field>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-ink-2">특정 종목만 감소 (비워 두면 계산 안 함)</p>
          <div className="flex flex-wrap gap-2">
            {positions.map((p) => (
              <label key={p.symbol} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm">
                {p.symbol}
                <input className="input w-16 py-0.5 text-right text-sm" inputMode="decimal" value={targets[p.symbol] ?? ""} onChange={(e) => setTargets({ ...targets, [p.symbol]: e.target.value })} aria-label={`${p.symbol} 감소율`} placeholder="0" />%
              </label>
            ))}
          </div>
        </div>
        {noIncome.length > 0 && <p className="mt-2 text-xs text-muted">{noIncome.join(", ")}: 최근 12개월 정기 지급 기록이 없어 분배금 0으로 계산합니다.</p>}
      </Section>
      <Section title="3. 결과" right={<button type="button" className="btn btn-sm" onClick={() => onSave("분배금 감소 스트레스 테스트", r.rows.map((x) => ({ label: x.label, value: `연 ${usd(x.annualGross, 0)}` })))}>결과 저장</button>}>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>시나리오</th>
                <th className="r">연간 분배금 (세전)</th>
                <th className="r">변화</th>
                <th className="r">연간 세후</th>
                <th className="r">월평균 세후</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-muted">
                <td className="whitespace-nowrap">지금 (최근 12개월 실제)</td>
                <td className="r">{usd(r.baseAnnualGross)}</td>
                <td className="r">-</td>
                <td className="r">{usd(r.baseAnnualNet)}</td>
                <td className="r">{usd(r.baseAnnualNet / 12)}</td>
              </tr>
              {r.rows.map((x, i) => (
                <tr key={x.key} className={i === Math.min(sel, r.rows.length - 1) ? "bg-accent-soft" : ""} onClick={() => setSel(i)}>
                  <td className="whitespace-nowrap">
                    <button type="button" className="text-left" onClick={() => setSel(i)}>
                      {x.label}
                    </button>
                  </td>
                  <td className="r font-semibold">{usd(x.annualGross)}</td>
                  <td className={`r ${tone(x.diffAnnualGross)}`}>
                    {usd(x.diffAnnualGross)} ({pct(x.diffPct, 1)})
                  </td>
                  <td className="r">{usd(x.annualNet)}</td>
                  <td className="r">{usd(x.annualNet / 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {row && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-2">월별 분배금 (세전): 지금 vs {row.label}</p>
              <GroupedBars categories={Array.from({ length: 12 }, (_, i) => `${i + 1}월`)} series={[{ label: "지금", values: r.baseMonthly, color: "--s1" }, { label: row.label, values: row.monthlyGross, color: "--s2" }]} format="usd" height={200} ariaLabel="월별 분배금 변화" />
            </div>
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold text-ink-2">종목별 영향 — {row.label}</p>
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th className="r">감소율</th>
                    <th className="r">변경 전 (연)</th>
                    <th className="r">변경 후 (연)</th>
                    <th className="r">차이</th>
                  </tr>
                </thead>
                <tbody>
                  {row.perHolding.map((h) => (
                    <tr key={h.symbol}>
                      <td className="font-semibold">{h.symbol}</td>
                      <td className="r">{h.cutPct}%</td>
                      <td className="r">{usd(h.before)}</td>
                      <td className="r">{usd(h.after)}</td>
                      <td className={`r ${tone(h.after - h.before)}`}>{usd(h.after - h.before)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Disclaimer>가정에 따른 계산이며 실제 향후 분배금 예측이 아닙니다. 월별 배분은 각 종목의 최근 12개월 실제 지급 월 비중을 따릅니다.</Disclaimer>
      </Section>
    </>
  );
}

const INDEXES = [
  { v: "^GSPC", l: "S&P 500" },
  { v: "^NDX", l: "나스닥 100" },
  { v: "^SOX", l: "필라델피아 반도체" },
  { v: "^RUT", l: "러셀 2000" },
];

function MarketStress({ positions, onSave }: { positions: Pos[]; onSave: (t: string, s: { label: string; value: string }[]) => void }) {
  const [index, setIndex] = useState("^GSPC");
  const [shocks, setShocks] = useState("0, 10, 20, 30");
  const [days, setDays] = useState("20");
  const [volMode, setVolMode] = useState<"crisis" | "recent">("crisis");
  const [lookback, setLookback] = useState(756);
  const [threshold, setThreshold] = useState(15);
  const [sel, setSel] = useState(2);
  const ser = useSeriesMap([...positions.map((p) => p.symbol), index]);
  const idx = ser.series[index];
  const total = positions.reduce((a, p) => a + p.value, 0);
  const calc = useMemo(() => {
    if (!idx) return null;
    const betas = positions.map((p) => (ser.series[p.symbol] ? estimateBeta(ser.series[p.symbol], idx, lookback) : { symbol: p.symbol, beta: null, corr: null, days: 0, from: null, to: null }));
    const eps = findEpisodes(idx, threshold);
    const cv = crashVol(idx, findEpisodes(idx, 15));
    const recent = dailyVol(idx, 756);
    const sigma = volMode === "crisis" && cv ? cv.sigma : recent;
    const sp = positions.map((p, i) => ({ symbol: p.symbol, value: p.value, beta: betas[i].beta }));
    const list = [...new Set(shocks.split(/[,\s]+/).map(parseNum).filter((v) => v >= 0 && v < 100))];
    const d = Math.max(1, Math.min(500, Math.round(parseNum(days)) || 20));
    const rowsOut = list.map((s) => {
      if (s === 0) return { shock: s, retPct: 0 as number | null, per: positions.map(() => 0 as number | null) };
      const path = pathShock(sp, s, d, sigma, 800, 11);
      return { shock: s, retPct: path.portfolio?.p50 ?? null, per: positions.map((p) => path.perHolding.find((x) => x.symbol === p.symbol)?.p50 ?? null) };
    });
    const weights = positions.map((p) => ({ symbol: p.symbol, weight: (p.value / total) * 100 }));
    const dataEnd = idx.dates[idx.dates.length - 1];
    return { betas, eps: eps.map((e) => episodeImpact(e, weights, ser.series, dataEnd)), sigma, recent, cv, rowsOut, d };
  }, [idx, positions, ser.series, lookback, threshold, volMode, shocks, days, total]);

  if (ser.loading) return <div className="skeleton h-40" />;
  if (!idx) return <Notice tone="critical">{index} 지수 데이터를 불러오지 못했습니다: {ser.errors[index] ?? "데이터 없음"}</Notice>;
  if (!calc) return null;
  const cur = calc.rowsOut[Math.min(sel, calc.rowsOut.length - 1)];
  return (
    <>
      <Section title="2. 하락 가정">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="기준 시장 지수">
            <select className="input" value={index} onChange={(e) => setIndex(e.target.value)} aria-label="기준 시장 지수">
              {INDEXES.map((i) => (
                <option key={i.v} value={i.v}>
                  {i.l} ({i.v})
                </option>
              ))}
            </select>
          </Field>
          <Field label="지수 하락률 (%) — 쉼표로 여러 개">
            <input className="input w-48" value={shocks} onChange={(e) => setShocks(e.target.value)} aria-label="지수 하락률 목록" />
          </Field>
          <Field label="하락 기간 (거래일)">
            <input className="input w-20" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-label="하락 기간" />
          </Field>
          <Field label="하락 중 변동성">
            <Seg label="하락 중 변동성" value={volMode} onChange={setVolMode} options={[{ v: "crisis", l: `과거 급락기 (${calc.cv ? (calc.cv.sigma * 100).toFixed(2) : "-"}%/일)` }, { v: "recent", l: `최근 3년 (${(calc.recent * 100).toFixed(2)}%/일)` }]} />
          </Field>
          <Field label="베타 추정 기간">
            <Seg label="베타 추정 기간" value={lookback} onChange={setLookback} options={[{ v: 252, l: "1년" }, { v: 756, l: "3년" }, { v: 1260, l: "5년" }]} />
          </Field>
        </div>
      </Section>

      <Section
        title="3. 지수가 하락하면"
        description={`${index}가 ${calc.d}거래일 동안 오르내리며 정한 만큼 하락하는 경로 800개를 만들고, 각 종목이 매일 '베타 × 지수 일간 수익률'만큼 움직였을 때의 중앙값입니다.`}
        right={<button type="button" className="btn btn-sm" onClick={() => onSave(`하락장 스트레스 테스트 (${index})`, calc.rowsOut.map((r) => ({ label: `지수 −${r.shock}%`, value: pct(r.retPct, 1) })))}>결과 저장</button>}
      >
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>지수 하락</th>
                <th className="r">예상 손익률</th>
                <th className="r">예상 손익</th>
                <th className="r">하락 후 자산</th>
              </tr>
            </thead>
            <tbody>
              {calc.rowsOut.map((r, i) => (
                <tr key={r.shock} className={i === sel ? "bg-accent-soft" : ""}>
                  <td>
                    <button type="button" onClick={() => setSel(i)} className="font-semibold">
                      {r.shock === 0 ? "하락 없음" : `−${r.shock}%`}
                    </button>
                  </td>
                  <td className={`r font-semibold ${tone(r.retPct)}`}>{r.retPct !== null ? pct(r.retPct, 1) : "계산 불가"}</td>
                  <td className={`r ${tone(r.retPct)}`}>{r.retPct !== null ? usd((total * r.retPct) / 100, 0) : "-"}</td>
                  <td className="r">{r.retPct !== null ? usd(total * (1 + r.retPct / 100), 0) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cur && (
          <div className="mt-5 overflow-x-auto">
            <p className="mb-1 text-xs font-semibold text-ink-2">종목별 — 지수 −{cur.shock}% (위 표에서 하락률을 누르면 바뀝니다)</p>
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">비중</th>
                  <th className="r">베타</th>
                  <th className="r">예상 손익률</th>
                  <th className="r">손익 기여</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const b = calc.betas[i];
                  const r = cur.per[i];
                  const lev = getInstrument(p.symbol)?.leverage;
                  return (
                    <tr key={p.symbol}>
                      <td>
                        <span className="font-semibold">{p.symbol}</span>
                        {lev && <span className="ml-1 rounded bg-warn-soft px-1 text-[10px] text-warn">일일 {lev}배</span>}
                      </td>
                      <td className="r">{((p.value / total) * 100).toFixed(1)}%</td>
                      <td className="r" title={b.corr !== null ? `상관계수 ${b.corr.toFixed(2)}` : undefined}>
                        {b.beta !== null ? b.beta.toFixed(2) : `계산 불가 (${b.days}일)`}
                      </td>
                      <td className={`r ${tone(r)}`}>{r !== null ? pct(r, 1) : "-"}</td>
                      <td className={`r ${tone(r)}`}>{r !== null ? usd((p.value * r) / 100, 0) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Fold summary="계산 방법">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            <li>베타 = 최근 {lookback === 252 ? "1년" : lookback === 756 ? "3년" : "5년"} 일간 총수익률(분배금 포함)을 {index} 일간 수익률에 회귀한 값입니다.</li>
            <li>레버리지 ETF 는 베타에 일일 배수가 이미 들어 있고, 매일 배수를 다시 맞추기 때문에 같은 하락률이라도 기간이 길고 변동성이 클수록 손실이 커집니다. 단순히 &lsquo;베타 × 하락률&rsquo;로 계산하면 이 효과가 빠집니다.</li>
            <li>하락 중 변동성: {volMode === "crisis" ? `과거 급락기 평균 ${calc.cv ? (calc.cv.sigma * 100).toFixed(2) : "-"}%/일` : `최근 3년 ${(calc.recent * 100).toFixed(2)}%/일`}. 경로 800개 중 가운데 값을 보여 줍니다.</li>
          </ul>
        </Fold>
      </Section>

      <Section title="4. 과거 실제 하락 구간" description={`${index}가 고점 대비 ${threshold}% 이상 하락했던 실제 구간 · 고점에 같은 비중으로 샀을 때의 실제 총수익률(분배금 재투자). 상장 전 종목이 있으면 포트폴리오 결과는 비웁니다.`} right={<Seg label="하락 기준" value={threshold} onChange={setThreshold} options={[{ v: 10, l: "10%" }, { v: 15, l: "15%" }, { v: 20, l: "20%" }]} />}>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>구간</th>
                <th>고점 → 저점</th>
                <th className="r">지수 하락</th>
                <th className="r">포트폴리오 (고점→지수 저점)</th>
                <th className="r">포트폴리오 최대 낙폭</th>
                <th>포트폴리오 회복</th>
                <th>종목별</th>
              </tr>
            </thead>
            <tbody>
              {calc.eps.slice(0, 20).map((e) => (
                <tr key={e.episode.peak}>
                  <td className="text-xs">{e.episode.name ?? `${e.episode.peak.slice(0, 7)} 하락`}</td>
                  <td className="num text-xs">
                    {e.episode.peak} → {e.episode.trough}
                  </td>
                  <td className="r text-down">{pct(e.episode.indexDrawdownPct, 1)}</td>
                  <td className={`r ${tone(e.portfolioRetPct)}`}>{e.portfolioRetPct !== null ? pct(e.portfolioRetPct, 1) : <span className="text-xs text-muted">상장 전 종목 있음</span>}</td>
                  <td className="r text-down">{e.portfolioMddPct !== null ? pct(e.portfolioMddPct, 1) : "-"}</td>
                  <td className="num text-xs">{e.portfolioRetPct === null ? "-" : (e.portfolioRecovery ?? "데이터 기간 내 미회복")}</td>
                  <td className="text-[11px] text-ink-2">{e.perHolding.map((h) => `${h.symbol} ${h.retPct !== null ? pct(h.retPct, 1) : "상장 전"}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {calc.eps.length === 0 && <p className="text-sm text-muted">이 기준을 넘는 하락 구간이 데이터에 없습니다.</p>}
      </Section>
      <Disclaimer>가정에 따른 계산이며 실제 손실 예측이 아닙니다. 과거 베타가 앞으로도 같다고 가정하며, 실제 하락장에서는 상관관계와 변동성이 크게 달라질 수 있습니다. 과거 하락 구간 결과는 실제 기록이지만 다음 하락이 같은 모습일 것이라는 뜻은 아닙니다. 실제 손실은 이 계산과 다를 수 있습니다.</Disclaimer>
    </>
  );
}
