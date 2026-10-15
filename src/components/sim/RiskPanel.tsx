"use client";
/** 위험·안정성 지표 표 + 1년 이동 창 차트 (포트폴리오 백테스트·전략 백테스트 공용) */
import { useMemo, useState } from "react";
import { riskReport, type Metric, type RiskReport } from "@/lib/sim/risk-metrics";
import { Fold } from "@/components/ui";
import { Seg, pct } from "./common";
import { SimLineChart, SERIES_VARS } from "./charts";

export interface RiskItem {
  name: string;
  dates: string[];
  /** 시간가중 가치 지수 */
  index: number[];
  cagrPct: number | null;
  mddPct: number;
}

const m = (x: Metric, f: (v: number) => string) => (x.value !== null ? f(x.value) : <span className="text-[11px] text-muted" title={x.note ?? ""}>계산 불가{x.note ? ` (${x.note})` : ""}</span>);

export default function RiskPanel({ items, bench, rfPct }: { items: RiskItem[]; bench: { name: string; dates: string[]; index: number[] } | null; rfPct: number }) {
  const reports: RiskReport[] = useMemo(
    () =>
      items.map((it) => {
        let b: number[] | null = null;
        if (bench) {
          const bm = new Map(bench.dates.map((d, i) => [d, bench.index[i]]));
          const arr = it.dates.map((d) => bm.get(d));
          b = arr.every((x) => x !== undefined) ? (arr as number[]) : null;
        }
        return riskReport(it.dates, it.index, { rfPct, cagrPct: it.cagrPct, mddPct: it.mddPct, bench: b });
      }),
    [items, bench, rfPct],
  );
  const [rk, setRk] = useState<"retPct" | "volPct" | "sharpe" | "mddPct">("retPct");
  const row = (label: string, f: (r: RiskReport, i: number) => React.ReactNode, help: string) => (
    <tr>
      <th className="text-left font-normal text-ink-2" title={help}>
        {label}
      </th>
      {reports.map((r, i) => (
        <td key={i} className="r">
          {f(r, i)}
        </td>
      ))}
    </tr>
  );
  const per = (x: { key: string; retPct: number } | null) => (x ? <span className={x.retPct < 0 ? "text-down" : "text-up"}>{`${pct(x.retPct, 1)} (${x.key})`}</span> : <span className="text-[11px] text-muted">완전한 기간 없음</span>);
  const rollDates = reports[0]?.rolling.map((p) => p.date) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[560px]">
          <thead>
            <tr>
              <th />
              {items.map((it) => (
                <th key={it.name} className="r">
                  {it.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row("하방 변동성 (연)", (r) => m(r.downsideVolPct, (v) => `${v.toFixed(1)}%`), "0 보다 낮은 일간 수익률만으로 잰 흔들림")}
            {row("소르티노 비율", (r) => m(r.sortino, (v) => v.toFixed(2)), "(연 평균 수익률 − 무위험) ÷ 하방 변동성")}
            {row("칼마 비율", (r) => m(r.calmar, (v) => v.toFixed(2)), "연환산 수익률 ÷ |최대 낙폭|")}
            {row("하루 VaR 95%", (r) => m(r.var95, (v) => `−${v.toFixed(2)}%`), "과거 일간 수익률 중 하위 5% 경계의 손실 — 20일 중 하루는 이보다 나빴음")}
            {row("하루 CVaR 95%", (r) => m(r.cvar95, (v) => `−${v.toFixed(2)}%`), "하위 5% 날들의 평균 손실 (기대 손실)")}
            {row("월간 VaR 95%", (r) => m(r.monthlyVar95, (v) => `−${v.toFixed(1)}%`), "완전한 달의 월 수익률 하위 5% 경계")}
            {row("최악의 달 / 분기 / 연도", (r) => (
              <span className="flex flex-col text-[12px]">
                {per(r.worstMonth)}
                {per(r.worstQuarter)}
                {per(r.worstYear)}
              </span>
            ), "처음·끝이 잘린 기간은 빼고 비교")}
            {row("최고의 연도", (r) => per(r.bestYear), "1년 전체가 있는 연도 중")}
            {row("오른 달 비율", (r) => m(r.positiveMonthsPct, (v) => `${v.toFixed(0)}%`), "완전한 달 중 수익률이 0 보다 큰 달")}
            {row("가장 긴 하락 지속", (r) => (r.dd ? (r.dd.longestDays ? <span className="text-[12px]">{r.dd.longestCalendarDays}일 ({r.dd.longestFrom} ~ {r.dd.longestTo}){!r.dd.longestRecovered && <span className="text-warn"> 미회복</span>}</span> : "없음") : "-"), "고점 아래에 머문 가장 긴 기간 (달력일)")}
            {row("최대 낙폭 회복 기간", (r) => (r.dd ? (r.dd.recoveryCalendarDays !== null ? `${r.dd.recoveryCalendarDays}일` : <span className="text-warn">미회복</span>) : "-"), "최대 낙폭 저점에서 이전 고점까지 (달력일)")}
            {row("지금 고점 대비", (r) => (r.dd ? pct(r.dd.currentDrawdownPct, 1) : "-"), "기간 마지막 날 기준")}
            {bench && row(`베타 (${bench.name} 대비)`, (r) => (r.relative ? m(r.relative.beta, (v) => v.toFixed(2)) : "-"), "벤치마크가 1% 움직일 때 평균적으로 움직인 비율 (일간)")}
            {bench && row("알파 (연, 젠센)", (r) => (r.relative ? m(r.relative.alpha, (v) => pct(v, 2)) : "-"), "베타만큼의 시장 수익을 뺀 연 초과 수익 (일간 평균 × 252)")}
            {bench && row("추적 오차 (연)", (r) => (r.relative ? m(r.relative.trackingError, (v) => `${v.toFixed(1)}%`) : "-"), "일간 초과 수익률의 표준편차 × √252")}
            {bench && row("정보 비율", (r) => (r.relative ? m(r.relative.informationRatio, (v) => v.toFixed(2)) : "-"), "연 평균 초과 수익 ÷ 추적 오차")}
            {bench && row("상관계수", (r) => (r.relative ? m(r.relative.correlation, (v) => v.toFixed(2)) : "-"), "일간 수익률 상관")}
          </tbody>
        </table>
      </div>
      {rollDates.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink-2">1년(252거래일) 이동 창 — 기간마다 결과가 얼마나 달랐는지</p>
            <Seg label="이동 창 지표" value={rk} onChange={setRk} options={[{ v: "retPct", l: "1년 수익률" }, { v: "volPct", l: "변동성" }, { v: "sharpe", l: "샤프" }, { v: "mddPct", l: "최대 낙폭" }]} />
          </div>
          <SimLineChart
            dates={rollDates}
            lines={reports.map((r, i) => {
              const mp = new Map(r.rolling.map((p) => [p.date, p[rk]]));
              return { key: items[i].name, label: items[i].name, values: rollDates.map((d) => mp.get(d) ?? null), color: SERIES_VARS[i % SERIES_VARS.length] };
            })}
            format={rk === "sharpe" ? "index" : "pct"}
            baseline={0}
            height={220}
            ariaLabel="1년 이동 창 지표"
          />
        </div>
      ) : (
        <p className="text-xs text-muted">기간이 1년(252거래일)보다 짧아 이동 창 지표를 계산하지 않았습니다.</p>
      )}
      <Fold summary="계산 방법 (공식·빈도·연환산)">
        <ul className="list-disc space-y-1 pl-4 text-xs">
          <li>모두 시간가중 가치 지수(중간 납입 영향 제외)의 일간 수익률 r = 오늘 ÷ 어제 − 1 로 계산합니다. 연환산: 평균 × 252, 표준편차 × √252. 무위험 수익률 연 {rfPct.toFixed(2)}% (÷252 로 일간 환산).</li>
          <li>하방 변동성 = √(평균(min(r − 무위험, 0)²)) × √252 (모든 날을 분모로). 소르티노 = (연 평균 − 무위험) ÷ 하방 변동성. 칼마 = CAGR ÷ |최대 낙폭|.</li>
          <li>VaR 95% = 수익률을 오름차순으로 놓았을 때 ⌈0.05 × 날 수⌉ 번째 값의 손실(역사적 방법, 분포 가정 없음). CVaR = 그보다 나쁜 날들의 평균 손실. 미래의 최대 손실을 뜻하지 않습니다.</li>
          <li>베타 = 공분산(r, b) ÷ 분산(b), 알파 = ((평균 r − rf) − 베타 × (평균 b − rf)) × 252, 추적 오차 = 표준편차(r − b) × √252, 정보 비율 = 평균(r − b) × 252 ÷ 추적 오차. 벤치마크와 같은 날짜만 씁니다.</li>
          <li>최대 낙폭 = 기간 중 고점 대비 저점. 회복 기간 = 그 저점에서 이전 고점을 다시 넘은 날까지. 이동 창 = 252거래일마다(5거래일 간격) 다시 계산.</li>
          <li>데이터가 부족하거나 분모가 0 이면 0 이 아니라 &lsquo;계산 불가&rsquo;로 표시합니다.</li>
        </ul>
      </Fold>
    </div>
  );
}
