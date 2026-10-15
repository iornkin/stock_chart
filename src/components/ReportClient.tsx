"use client";
/** 개인 투자 보고서 — 화면에서 보고 인쇄(PDF 저장)할 수 있다. 계산은 모두 브라우저 안에서 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { INSTRUMENTS } from "@/config/instruments";
import { etToday, useJournal, usePortfolio, useSeriesMap } from "@/lib/client/user-data";
import { heldSymbols, usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { usePortfolioReturns } from "@/lib/client/portfolio-returns";
import { fetchExposure } from "@/lib/client/data-api";
import { useDataCheck } from "@/components/portfolio/DataCheckSection";
import { attributeLedger, attributeSimple } from "@/lib/portfolio/attribution";
import { portfolioExposure } from "@/lib/portfolio/exposure";
import { driftAlerts } from "@/lib/portfolio/rebalance";
import { CHECK_STATUS_KO } from "@/lib/portfolio/data-check";
import type { ExposureResponse } from "@/lib/exposure-types";
import { addDays, closeOn } from "@/lib/sim/series";
import { formatEt } from "@/lib/time";
import { Notice } from "@/components/ui";
import { pct, signedUsd, tone, usd } from "@/components/sim/common";

const M7 = INSTRUMENTS.filter((i) => i.category === "m7").map((i) => i.symbol);

function Block({ n, title, children, tag }: { n: number; title: string; children: React.ReactNode; tag?: "실제" | "추정" | "계산" }) {
  return (
    <section className="break-inside-avoid rounded-xl border border-line bg-surface p-4 print:border-0 print:p-0">
      <h2 className="mb-2 text-[15px] font-bold">
        {n}. {title}
        {tag && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${tag === "추정" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{tag}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function ReportClient() {
  const pf = usePortfolio();
  const p = pf.value;
  const s = usePortfolioSummary(p);
  const ret = usePortfolioReturns(p, s);
  const j = useJournal();
  const check = useDataCheck(p, s);
  const today = etToday();
  const syms = heldSymbols(p);
  const ser = useSeriesMap([...syms, "SPY"]);
  const [exp, setExp] = useState<ExposureResponse | null>(null);
  useEffect(() => {
    fetchExposure().then(setExp).catch(() => setExp(null));
  }, []);

  const periods = useMemo(() => {
    const cal = ser.series.SPY?.dates ?? [];
    if (ser.loading || !cal.length || syms.some((x) => !ser.series[x])) return null;
    const last = cal[cal.length - 1];
    const closeOf = (sym: string, d: string) => {
      const x = ser.series[sym];
      return x ? (closeOn(x, d)?.close ?? null) : null;
    };
    const first = p.mode === "ledger" && p.ledger.length ? [...p.ledger].sort((a, b) => a.date.localeCompare(b.date))[0].date : null;
    const list: [string, string][] = [
      ["1개월", addDays(last, -30)],
      ["3개월", addDays(last, -91)],
      ["연초 이후", `${Number(last.slice(0, 4)) - 1}-12-31`],
      ["1년", addDays(last, -365)],
      ...(first ? ([["기록 전체", first]] as [string, string][]) : []),
    ];
    return list.map(([label, start]) => {
      if (first && start < first) return { label, twr: null as number | null, note: "기록 이전 포함" };
      const a = p.mode === "ledger" ? attributeLedger(p.ledger, cal, closeOf, start, last) : attributeSimple(p.simple.holdings, p.simple.cash, cal, closeOf, (x, f, t) => (ser.series[x]?.divs ?? []).filter((d) => d.ex > f && d.ex <= t).reduce((q, d) => q + d.amount, 0), start, last);
      return { label, twr: "error" in a ? null : a.twrPct, note: "error" in a ? a.error : "" };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ser]);

  const ex = useMemo(() => (exp && !s.loading && !s.empty ? portfolioExposure({ positions: s.holdings.filter((h) => h.value !== null).map((h) => ({ symbol: h.symbol, value: h.value as number })), cash: s.cash, info: exp.items, now: Date.now(), m7Symbols: M7 }) : null), [exp, s]);

  if (!pf.loaded || s.loading) return <div className="skeleton h-96" aria-label="보고서 만드는 중" />;
  if (s.empty)
    return (
      <Notice title="아직 입력한 자산이 없습니다">
        <Link className="link" href="/portfolio">
          내 자산
        </Link>
        에서 보유 종목이나 거래를 입력하면 보고서를 만듭니다.
      </Notice>
    );

  const q = s.oldestQuote;
  const due = j.value.filter((e) => e.reviewDate && e.reviewDate <= today && !e.reviews.some((r) => r.date >= (e.reviewDate as string)));
  const nextReviews = j.value.filter((e) => e.reviewDate && e.reviewDate > today).sort((a, b) => (a.reviewDate as string).localeCompare(b.reviewDate as string)).slice(0, 5);
  const issues = (check.items ?? []).filter((i) => i.status !== "ok");
  const t = p.targets;
  const drift = t?.items.length && !s.missingPrices.length ? driftAlerts(s.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, price: h.price })), s.cash, t.items, t.driftPct) : [];
  const weights = s.holdings.filter((h) => h.value).map((h) => ({ symbol: h.symbol, w: ((h.value as number) / s.totalAssets) * 100 })).sort((a, b) => b.w - a.w);
  let n = 0;

  return (
    <div className="flex flex-col gap-4 print:gap-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          인쇄 / PDF 로 저장
        </button>
        <span className="text-xs text-muted">브라우저 인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 파일로 남습니다. 파일은 서버로 보내지 않습니다.</span>
      </div>
      <p className="text-xs text-ink-2">
        작성 {formatEt(Date.now())} · 평가 기준 시세 {q ? `${formatEt(q.marketTime ?? q.fetchedAt)} (가장 오래된 종목 ${q.symbol}, ${q.delay?.text ?? "지연 데이터"})` : "없음"} · 달러 기준 · 입력 방식 {p.mode === "ledger" ? "거래 내역" : "간편 입력"}
      </p>

      <Block n={++n} title="전체 자산 현황" tag="실제">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">총자산</p>
            <p className="num font-bold">{usd(s.totalAssets, 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">평가금액</p>
            <p className="num font-semibold">{usd(s.marketValue, 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">현금</p>
            <p className="num font-semibold">{usd(s.cash, 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">보유 종목</p>
            <p className="num font-semibold">{s.holdings.length}개</p>
          </div>
        </div>
        {s.missingPrices.length > 0 && <p className="mt-1 text-xs text-warn">시세 없는 종목({s.missingPrices.join(", ")})은 평가금액에서 빠졌습니다.</p>}
      </Block>

      <Block n={++n} title="투자 원금과 평가금액" tag="실제">
        <p className="text-sm">
          {p.mode === "ledger" ? "순납입 원금" : "매수 원가"} {usd(p.mode === "ledger" ? (s.netContributions ?? 0) : s.totalCost, 0)} → 총자산 {usd(s.totalAssets, 0)}
          {ret.r.usd.totalReturnPct !== null && (
            <>
              {" "}
              · 총손익 <span className={tone(ret.r.usd.totalGain)}>{signedUsd(ret.r.usd.totalGain)}</span> (<span className={tone(ret.r.usd.totalReturnPct)}>{pct(ret.r.usd.totalReturnPct)}</span>)
            </>
          )}
        </p>
        {ret.r.krw && ret.r.krw.totalReturnPct !== null && <p className="mt-1 text-xs text-ink-2">원화 기준(환율 반영) 총수익률 {pct(ret.r.krw.totalReturnPct)}</p>}
      </Block>

      <Block n={++n} title="기간별 수익률 (입출금 영향 제외)" tag={p.mode === "ledger" ? "계산" : "추정"}>
        {!periods ? (
          <p className="text-xs text-muted">일별 가격을 불러오는 중이거나 없는 종목이 있습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {periods.map((x) => (
              <div key={x.label}>
                <p className="text-xs text-muted">{x.label}</p>
                <p className={`num font-semibold ${tone(x.twr)}`}>{x.twr !== null ? pct(x.twr) : "-"}</p>
                {x.twr === null && x.note && <p className="text-[10px] text-muted">{x.note}</p>}
              </div>
            ))}
          </div>
        )}
        {p.mode === "simple" && <p className="mt-1 text-[11px] text-muted">간편 입력은 거래 기록이 없어 지금 수량을 기간 내내 들고 있었다고 가정했습니다.</p>}
      </Block>

      <Block n={++n} title="종목별 수익 기여도" tag="실제">
        <table className="table-basic text-sm">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">평가금액</th>
              <th className="r">평가손익</th>
              <th className="r">실현손익</th>
              <th className="r">받은 분배금 (세후)</th>
              <th className="r">총손익</th>
            </tr>
          </thead>
          <tbody>
            {[...ret.r.holdings].sort((a, b) => (b.usd.totalGain ?? 0) - (a.usd.totalGain ?? 0)).map((h) => (
              <tr key={h.symbol}>
                <td className="font-semibold">{h.symbol}</td>
                <td className="r">{usd(h.usd.value, 0)}</td>
                <td className={`r ${tone(h.usd.unrealized)}`}>{signedUsd(h.usd.unrealized)}</td>
                <td className="r">{h.usd.realized ? signedUsd(h.usd.realized) : "-"}</td>
                <td className="r">{h.usd.dividends ? usd(h.usd.dividends) : "-"}</td>
                <td className={`r font-semibold ${tone(h.usd.totalGain)}`}>{signedUsd(h.usd.totalGain)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ret.r.dividendsEstimated && <p className="mt-1 text-[11px] text-warn">간편 입력의 분배금은 실제 지급 기록 × 지금 수량으로 추정한 값입니다.</p>}
      </Block>

      <Block n={++n} title="자산 배분" tag="실제">
        <p className="text-sm">{weights.map((w) => `${w.symbol} ${w.w.toFixed(1)}%`).join(" · ")} · 현금 {s.totalAssets > 0 ? ((s.cash / s.totalAssets) * 100).toFixed(1) : 0}%</p>
        {ex && <p className="mt-1 text-xs text-ink-2">유형별: {ex.styles.map((x) => `${x.label} ${x.pct.toFixed(1)}%`).join(" · ")}</p>}
      </Block>

      <Block n={++n} title="ETF 중복 노출" tag="계산">
        {!ex ? (
          <p className="text-xs text-muted">편입 종목 자료를 불러오지 못했거나 불러오는 중입니다.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            <li>M7 대형 기술주 노출(직접 + ETF 상위 편입, 최소): {ex.m7.pct.toFixed(1)}%</li>
            {ex.overlaps[0] && (
              <li>
                가장 많이 겹치는 ETF: {ex.overlaps[0].a} ↔ {ex.overlaps[0].b} {ex.overlaps[0].overlapPct.toFixed(1)}% ({ex.overlaps[0].common.join(", ") || "상위 편입 중 겹치는 종목 없음"})
              </li>
            )}
            <li>
              같은 종목 실제 노출 상위: {ex.lookthrough
                .slice(0, 5)
                .map((x) => `${x.symbol} ${x.pct.toFixed(1)}%`)
                .join(" · ")}
            </li>
            <li className="text-xs text-muted">투자금 중 종목까지 확인한 비율 {ex.knownPct.toFixed(1)}% (ETF 상위 편입 종목 기준)</li>
          </ul>
        )}
      </Block>

      <Block n={++n} title="배당·분배금 수령 현황">
        <ul className="list-disc pl-5 text-sm">
          {p.mode === "ledger" && (
            <li>
              실제 누적 수령(세전) {usd(s.dividendsActualTotal)} · 최근 12개월 {usd(s.dividendsActualTtm)} (세후 {usd(s.dividendsActualTtmNet)}) <span className="text-[10px] text-muted">실제 기록</span>
            </li>
          )}
          <li>
            예상 연간 분배금 {usd(s.expectedAnnual)} (월평균 {usd(s.expectedAnnual / 12)}, 세전) <span className="rounded bg-warn-soft px-1 text-[10px] text-warn">추정</span> — 지금 수량 × 최근 12개월 실제 주당 지급액
          </li>
          {s.upcoming.length > 0 && <li>발표된 다음 지급: {s.upcoming.slice(0, 4).map((u) => `${u.symbol} ${u.pay ?? u.ex} ${usd(u.amount)}`).join(" · ")}</li>}
        </ul>
      </Block>

      <Block n={++n} title="데이터 오류·확인 사항">
        {!check.items ? (
          <p className="text-xs text-muted">점검 중…</p>
        ) : issues.length ? (
          <ul className="list-disc pl-5 text-sm">
            {issues.slice(0, 8).map((i) => (
              <li key={i.key}>
                <b>{CHECK_STATUS_KO[i.status]}</b> · {i.title}
              </li>
            ))}
            {issues.length > 8 && <li className="text-xs text-muted">외 {issues.length - 8}건 — 내 자산 → 데이터 점검</li>}
          </ul>
        ) : (
          <p className="text-sm">점검한 항목에서 문제를 찾지 못했습니다.</p>
        )}
      </Block>

      <Block n={++n} title="주요 위험 요인" tag="계산">
        <ul className="list-disc pl-5 text-sm">
          {weights[0] && <li>가장 큰 종목 비중: {weights[0].symbol} {weights[0].w.toFixed(1)}%</li>}
          {ex && ex.leveraged.pct > 0 && <li>레버리지 ETF 비중 {ex.leveraged.pct.toFixed(1)}% (배수 반영 실질 노출 {usd(ex.leveraged.effective, 0)}) — 하루 변동의 여러 배로 움직임</li>}
          {ex && ex.m7.pct >= 30 && <li>M7 대형 기술주 노출이 {ex.m7.pct.toFixed(1)}% 이상 — 대형 기술주가 함께 하락하면 영향이 큼</li>}
          {drift.length > 0 && <li>목표 비중에서 벗어난 항목: {drift.map((d) => `${d.symbol} ${d.diffPct > 0 ? "+" : ""}${d.diffPct.toFixed(1)}%p`).join(" · ")}</li>}
          {ex && ex.sectors[0] && <li>가장 큰 섹터: {ex.sectors[0].sector} {ex.sectors[0].pct.toFixed(1)}% (미분류 {ex.sectorUnknownPct.toFixed(1)}%)</li>}
        </ul>
        <p className="mt-1 text-[11px] text-muted">하락 시 예상 손실은 &lsquo;미래 시뮬레이터 → 스트레스 테스트&rsquo;에서 가정별로 계산합니다 (예측 아님).</p>
      </Block>

      <Block n={++n} title="재검토할 투자 기록">
        {due.length ? (
          <ul className="list-disc pl-5 text-sm">
            {due.map((e) => (
              <li key={e.id}>
                {e.symbol} {e.date} 기록 — 다시 볼 날 {e.reviewDate} 지남: {e.reason.slice(0, 60)}
                {e.reason.length > 60 ? "…" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">다시 볼 날이 지난 기록이 없습니다.</p>
        )}
      </Block>

      <Block n={++n} title="다음 검토 때 확인할 것">
        <ul className="list-disc pl-5 text-sm">
          {nextReviews.map((e) => (
            <li key={e.id}>
              {e.reviewDate}: {e.symbol} 투자 기록 재검토
            </li>
          ))}
          {s.upcoming.slice(0, 3).map((u) => (
            <li key={u.symbol + u.ex}>
              {u.ex}: {u.symbol} 배당락 (지급 {u.pay ?? "미제공"})
            </li>
          ))}
          {issues.some((i) => i.status === "stale") && <li>오래된 데이터가 갱신됐는지 (데이터 점검)</li>}
          <li>증권사 실제 잔고와 이 보고서의 수량·현금이 맞는지</li>
        </ul>
      </Block>
      <p className="text-[11px] leading-relaxed text-muted">이 보고서는 입력한 기록과 수집된 시세로 만든 참고 자료이며 투자 권유가 아닙니다. &lsquo;추정&rsquo; 표시는 가정이 들어간 값입니다. 미래 시뮬레이션 결과는 넣지 않았습니다.</p>
    </div>
  );
}
