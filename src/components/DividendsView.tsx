/** 배당·분배금 상세 (서버 컴포넌트) */
import type { InstrumentConfig } from "@/config/instruments";
import { distributionWord } from "@/lib/instruments";
import { readDividends, readSplits, dividendSources } from "@/lib/data/dividends";
import { getBars, dailyCloses } from "@/lib/data/bars";
import { summarizeDividends, FREQUENCY_KO, isRegular } from "@/lib/dividend-analytics";
import { periodStart, periodStats, sliceFrom } from "@/lib/performance";
import { fmtDividend, fmtPct, fmtUsd } from "@/lib/format";
import { etDate } from "@/lib/time";
import BarChartSvg from "./BarChartSvg";
import { Empty, Notice, Stat } from "./ui";

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
  const chartPts = divs
    .filter((d) => d.exDate > `${Number(today.slice(0, 4)) - 5}-01-01`)
    .map((d) => ({ label: d.exDate, value: d.amount, sub: `${KIND_KO[d.kind]} · 지급일 ${d.payDate ?? "미제공"}`, muted: !isRegular(d) }));

  return (
    <div className="flex flex-col gap-5">
      {isOption && (
        <Notice tone="warn" title="커버드콜·옵션 인컴 ETF 분배금 이해하기">
          이 ETF 의 분배금은 보유 주식 배당뿐 아니라 콜옵션 매도로 얻은 옵션 프리미엄 등 여러 수익원에서 나오며, 시장 변동성에 따라 매달 달라지고 줄어들 수 있습니다.
          일반 기업이 이익에서 지급하는 배당금과 같은 개념이 아닙니다. 일부는 자본환급(ROC)으로 분류될 수 있으며(운용사 19a-1 공시 참조), 높은 분배율이 높은 총수익을 뜻하지 않습니다.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`최근 ${word} (주당)`} value={fmtDividend(sum.latest?.amount)} sub={`배당락일 ${sum.latest?.exDate ?? "-"} · 지급일 ${sum.latest?.payDate ?? "미제공"}`} />
        <Stat label="직전 대비 변동" value={fmtPct(sum.latestChangePct)} sub={`직전 ${fmtDividend(sum.previous?.amount)} · 1년 전 회차 대비 ${fmtPct(sum.yoyChangePct)}`} />
        <Stat label="최근 12개월 지급 합계" value={fmtDividend(sum.ttmSum)} sub={`${sum.ttmCount}회 지급${sum.ttmSpecialSum ? ` · 특별/자본이득 ${fmtDividend(sum.ttmSpecialSum)} 별도` : ""}`} />
        <Stat label="지급 주기 (지급 기록 기준)" value={FREQUENCY_KO[sum.frequency.label]} sub={sum.frequency.basis} />
        <Stat label="TTM 수익률" value={fmtPct(sum.ttmYield, 2, false)} sub={`최근 12개월 실제 지급액 ÷ 현재가 ${fmtUsd(price)}`} />
        <Stat
          label="최근 지급액 연환산 수익률 (참고)"
          value={sum.annualizedLatestYield !== null ? fmtPct(sum.annualizedLatestYield, 2, false) : "계산 안 함"}
          sub={sum.frequency.perYear ? `${fmtDividend(sum.latest?.amount)} × ${sum.frequency.perYear}회 ÷ 현재가 — 확정 연간 지급액 아님` : "지급 주기가 불규칙해 연환산하지 않습니다"}
        />
        <Stat
          label="제공처 기재 지급 주기"
          value={sum.frequency.reportedPerYear ? `연 ${sum.frequency.reportedPerYear}회` : "미제공"}
          sub={sum.frequency.consistentWithReported === false ? "지급 기록 판정과 다름 — 기록 기준을 우선 표시" : "Polygon 제공 시 표시"}
        />
        <Stat
          label={`발표된 다음 ${word}`}
          value={sum.upcoming[0] ? fmtDividend(sum.upcoming[0].amount) : "발표 없음"}
          sub={sum.upcoming[0] ? `배당락일 ${sum.upcoming[0].exDate} · 지급일 ${sum.upcoming[0].payDate ?? "미제공"}` : "미래 일정은 발표된 경우에만 표시"}
        />
      </div>

      <details className="rounded-lg border border-line p-3 text-sm" open>
        <summary className="font-semibold">수익률 계산 방식</summary>
        <ul className="mt-2 list-disc pl-5 text-ink-2">
          <li><strong>TTM 수익률</strong> = 배당락일이 최근 365일 안에 있는 정기 {word} 합계 ÷ 현재 주가. 실제 지급 기록만 사용합니다.</li>
          <li><strong>최근 지급액 연환산 수익률</strong> = 가장 최근 1회 지급액 × 연간 지급 횟수 ÷ 현재 주가. 같은 금액이 계속 지급된다는 가정의 참고값이며 확정된 연간 지급액이 아닙니다.</li>
          <li>지급 주기는 최근 2년 배당락일 간격의 중앙값으로 판정하며, 간격이 들쭉날쭉하면 &lsquo;기타/불규칙&rsquo;으로 표시합니다.</li>
          <li>특별배당·자본이득 분배는 정기 지급과 분리해 집계합니다.</li>
          {splits.length > 0 && <li>주식분할({splits.map((s) => `${s.date} ${s.numerator}:${s.denominator}`).join(", ")}) 이전 지급액은 현재 주식 수 기준으로 조정했습니다.</li>}
          <li>{word}은 변동되거나 감소할 수 있으며, 과거 지급 기록이 미래 지급을 보장하지 않습니다.</li>
        </ul>
      </details>

      <div>
        <h3 className="mb-2 text-sm font-semibold">가격 수익률 vs {word} 포함 총수익률</h3>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>기간</th>
                <th className="r">가격 수익률</th>
                <th className="r">총수익률 (재투자 가정)</th>
                <th className="r">총수익률 (현금 수령)</th>
                <th className="r">기간 중 {word}</th>
              </tr>
            </thead>
            <tbody>
              {trRows.map(({ k, stats }) => (
                <tr key={k}>
                  <td>{k === "1y" ? "1년" : k === "3y" ? "3년" : "5년"}</td>
                  {stats ? (
                    <>
                      <td className="r">{fmtPct(stats.priceReturn)}</td>
                      <td className="r">{fmtPct(stats.totalReturnReinvested)}</td>
                      <td className="r">{fmtPct(stats.totalReturnCash)}</td>
                      <td className="r">{fmtDividend(stats.distributions)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="text-xs text-muted">기간 전체 가격 데이터 없음 (상장 기간 부족 또는 미수집)</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-muted">재투자 가정: 배당락일 종가로 즉시 재투자 · 세금·수수료 미반영 · 가격 데이터 {barsRes.meta.source ?? "-"}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold">{word} 지급 기록 (최근 5년, 주당)</h3>
          {chartPts.length ? (
            <BarChartSvg points={chartPts} valueFormat="usd3" ariaLabel={`${inst.symbol} ${word} 지급 기록 막대 차트`} />
          ) : (
            <Empty>최근 5년 지급 기록 없음</Empty>
          )}
          <p className="text-[11px] text-muted">회색 막대는 특별·자본이득 분배</p>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">연도별 {word} 합계 (배당락일 기준)</h3>
          <BarChartSvg
            points={sum.yearly.slice(-10).map((y) => ({ label: String(y.year), value: y.sum, sub: `${y.count}회${y.partial ? " · 올해 진행 중(부분 합계)" : ""}`, muted: y.partial }))}
            valueFormat="usd2"
            ariaLabel={`${inst.symbol} 연도별 ${word} 합계`}
          />
          <p className="text-[11px] text-muted">회색 막대는 올해 진행 중인 부분 합계</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">과거 지급 내역</h3>
        <div className="max-h-[480px] overflow-auto">
          <table className="table-basic">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th>배당락일</th>
                <th>지급일</th>
                <th className="r">주당 지급액</th>
                <th>지급 유형</th>
                <th className="r">직전 대비</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d, i) => {
                const prev = history.slice(i + 1).find((x) => isRegular(x));
                const chg = isRegular(d) && prev ? (d.amount / prev.amount - 1) * 100 : null;
                return (
                  <tr key={`${d.exDate}${d.kind}`} className={d.exDate > today ? "bg-accent-soft" : ""}>
                    <td className="num">{d.exDate}{d.exDate > today ? " (예정)" : ""}</td>
                    <td className="num">{d.payDate ?? <span className="text-muted">미제공</span>}</td>
                    <td className="r">
                      {fmtDividend(d.amount)}
                      {d.splitAdjusted && d.amountRaw !== null && <span className="block text-[10px] text-muted">분할 전 {fmtDividend(d.amountRaw)}</span>}
                    </td>
                    <td>
                      {word} · {KIND_KO[d.kind]}
                    </td>
                    <td className={`r ${chg === null ? "" : chg >= 0 ? "text-up" : "text-down"}`}>{fmtPct(chg)}</td>
                    <td className="text-xs text-muted">{d.sources.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-muted">데이터 출처: {dividendSources(divs).join(", ")} · 지급일은 Nasdaq/Polygon 이 제공하는 경우에만 표시됩니다.</p>
      </div>
    </div>
  );
}
