"use client";
/** 목표 배당 계산기 — 매달 받고 싶은 금액에서 필요한 투자금을 거꾸로 계산 (최근 12개월 실제 지급 기준) */
import { useState } from "react";
import { useFx, useIncome } from "@/lib/client/user-data";
import { solveTarget, type TargetResult } from "@/lib/sim/target";
import { FIN_INCOME_THRESHOLD_KRW } from "@/lib/portfolio/tax";
import { formatEt } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import PanelTabs from "@/components/PanelTabs";
import { Disclaimer, Field, krw, parseNum, PRESETS, rowsFrom, rowsProblem, rowsToItems, Seg, usd } from "./common";
import { GroupedBars, SERIES_VARS } from "./charts";
import PortfolioInputs, { LETTERS, type PortfolioInput } from "./PortfolioInputs";

const START = [PRESETS[0], PRESETS[2], PRESETS[3]].map((p, i) => ({ key: LETTERS[i], name: p.name, rows: rowsFrom(p.items) }));

export default function IncomeTargetClient() {
  const [amount, setAmount] = useState("1000000");
  const [cur, setCur] = useState<"KRW" | "USD">("KRW");
  const [afterTax, setAfterTax] = useState(true);
  const [tax, setTax] = useState("15");
  const [list, setList] = useState<PortfolioInput[]>(START);
  const [focus, setFocus] = useState(0);
  const income = useIncome();
  const fx = useFx();

  const amt = parseNum(amount);
  const targetUsd = cur === "USD" ? amt : fx.rate ? amt / fx.rate : NaN;
  const items = income.data?.items ?? {};
  const results: { p: PortfolioInput; r: TargetResult | { error: string } }[] = list.map((p) => {
    const pr = rowsProblem(p.rows);
    if (pr) return { p, r: { error: pr } };
    const hs = rowsToItems(p.rows).map((i) => {
      const inf = items[i.symbol];
      return { symbol: i.symbol, weight: i.weight, yieldPct: inf?.ttmYield ?? null, annualizedYieldPct: inf?.annualizedLatestYield ?? null, monthWeights: inf?.monthWeights ?? [], price: inf?.price ?? null };
    });
    return { p, r: solveTarget(hs, targetUsd, parseNum(tax), afterTax) };
  });
  const ok = results.filter((x): x is { p: PortfolioInput; r: TargetResult } => !("error" in x.r));
  const f = results[Math.min(focus, results.length - 1)];
  const toKrw = (v: number) => (fx.rate ? krw(v * fx.rate) : "-");
  const both = (v: number) => (
    <>
      <span className="num">{usd(v, 0)}</span>
      {fx.rate && <span className="num block text-xs font-normal text-muted">≈ {toKrw(v)}</span>}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 목표">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="매달 받고 싶은 금액">
            <input className="input w-40" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="매달 받고 싶은 금액" />
          </Field>
          <Field label="통화">
            <Seg label="통화" value={cur} onChange={setCur} options={[{ v: "KRW", l: "원" }, { v: "USD", l: "달러" }]} />
          </Field>
          <Field label="기준">
            <Seg label="세전 세후" value={afterTax} onChange={setAfterTax} options={[{ v: true, l: "세후 (손에 들어오는 금액)" }, { v: false, l: "세전" }]} />
          </Field>
          {afterTax && (
            <Field label="분배금 세금 (%)">
              <input className="input w-20" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {cur === "KRW"
            ? fx.rate
              ? `원/달러 ${fx.rate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원 (${fx.time ? formatEt(fx.time) : "-"}) 기준으로 환산 → 월 ${usd(targetUsd, 0)}`
              : (fx.error ?? "환율을 불러오는 중입니다")
            : fx.rate
              ? `≈ 월 ${krw(amt * fx.rate)} (현재 환율)`
              : ""}
        </p>
      </Section>

      <Section title="2. 포트폴리오" description="최대 3개를 같은 목표로 비교합니다">
        <PortfolioInputs list={list} onChange={setList} max={3} />
      </Section>

      {income.error && <Notice tone="critical">분배금 기록을 불러오지 못했습니다: {income.error}</Notice>}
      {cur === "KRW" && !fx.rate && !fx.loading && <Notice tone="warn">원/달러 환율이 없어 원화 목표를 계산할 수 없습니다. 통화를 달러로 바꾸세요.</Notice>}

      {Number.isFinite(targetUsd) && targetUsd > 0 && income.data && (
        <Section title="3. 필요한 투자금" description="최근 12개월 실제 지급 기준 · 앞으로 같다는 보장은 없습니다">
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            {results.map(({ p, r }, i) => (
              <div key={p.key} className="rounded-xl border border-line p-4">
                <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-ink-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${SERIES_VARS[i]})` }} />
                  {p.key}. {p.name}
                </p>
                {"error" in r ? (
                  <p className="mt-2 text-sm text-critical">{r.error}</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-muted">평균적으로 매달 목표만큼 받으려면</p>
                    <p className="text-2xl font-bold">{both(r.requiredAvg)}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted">분배금 수익률</dt>
                        <dd className="num font-semibold">{r.yieldPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt className="text-muted">모든 달 목표 이상</dt>
                        <dd className="num font-semibold">{r.requiredEveryMonth !== null ? usd(r.requiredEveryMonth, 0) : "불가"}</dd>
                      </div>
                    </dl>
                    {r.zeroMonths.length > 0 && <p className="mt-2 text-[11px] text-warn">{r.zeroMonths.join("·")}월에는 지급 기록이 없어 그달 수입이 0입니다.</p>}
                    {r.missing.length > 0 && <p className="mt-1 text-[11px] text-warn">{r.missing.join(", ")}: 지급 기록 없음 (0으로 계산)</p>}
                    {fx.rate && r.annualGross * fx.rate > FIN_INCOME_THRESHOLD_KRW && (
                      <p className="mt-2 rounded-md bg-warn-soft px-2 py-1 text-[11px] text-warn">연간 분배금(세전) {krw(r.annualGross * fx.rate)} — 금융소득 종합과세 기준(2,000만 원)을 넘습니다.</p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {ok.length > 0 && (
            <PanelTabs
              label="목표 배당 결과"
              tabs={[
                {
                  key: "monthly",
                  label: "월별 분배금",
                  content: (
                    <div>
                      <p className="mb-2 text-xs text-ink-2">평균 기준 금액을 넣었을 때 달마다 {afterTax ? "세후" : "세전"} 분배금 (과거 실제 지급 월 기준)</p>
                      <GroupedBars categories={Array.from({ length: 12 }, (_, m) => `${m + 1}월`)} series={ok.map((x) => ({ label: `${x.p.key}. ${x.p.name}`, values: x.r.monthly, color: SERIES_VARS[list.indexOf(x.p)] }))} format="usd" height={220} ariaLabel="월별 예상 분배금" />
                    </div>
                  ),
                },
                {
                  key: "alloc",
                  label: "종목별 배분",
                  content:
                    "error" in f.r ? (
                      <p className="text-sm text-critical">{f.r.error}</p>
                    ) : (
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs text-ink-2">평균 기준 금액 · 현재가로 계산한 수량</p>
                          <Seg label="포트폴리오" value={focus} onChange={setFocus} options={results.map((x, i) => ({ v: i, l: x.p.key }))} />
                        </div>
                        <div className="overflow-x-auto">
                          <table className="table-basic">
                            <thead>
                              <tr>
                                <th>종목</th>
                                <th className="r">투자금</th>
                                <th className="r">수량</th>
                                <th className="r">연간 분배금(세전)</th>
                                <th>지급 월</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.r.perHolding.map((h) => (
                                <tr key={h.symbol}>
                                  <td className="font-semibold">{h.symbol}</td>
                                  <td className="r">{usd(h.amount, 0)}</td>
                                  <td className="r">{h.shares !== null ? h.shares.toFixed(1) : "-"}</td>
                                  <td className="r">{usd(h.annualGross, 0)}</td>
                                  <td className="text-xs">{h.months.length ? `${h.months.join("·")}월` : "기록 없음"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ),
                },
                {
                  key: "cut",
                  label: "분배금이 줄면",
                  content: (
                    <div className="overflow-x-auto">
                      <p className="mb-2 text-xs text-ink-2">분배금이 줄었을 때 같은 목표에 필요한 투자금 (가정)</p>
                      <table className="table-basic">
                        <thead>
                          <tr>
                            <th>포트폴리오</th>
                            <th className="r">지금 기준</th>
                            <th className="r">10% 감소</th>
                            <th className="r">20% 감소</th>
                            <th className="r">30% 감소</th>
                            <th className="r">최근 지급액 연환산 기준</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ok.map((x) => (
                            <tr key={x.p.key}>
                              <td>
                                {x.p.key}. {x.p.name}
                              </td>
                              <td className="r font-semibold">{usd(x.r.requiredAvg, 0)}</td>
                              {[10, 20, 30].map((c) => (
                                <td key={c} className="r">
                                  {usd(x.r.requiredAvg / (1 - c / 100), 0)}
                                </td>
                              ))}
                              <td className="r text-ink-2">{x.r.requiredAnnualized !== null ? usd(x.r.requiredAnnualized, 0) : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Section>
      )}
      <Disclaimer>
        최근 12개월 실제 정기 지급액(특별분배 제외)과 현재가로 계산했습니다. 분배금은 매번 달라질 수 있고, 분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다 — 커버드콜 ETF 등은 분배금만큼 가격이 내려가거나 상승 참여가 제한될 수 있습니다. 세금은 미국 원천징수만 가정했으며, 연간 금융소득이 2,000만 원을 넘으면 종합과세 대상입니다.
      </Disclaimer>
    </div>
  );
}
