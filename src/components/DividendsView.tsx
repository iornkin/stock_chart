/** 배당·분배금 상세 (서버 컴포넌트) */
import type { InstrumentConfig } from "@/config/instruments";
import { distributionWord } from "@/lib/instruments";
import { readDividends, readSplits, dividendSources } from "@/lib/data/dividends";
import { getBars, dailyCloses } from "@/lib/data/bars";
import {
  summarizeDividends,
  FREQUENCY_KO,
  isRegular,
  paymentStatus,
  PAYMENT_STATUS_KO,
  annualTotals,
  annualGrowthRate,
  changeTrend,
  monthPattern,
  yieldDecomposition,
  ttmYieldHistory,
  incomeGrowthSeries,
} from "@/lib/dividend-analytics";
import { periodStart, periodStats, sliceFrom } from "@/lib/performance";
import { changeClass, fmtDividend, fmtPct, fmtUsd } from "@/lib/format";
import { addDays } from "@/lib/time";
import { etDate } from "@/lib/time";
import BarChartSvg from "./BarChartSvg";
import DividendCalculator from "./DividendCalculator";
import MultiLineChart from "./MultiLineChart";
import { Empty, Notice, Stat } from "./ui";

function H3({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-[16px] font-bold tracking-tight">{children}</h3>
      {sub && <p className="mt-0.5 text-xs leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

const KIND_KO: Record<string, string> = { regular: "정기", special: "특별", capital_gain: "자본이득", unknown: "구분 미제공" };

export default async function DividendsView({ inst, price }: { inst: InstrumentConfig; price: number | null }) {
  const word = distributionWord(inst);
  const divs = readDividends(inst.symbol);
  const splits = readSplits(inst.symbol);
  const today = etDate();
  const sum = summarizeDividends(divs, today, price);
  const isOption = inst.strategy === "covered_call_index" || inst.strategy === "option_income_active";

  if (!divs.length) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="info" title={`${word} 지급 기록 데이터 미제공`}>
          {inst.strategy === "physical_gold"
            ? "실물 금을 보유하는 신탁 구조의 ETF 로, 수집된 분배금 지급 기록이 없습니다."
            : inst.strategy === "leveraged"
              ? "수집된 분배금 지급 기록이 없습니다. 레버리지 ETF 는 분배금이 없거나 불규칙할 수 있습니다."
              : "데이터 제공처에서 지급 기록을 아직 받지 못했습니다. 예시 값으로 채우지 않습니다. 수집 작업이 실행되면 표시됩니다."}
        </Notice>
      </div>
    );
  }

  // 총수익률 비교 (가격만 vs 분배금 포함)
  const barsRes = await getBars(inst.symbol, "1d");
  const pts = dailyCloses(barsRes.bars).map((p) => ({ date: p.date, close: p.close }));
  const end = pts[pts.length - 1]?.date ?? today;
  const trRows = ["1y", "3y", "5y"].map((k) => {
    const sl = sliceFrom(pts, periodStart(end, k));
    return { k, stats: sl ? periodStats(sl, divs.map((d) => ({ exDate: d.exDate, amount: d.amount }))) : null };
  });

  const history = [...divs].reverse();
  const totals = annualTotals(divs, today);
  const cagr3 = annualGrowthRate(totals, 3);
  const cagr5 = annualGrowthRate(totals, 5);
  const trend = changeTrend(divs, today, 12);
  const pattern = monthPattern(divs, today);
  const decomp = yieldDecomposition(divs, pts, today);
  const yieldHist = ttmYieldHistory(divs, pts, 12);
  const growthStart = addDays(end, -5 * 365);
  const growthPts = pts[0] && pts[0].date <= growthStart ? pts.filter((p) => p.date >= growthStart) : pts;
  const growth = incomeGrowthSeries(growthPts, divs);
  const past12 = divs
    .filter((d) => d.exDate <= today && d.exDate > addDays(today, -365))
    .map((d) => ({ exDate: d.exDate, payDate: d.payDate, amount: d.amount, special: !isRegular(d) }));
  const upcomingCalc = sum.upcoming.map((d) => ({ exDate: d.exDate, payDate: d.payDate, amount: d.amount, special: !isRegular(d) }));
  const chartPts = divs
    .filter((d) => d.exDate > `${Number(today.slice(0, 4)) - 5}-01-01`)
    .map((d) => ({ label: d.exDate, value: d.amount, sub: `${KIND_KO[d.kind]} · 지급일 ${d.payDate ?? "미제공"}`, muted: !isRegular(d) }));

  const ttmUpDown = trend.count ? `최근 ${trend.count}회 변경 중 증가 ${trend.up}회 · 감소 ${trend.down}회 · 동일 ${trend.same}회` : "비교할 지급 기록 부족";

  return (
    <div className="flex flex-col gap-8">
      {isOption && (
        <Notice tone="warn" title="커버드콜·옵션 인컴 ETF 의 분배금">
          보유 주식 배당 외에 옵션 매도 프리미엄 등 여러 수익원에서 나오며 매달 달라지고 줄어들 수 있습니다. 일부는 자본환급(ROC)일 수 있고(운용사 19a-1 공시 참조), 높은 분배율이 높은 총수익을 뜻하지는 않습니다.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`최근 ${word} (주당)`} value={fmtDividend(sum.latest?.amount)} sub={`배당락 ${sum.latest?.exDate ?? "-"} · 지급 ${sum.latest?.payDate ?? "미제공"}`} />
        <Stat label="최근 12개월 지급 합계" value={fmtDividend(sum.ttmSum)} sub={`${sum.ttmCount}회${sum.ttmSpecialSum ? ` · 특별 ${fmtDividend(sum.ttmSpecialSum)} 별도` : ""}`} />
        <Stat label="TTM 수익률" value={fmtPct(sum.ttmYield, 2, false)} sub={`실제 지급액 ÷ 현재가 ${fmtUsd(price)}`} />
        <Stat label="지급 주기 (기록 기준)" value={FREQUENCY_KO[sum.frequency.label]} sub={sum.frequency.basis} />
        <Stat label="직전 대비" value={<span className={changeClass(sum.latestChangePct)}>{fmtPct(sum.latestChangePct)}</span>} sub={`1년 전 같은 회차 대비 ${fmtPct(sum.yoyChangePct)}`} />
        <Stat
          label="최근 지급액 연환산 (참고)"
          value={sum.annualizedLatestYield !== null ? fmtPct(sum.annualizedLatestYield, 2, false) : "계산 안 함"}
          sub={sum.frequency.perYear ? `최근 1회 × ${sum.frequency.perYear}회 ÷ 현재가 · 확정 아님` : "지급이 불규칙해 계산 안 함"}
        />
        <Stat label={`발표된 다음 ${word}`} value={sum.upcoming[0] ? fmtDividend(sum.upcoming[0].amount) : "발표 없음"} sub={sum.upcoming[0] ? `배당락 ${sum.upcoming[0].exDate} · 지급 ${sum.upcoming[0].payDate ?? "미제공"}` : "발표된 경우에만 표시"} />
        <Stat label="제공처 기재 주기" value={sum.frequency.reportedPerYear ? `연 ${sum.frequency.reportedPerYear}회` : "미제공"} sub={sum.frequency.consistentWithReported === false ? "기록 판정과 다름 — 기록 기준 표시" : "Polygon 제공 시"} />
      </div>

      <section>
        <H3 sub="보유 수량이나 투자 금액을 넣으면 실제 지급 기록 기준으로 받았을 금액과 발표된 예정 금액을 계산합니다.">{word} 현금흐름 계산기</H3>
        <DividendCalculator symbol={inst.symbol} word={word} price={price} past12={past12} upcoming={upcomingCalc} asOf={today} />
      </section>

      <section>
        <H3 sub={`${ttmUpDown}${cagr3 !== null ? ` · 연간 합계 3년 연평균 ${fmtPct(cagr3, 1)}` : ""}${cagr5 !== null ? ` · 5년 연평균 ${fmtPct(cagr5, 1)}` : ""}`}>{word} 변화 추적</H3>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">회차별 지급액 (최근 5년, 주당)</p>
            {chartPts.length ? <BarChartSvg points={chartPts} valueFormat="usd3" ariaLabel={`${inst.symbol} ${word} 지급 기록 막대 차트`} /> : <Empty>최근 5년 지급 기록 없음</Empty>}
            <p className="text-[11px] text-muted">회색 막대는 특별·자본이득 분배</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">연도별 합계 (배당락일 기준)</p>
            <div className="max-h-[260px] overflow-auto">
              <table className="table-basic">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th>연도</th>
                    <th className="r">합계</th>
                    <th className="r">횟수</th>
                    <th className="r">전년 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {[...totals].reverse().slice(0, 12).map((t) => (
                    <tr key={t.year}>
                      <td className="num">
                        {t.year}
                        {t.partial && <span className="ml-1 text-[10px] text-muted">{t.year === Number(today.slice(0, 4)) ? "진행 중" : "자료 시작 연도"}</span>}
                      </td>
                      <td className="r">{fmtDividend(t.sum)}</td>
                      <td className="r">{t.count}회</td>
                      <td className={`r ${changeClass(t.yoy)}`}>{t.yoy === null ? "-" : fmtPct(t.yoy, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section>
        <H3 sub="최근 24개월 실제 지급 기록을 지급일(없으면 배당락일) 기준 월별로 모은 것입니다. 앞으로의 일정을 예측한 것이 아닙니다.">월별 지급 패턴</H3>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          {pattern.map((m) => (
            <div key={m.month} className={`rounded-lg border p-2 text-center ${m.entries.length ? "border-accent/40 bg-accent-soft" : "border-line"}`}>
              <p className="text-xs font-semibold">{m.month}월</p>
              <p className="num mt-1 text-[11px] text-ink-2">{m.entries.length ? `${m.entries.length}회` : "-"}</p>
              {m.entries.length > 0 && <p className="num text-[10px] text-muted">{fmtDividend(m.entries[m.entries.length - 1].amount)}</p>}
            </div>
          ))}
        </div>
        {sum.upcoming.length > 0 && (
          <p className="mt-2 text-xs text-ink-2">
            발표된 예정: {sum.upcoming.map((u) => `${u.payDate ?? `배당락 ${u.exDate}`} 주당 ${fmtDividend(u.amount)}`).join(" · ")}
          </p>
        )}
      </section>

      <section>
        <H3 sub="같은 기간 가격만 본 수익률과, 분배금을 재투자했을 때·현금으로 받았을 때의 결과를 비교합니다.">가격 수익률 vs 총수익률</H3>
        {growth.dates.length > 2 && (
          <div className="mb-4 rounded-xl border border-line p-3">
            <MultiLineChart
              dates={growth.dates}
              series={{ 가격만: growth.price, 재투자: growth.reinvest, 현금수령: growth.cash }}
              labels={{ 가격만: "가격만", 재투자: `${word} 재투자`, 현금수령: `${word} 현금 수령` }}
              height={260}
              defaultLog={false}
            />
            <p className="mt-1 text-[11px] text-muted">{growth.dates[0]} = 100 · 주 단위</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>기간</th>
                <th className="r">가격 수익률</th>
                <th className="r">{word} 재투자</th>
                <th className="r">{word} 현금 수령</th>
                <th className="r">재투자 효과</th>
                <th className="r">기간 중 {word}</th>
              </tr>
            </thead>
            <tbody>
              {trRows.map(({ k, stats }) => (
                <tr key={k}>
                  <td>{k === "1y" ? "1년" : k === "3y" ? "3년" : "5년"}</td>
                  {stats ? (
                    <>
                      <td className={`r ${changeClass(stats.priceReturn)}`}>{fmtPct(stats.priceReturn)}</td>
                      <td className={`r font-semibold ${changeClass(stats.totalReturnReinvested)}`}>{fmtPct(stats.totalReturnReinvested)}</td>
                      <td className={`r ${changeClass(stats.totalReturnCash)}`}>{fmtPct(stats.totalReturnCash)}</td>
                      <td className="r text-ink-2">{stats.totalReturnReinvested !== null && stats.totalReturnCash !== null ? `${fmtPct(stats.totalReturnReinvested - stats.totalReturnCash, 1)}p` : "-"}</td>
                      <td className="r">{fmtDividend(stats.distributions)}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="text-xs text-muted">기간 전체 가격 데이터 없음 (상장 기간 부족 또는 미수집)</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-muted">재투자: 배당락일 종가로 즉시 재투자 가정 · 세금·수수료 미반영 · 가격 데이터 {barsRes.meta.source ?? "-"}</p>
      </section>

      <section>
        <H3 sub="수익률(최근 12개월 분배금 ÷ 가격)은 분배금이 늘어도, 가격이 내려가도 올라갑니다. 1년 전과 비교해 어느 쪽 때문인지 나눠 봅니다.">주가 하락과 {word} 수익률의 관계</H3>
        {decomp ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <p className="prose-ko">
                TTM 수익률은 1년 전 <strong className="num">{decomp.yieldThen.toFixed(2)}%</strong>에서 지금 <strong className="num">{decomp.yieldNow.toFixed(2)}%</strong>로{" "}
                <strong className={changeClass(decomp.yieldNow - decomp.yieldThen)}>{fmtPct(decomp.yieldNow - decomp.yieldThen, 2)}p</strong> 변했습니다.
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                  <span>가격 변화 효과 <span className="text-xs text-muted">({fmtUsd(decomp.priceThen)} → {fmtUsd(decomp.priceNow)})</span></span>
                  <strong className={`num ${changeClass(decomp.priceEffect)}`}>{fmtPct(decomp.priceEffect, 2)}p</strong>
                </li>
                <li className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                  <span>{word} 변화 효과 <span className="text-xs text-muted">({fmtDividend(decomp.ttmThen)} → {fmtDividend(decomp.ttmNow)})</span></span>
                  <strong className={`num ${changeClass(decomp.distributionEffect)}`}>{fmtPct(decomp.distributionEffect, 2)}p</strong>
                </li>
              </ul>
              <p className="text-[13px] leading-relaxed text-ink-2">
                {decomp.yieldNow > decomp.yieldThen && decomp.priceEffect > decomp.distributionEffect
                  ? `수익률 상승의 상당 부분이 ${word} 증가가 아니라 가격 하락에서 나왔습니다. 받는 금액이 늘어난 것은 아닙니다.`
                  : decomp.yieldNow > decomp.yieldThen
                    ? `수익률 상승은 주로 ${word} 증가에서 나왔습니다.`
                    : decomp.distributionEffect < 0
                      ? `${word}이 줄어 수익률이 낮아졌습니다.`
                      : "수익률 하락은 주로 가격 상승에서 나왔습니다."}{" "}
                <span className="text-[11px] text-muted">(규칙 기반 해석)</span>
              </p>
            </div>
            {yieldHist.length > 1 && (
              <div className="overflow-x-auto">
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>시점</th>
                      <th className="r">가격</th>
                      <th className="r">최근 12개월 {word}</th>
                      <th className="r">TTM 수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...yieldHist].reverse().slice(0, 8).map((h) => (
                      <tr key={h.date}>
                        <td className="num">{h.date}</td>
                        <td className="r">{fmtUsd(h.price)}</td>
                        <td className="r">{fmtDividend(h.ttm)}</td>
                        <td className="r font-semibold">{h.yield.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <Empty>1년 이상의 가격·지급 기록이 있어야 계산할 수 있습니다.</Empty>
        )}
      </section>

      <section>
        <H3 sub={`출처: ${dividendSources(divs).join(", ")} · 지급일은 Nasdaq/Polygon 이 제공할 때만 표시`}>과거 지급 내역</H3>
        <div className="max-h-[480px] overflow-auto">
          <table className="table-basic">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th>배당락일</th>
                <th>지급일</th>
                <th>상태</th>
                <th className="r">주당 지급액</th>
                <th>유형</th>
                <th className="r">직전 대비</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d, i) => {
                const prev = history.slice(i + 1).find((x) => isRegular(x));
                const chg = isRegular(d) && prev ? (d.amount / prev.amount - 1) * 100 : null;
                const st = paymentStatus(d, today);
                return (
                  <tr key={`${d.exDate}${d.kind}`} className={st === "announced" || st === "scheduled" ? "bg-accent-soft" : ""}>
                    <td className="num">{d.exDate}</td>
                    <td className="num">{d.payDate ?? <span className="text-muted">미제공</span>}</td>
                    <td className={`text-xs ${st === "paid" ? "text-ink-2" : st === "ex_passed" ? "text-muted" : "font-semibold text-accent"}`}>{PAYMENT_STATUS_KO[st]}</td>
                    <td className="r">
                      {fmtDividend(d.amount)}
                      {d.splitAdjusted && d.amountRaw !== null && <span className="block text-[10px] text-muted">분할 전 {fmtDividend(d.amountRaw)}</span>}
                    </td>
                    <td className="text-xs">{KIND_KO[d.kind]}</td>
                    <td className={`r ${changeClass(chg)}`}>{fmtPct(chg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className="rounded-xl border border-line p-4 text-sm">
        <summary className="font-semibold">계산 방식</summary>
        <ul className="mt-2 list-disc pl-5 leading-relaxed text-ink-2">
          <li><strong>TTM 수익률</strong> = 배당락일이 최근 365일 안에 있는 정기 {word} 합계 ÷ 현재 주가. 실제 지급 기록만 사용합니다.</li>
          <li><strong>최근 지급액 연환산</strong> = 최근 1회 지급액 × 연간 지급 횟수 ÷ 현재 주가. 같은 금액이 계속된다는 가정의 참고값이며 확정된 연간 지급액이 아닙니다.</li>
          <li>지급 주기는 최근 2년 배당락일 간격의 중앙값으로 판정하며, 간격이 들쭉날쭉하면 &lsquo;기타/불규칙&rsquo;으로 표시합니다.</li>
          <li>특별배당·자본이득 분배는 정기 지급과 분리해 집계합니다.</li>
          <li>수익률 변화 분해: 가격 효과 = 1년 전 {word}을 현재가와 1년 전 가격으로 각각 나눈 차이, {word} 효과 = {word} 증감 ÷ 현재가.</li>
          {splits.length > 0 && <li>주식분할({splits.map((s) => `${s.date} ${s.numerator}:${s.denominator}`).join(", ")}) 이전 지급액은 현재 주식 수 기준으로 조정했습니다.</li>}
          <li>{word}은 변동되거나 감소할 수 있으며, 과거 지급 기록이 미래 지급을 보장하지 않습니다.</li>
        </ul>
      </details>
    </div>
  );
}
