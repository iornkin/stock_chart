"use client";
/** 배당·분배금 품질 비교표 (분류 필터·정렬) — 값은 서버에서 실제 기록으로 계산해 넘긴다 */
import Link from "next/link";
import { useState } from "react";
import { fmtPct } from "@/lib/format";
import { VOL_LEVEL_RULE, type DividendQuality } from "@/lib/dividend-quality";

export interface QualityRow {
  symbol: string;
  name: string;
  category: string;
  categoryLabel: string;
  word: string;
  q: DividendQuality;
  divSources: string[];
  priceSource: string | null;
  /** 일봉(분배금 이벤트 포함) 마지막 수집 시각 */
  fetchedAt: number | null;
  /** 오래된 데이터 사유 (없으면 빈 배열) */
  stale: string[];
  officialUrl: string | null;
  optionIncome: boolean;
}

type SortKey = "default" | "yield" | "total" | "vol";
const per = (v: number) => `$${v.toFixed(4).replace(/0{1,2}$/, "")}`;
const fmtDate = (t: number | null) => (t ? new Intl.DateTimeFormat("ko-KR", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).format(new Date(t)) : "-");

export default function DividendQualityTable({ rows }: { rows: QualityRow[] }) {
  const cats = [...new Map(rows.map((r) => [r.category, r.categoryLabel])).entries()];
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<SortKey>("default");
  let list = cat === "all" ? rows : rows.filter((r) => r.category === cat);
  const by = (f: (r: QualityRow) => number | null, dir = -1) => [...list].sort((a, b) => dir * ((f(a) ?? (dir < 0 ? -Infinity : Infinity)) - (f(b) ?? (dir < 0 ? -Infinity : Infinity))));
  if (sort === "yield") list = by((r) => r.q.ttmYield);
  if (sort === "total") list = by((r) => r.q.totalReturn1y);
  if (sort === "vol") list = by((r) => r.q.volatility?.cvPct ?? null, 1);

  // 실제 값으로 '수익률이 높다고 총수익률이 높지 않은' 경우가 있으면 보여 줌
  // 레버리지 ETF 는 성격이 달라 비교 예시에서 뺀다
  const withBoth = list.filter((r) => r.category !== "leveraged" && r.q.ttmYield !== null && r.q.totalReturn1y !== null);
  const topYield = [...withBoth].sort((a, b) => (b.q.ttmYield as number) - (a.q.ttmYield as number))[0];
  const topTotal = [...withBoth].sort((a, b) => (b.q.totalReturn1y as number) - (a.q.totalReturn1y as number))[0];
  const contrast = topYield && topTotal && topYield.symbol !== topTotal.symbol && (topTotal.q.ttmYield as number) < (topYield.q.ttmYield as number) ? { topYield, topTotal } : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs leading-relaxed text-ink">
        <strong>분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다.</strong> 분배금을 주면 그만큼 가격이 내려가고, 옵션 인컴 ETF 는 상승 참여가 제한될 수 있습니다. 가격 수익률과 분배금 재투자 총수익률을 함께 보세요.
        {contrast && (
          <span className="mt-1 block text-ink-2">
            이 표 기준 (레버리지 제외): 분배금 수익률이 가장 높은 {contrast.topYield.symbol}({fmtPct(contrast.topYield.q.ttmYield, 2, false)})의 1년 총수익률은 {fmtPct(contrast.topYield.q.totalReturn1y)}이고, 1년 총수익률이 가장 높은 {contrast.topTotal.symbol}의 분배금 수익률은 {fmtPct(contrast.topTotal.q.ttmYield, 2, false)}, 총수익률은 {fmtPct(contrast.topTotal.q.totalReturn1y)}입니다. (과거 1년 결과이며 앞으로를 뜻하지 않음)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg" role="group" aria-label="분류">
          <button type="button" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
            전체
          </button>
          {cats.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)}>
              {l.replace(" ETF", "").replace("대형 기술주", "")}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="정렬">
          <button type="button" aria-pressed={sort === "default"} onClick={() => setSort("default")}>
            기본
          </button>
          <button type="button" aria-pressed={sort === "yield"} onClick={() => setSort("yield")}>
            분배금 수익률
          </button>
          <button type="button" aria-pressed={sort === "total"} onClick={() => setSort("total")}>
            1년 총수익률
          </button>
          <button type="button" aria-pressed={sort === "vol"} onClick={() => setSort("vol")}>
            변동 작은 순
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[1280px]">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">최근 12개월 (주당)</th>
              <th className="r">TTM 수익률</th>
              <th className="r">연간 변화</th>
              <th className="r">직전 대비</th>
              <th className="r">1년 가격</th>
              <th className="r">1년 총수익률</th>
              <th className="r">지급 변동성</th>
              <th title="배당·이자·자본이득·원금 반환 구성">분배금 구성</th>
              <th className="min-w-[230px]">기준·출처</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const q = r.q;
              return (
                <tr key={r.symbol}>
                  <td>
                    <Link href={`/stock/${r.symbol}?tab=dividends`} className="font-semibold hover:text-accent">
                      {r.symbol}
                    </Link>
                    <span className="ml-1 text-xs text-muted">{r.name}</span>
                  </td>
                  <td className="r">
                    {q.ttmCount ? per(q.ttmSum) : "-"}
                    <span className="block text-[11px] text-muted">{q.ttmCount}회{q.ttmSpecialSum ? ` · 특별 ${per(q.ttmSpecialSum)} 별도` : ""}</span>
                  </td>
                  <td className="r font-semibold">{fmtPct(q.ttmYield, 2, false)}</td>
                  <td className="r">
                    {q.annual ? (
                      <>
                        <span className={q.annual.changePct >= 0 ? "text-up" : "text-down"}>{fmtPct(q.annual.changePct, 1)}</span>
                        <span className="block whitespace-nowrap text-[11px] text-muted">{q.annual.year}년 vs 전년</span>
                      </>
                    ) : (
                      <span className="whitespace-nowrap text-[11px] text-muted">기록 부족</span>
                    )}
                  </td>
                  <td className="r">{q.latestChangePct !== null ? <span className={q.latestChangePct >= 0 ? "text-up" : "text-down"}>{fmtPct(q.latestChangePct, 1)}</span> : "-"}</td>
                  <td className="r">{q.priceReturn1y !== null ? <span className={q.priceReturn1y >= 0 ? "text-up" : "text-down"}>{fmtPct(q.priceReturn1y, 1)}</span> : <span className="text-[11px] text-muted">기간 부족</span>}</td>
                  <td className="r font-semibold">{q.totalReturn1y !== null ? <span className={q.totalReturn1y >= 0 ? "text-up" : "text-down"}>{fmtPct(q.totalReturn1y, 1)}</span> : <span className="text-[11px] font-normal text-muted">기간 부족</span>}</td>
                  <td className="r whitespace-nowrap">
                    {q.volatility ? (
                      <>
                        {q.volatility.level} <span className="text-[11px] text-muted">({q.volatility.cvPct.toFixed(1)}%)</span>
                        <span className="block whitespace-nowrap text-[11px] text-muted">
                          {q.volatility.n}회 · 감소 {q.volatility.decreases}회
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted">기록 4회 미만</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    <span className="text-muted">제공처 미제공</span>
                    {q.flaggedTtm > 0 && <span className="block text-[11px] text-ink-2">특별·자본이득 표시 {q.flaggedTtm}건 (최근 12개월)</span>}
                    {r.officialUrl && (
                      <a className="link block text-[11px]" href={r.officialUrl} target="_blank" rel="noopener noreferrer">
                        공식 자료 보기
                      </a>
                    )}
                  </td>
                  <td className="text-[11px] leading-snug">
                    <span className={r.stale.length ? "text-warn" : "text-muted"}>
                      {fmtDate(r.fetchedAt)} 수집{q.returnPeriod ? ` · 종가 ${q.returnPeriod.end}` : ""}
                      {r.stale.length > 0 && ` · ${r.stale.join(", ")}`}
                    </span>
                    <span className="block text-muted">
                      {r.word} {r.divSources.join("·") || "-"}
                      {r.priceSource ? ` / 가격 ${r.priceSource}` : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="list-disc pl-5 text-[11px] leading-relaxed text-muted">
        <li>1년 전체가 기록된 연도가 2개 미만이면 연간 변화를 &lsquo;기록 부족&rsquo;으로 둡니다.</li>
        <li>최근 12개월·TTM 수익률: 배당락일이 최근 365일 안인 정기 지급 합계 (특별·자본이득 분배 제외) ÷ 현재가.</li>
        <li>연간 변화: 1년 전체가 기록된 가장 최근 연도의 합계(특별 분배 포함)를 그 전해와 비교. 올해와 자료 첫해는 제외합니다.</li>
        <li>1년 가격·총수익률: 같은 기간 일봉 종가 기준. 총수익률은 배당락일 종가로 분배금을 재투자했다고 가정 (세금·수수료 미반영).</li>
        <li>지급 변동성: 최근 3년 안 정기 지급 최대 12회의 변동 계수(표준편차 ÷ 평균). {VOL_LEVEL_RULE}. 분기마다 금액이 다른 계절성도 변동으로 잡힙니다.</li>
        <li>구성: 회차별 배당·이자·자본이득·원금 반환(ROC) 비율은 지금 데이터 제공처에서 받지 않아 추정하지 않습니다. ETF 의 구성 내역은 운용사의 19a-1 공시·연말 세금 자료에서 확인하세요.</li>
        <li>수집 시각이 4일 넘게 지났으면 노란색으로 표시합니다. 그 값을 최신 값으로 보지 마세요.</li>
      </ul>
    </div>
  );
}
