/**
 * 종목 상세 → 포지션·심리 탭 (서버에서 그림)
 * 네 가지 자료(공매도 잔고·일일 공매도 거래량·옵션 통계·기관 13F)를 따로 보여 주고,
 * 시장 전체 투자심리는 '참고 — 이 종목 값 아님'으로 분리한다. 자료가 없으면 비워 둔다(다른 값으로 채우지 않음).
 */
import Link from "next/link";
import { STALE_DAYS } from "@/config/positioning";
import { fmtCompact, fmtInt, fmtUsdCompact } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { HOLDING_STATUS_KO, ageDays, holdingChange, isStale, putCallSummary, sentimentSummary, shortInterestSummary, shortVolumeSummary, publishedRatioConsistent, ratio } from "@/lib/positioning";
import type { MarketSentimentData, SymbolPositioning } from "@/lib/data/positioning";
import { Empty, Fold, Notice, Section, SourceLine, Stat } from "@/components/ui";
import { ColumnSvg, LineSvg } from "./Charts";
import { fgLabel } from "./FearGreed";

const signedPct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const signedInt = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtInt(Math.abs(v))}`);

function Stale({ date, max, now, what }: { date: string | null | undefined; max: number; now: number; what: string }) {
  if (!isStale(date, now, max)) return null;
  return (
    <Notice tone="warn">
      {what} 최근 자료가 {date ?? "없음"} 기준으로 {ageDays(date, now) ?? "?"}일 지났습니다 (기준 {max}일). 출처 갱신이 늦거나 수집에 실패했을 수 있습니다.
    </Notice>
  );
}

export default function SymbolPositioningView({ data, market, now }: { data: SymbolPositioning; market: MarketSentimentData; now: number }) {
  const si = data.shortInterest ? shortInterestSummary(data.shortInterest.points, data.shortInterest.floatShares, now) : null;
  const sv = data.shortVolume ? shortVolumeSummary(data.shortVolume.points) : null;
  const pc = data.options ? putCallSummary(data.options.points) : null;
  const sent = market.sentiment ? sentimentSummary(market.sentiment.rows, market.sentiment.averages) : null;
  const eq = market.marketOptions?.rows.filter((r) => r.product === "equity") ?? [];
  const eqLast = eq.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <Notice title="이 탭의 지표는 서로 다른 자료입니다">
        <span className="block">
          <b>공매도 잔고</b>는 결제일 기준으로 아직 갚지 않은 숏 포지션 수량(월 2회), <b>일일 공매도 거래량</b>은 그날 장외 보고 거래 중 공매도로 체결된 비중, <b>옵션 풋/콜 비율</b>은 옵션 거래·미결제약정 통계, <b>기관 13F</b>는 분기 말 시점의 공시된 롱 보유입니다.
          어느 것도 &lsquo;지금 투자자 중 롱과 숏의 비율&rsquo;이 아니며, 이 사이트는 그런 비율을 만들어 내지 않습니다 (
          <Link href="/sentiment#long-short" className="link">
            왜 없는지
          </Link>
          ).
        </span>
      </Notice>

      {/* ── 공매도 잔고 ── */}
      <Section title="공매도 잔고 (Short Interest)" description="결제일 기준 보고 수량 — 실시간 값이 아닙니다">
        {si?.latest ? (
          <div className="flex flex-col gap-3">
            <Stale date={si.latest.date} max={STALE_DAYS.shortInterest} now={now} what="공매도 잔고" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="공매도 잔고" value={`${fmtCompact(si.latest.shortQty)}주`} sub={`결제일 ${si.latest.date}`} />
              <Stat label="직전 보고 대비" value={si.splitNote ? "비교 안 함" : signedPct(si.changePct)} sub={si.splitNote ? "이번 주기 주식분할" : `${signedInt(si.change)}주`} />
              <Stat label="유통주식 대비" value={si.pctFloat !== null ? `${si.pctFloat.toFixed(2)}%` : "계산 안 함"} sub={si.pctFloat !== null ? "잔고 ÷ 유통주식 수" : data.kind === "etf" ? "ETF 는 유통주식 수 자료 없음" : "유통주식 수 자료 없음"} />
              <Stat label="Days to Cover" value={si.daysToCover !== null ? `${si.daysToCover.toFixed(2)}일` : "계산 안 함"} sub="잔고 ÷ 평균 일일 거래량" />
              <Stat label="평균 일일 거래량" value={si.latest.avgDailyVolume ? `${fmtCompact(si.latest.avgDailyVolume)}주` : "자료 없음"} sub="FINRA 집계" />
            </div>
            <ColumnSvg labels={si.history.map((p) => p.date)} values={si.history.map((p) => p.shortQty)} ariaLabel={`${data.symbol} 공매도 잔고 추이`} valueLabel="공매도 잔고(주)" />
            <Fold summary="결제일별 표">
              <div className="overflow-x-auto">
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>결제일</th>
                      <th className="r">공매도 잔고</th>
                      <th className="r">직전 대비</th>
                      <th className="r">평균 일일 거래량</th>
                      <th className="r">Days to Cover</th>
                      <th>표시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...si.history].reverse().map((p, i, arr) => {
                      const prev = arr[i + 1]?.shortQty ?? p.prevQty;
                      return (
                        <tr key={p.date}>
                          <td>{p.date}</td>
                          <td className="r num">{fmtInt(p.shortQty)}</td>
                          <td className="r num">{p.split || prev === null || !prev ? "-" : signedPct(((p.shortQty - prev) / prev) * 100)}</td>
                          <td className="r num">{p.avgDailyVolume ? fmtInt(p.avgDailyVolume) : "-"}</td>
                          <td className="r num">{ratio(p.shortQty, p.avgDailyVolume)?.toFixed(2) ?? "-"}</td>
                          <td className="text-xs text-muted">{[p.revised ? "직전 값 정정" : "", p.split ? "주식분할" : ""].filter(Boolean).join(", ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Fold>
            <SourceLine>
              출처: {data.shortInterest!.info.source} · 증권사가 보고한 결제일 기준 숏 포지션 합계(월 2회), 결제일 약 8영업일 뒤 공표 · 수집 {formatEt(data.shortInterest!.info.fetchedAt)}
              {data.shortInterest!.floatSource ? ` · 유통주식 수: ${data.shortInterest!.floatSource.source} (수집 ${formatEt(data.shortInterest!.floatSource.fetchedAt)}, 공매도 결제일과 시점이 다를 수 있음)` : ""}
              . Days to Cover 는 FINRA 평균 일일 거래량으로 직접 계산했습니다.
            </SourceLine>
          </div>
        ) : (
          <Empty>공매도 잔고 자료가 아직 없습니다 (FINRA 수집 전이거나 이 종목 보고가 없음).</Empty>
        )}
      </Section>

      {/* ── 일일 공매도 거래량 ── */}
      <Section title="일일 공매도 거래량 (Short Volume)" description="잔고가 아니라 그날 거래 중 공매도로 체결된 비중 — 장외 보고분만">
        {sv?.latest ? (
          <div className="flex flex-col gap-3">
            <Stale date={sv.latest.date} max={STALE_DAYS.shortVolume} now={now} what="공매도 거래량" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="공매도 거래 비중" value={sv.latest.ratioPct !== null ? `${sv.latest.ratioPct.toFixed(1)}%` : "계산 안 함"} sub={`${sv.latest.date} · 장외 보고 거래 중`} />
              <Stat label="최근 20거래일 평균" value={sv.avg20 !== null ? `${sv.avg20.toFixed(1)}%` : "자료 부족"} sub={`${sv.samples}일 기준`} />
              <Stat label="공매도 거래량" value={`${fmtCompact(sv.latest.shortVolume)}주`} />
              <Stat label="장외 보고 거래량" value={`${fmtCompact(sv.latest.totalVolume)}주`} sub="거래소 체결분 제외" />
            </div>
            <LineSvg dates={sv.history.map((p) => p.date)} series={[{ key: "r", label: "공매도 거래 비중", color: "var(--s1)", values: sv.history.map((p) => p.ratioPct) }]} fmt="pct" ariaLabel={`${data.symbol} 일일 공매도 거래 비중`} />
            <SourceLine>
              출처: {data.shortVolume!.info.source} · FINRA 장외 보고 시설(TRF·ADF)에 보고된 거래만 포함하며 거래소에서 체결된 거래는 빠져 있어 &lsquo;전체 거래 중 공매도 비중&rsquo;이 아닙니다. 시장조성자가 매수 주문을 받아 주기 위해 하는 공매도가 많이 섞여 있어, 비중이 높다고 하락에 거는 투자자가 많다는 뜻은 아닙니다. · 수집 {formatEt(data.shortVolume!.info.fetchedAt)}
            </SourceLine>
          </div>
        ) : (
          <Empty>일일 공매도 거래량 자료가 아직 없습니다.</Empty>
        )}
      </Section>

      {/* ── 옵션 ── */}
      <Section title="옵션 풋/콜 비율 (이 종목 옵션)" description="거래량 기준과 미결제약정 기준을 따로 계산">
        {pc?.latest ? (
          <div className="flex flex-col gap-3">
            <Stale date={pc.latest.date} max={STALE_DAYS.options} now={now} what="옵션 통계" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="풋/콜 (거래량)" value={pc.latest.volumeRatio?.toFixed(2) ?? "계산 안 함"} sub={`${pc.latest.date} 하루`} />
              <Stat label="풋/콜 (미결제약정)" value={pc.latest.oiRatio?.toFixed(2) ?? "계산 안 함"} sub="보통 전 거래일 말 기준" />
              <Stat label="콜 / 풋 거래량" value={`${fmtCompact(pc.latest.callVolume)} / ${fmtCompact(pc.latest.putVolume)}`} sub="계약" />
              <Stat label="콜 / 풋 미결제약정" value={`${fmtCompact(pc.latest.callOI)} / ${fmtCompact(pc.latest.putOI)}`} sub="계약" />
              <Stat label="거래량 비율 20일 평균" value={pc.volumeAvg20?.toFixed(2) ?? "자료 부족"} />
              <Stat label="모은 기록 중 위치" value={pc.volumePercentile !== null ? `하위 ${pc.volumePercentile.toFixed(0)}%` : "자료 부족"} sub="20일 이상 쌓이면 계산" />
            </div>
            <LineSvg
              dates={pc.history.map((p) => p.date)}
              series={[
                { key: "v", label: "거래량 기준", color: "var(--s1)", values: pc.history.map((p) => p.volumeRatio) },
                { key: "o", label: "미결제약정 기준", color: "var(--s2)", values: pc.history.map((p) => p.oiRatio), dashed: true },
              ]}
              fmt="ratio"
              refLines={[{ value: 1, label: "1.0 (풋 = 콜)" }]}
              ariaLabel={`${data.symbol} 풋/콜 비율 추이`}
            />
            <SourceLine>
              출처: {data.options!.info.source} — 이 종목에 상장된 모든 만기·행사가의 콜·풋 합계. 장 마감 후 그날 기준일(&lsquo;as of&rsquo; {data.options!.lastAsOf ?? "-"})이 맞는 값만 저장 · 수집 {formatEt(data.options!.info.fetchedAt)}.
              풋옵션은 보유 주식의 하락 대비(헤지)로, 콜옵션은 커버드콜 매도로도 많이 쓰이고 스프레드처럼 두 방향을 함께 거래하기도 해서, 풋/콜 비율만으로 투자자가 순매수·순매도 중인지 알 수 없습니다. 시장 전체 비율이 아닙니다.
            </SourceLine>
          </div>
        ) : (
          <Empty>이 종목의 옵션 통계가 없습니다 (상장 옵션이 없거나 아직 수집 전). 시장 전체 비율을 이 종목 값으로 대신 쓰지 않습니다.</Empty>
        )}
      </Section>

      {/* ── 기관 13F ── */}
      <Section title="기관 투자자 공시 보유 (SEC 13F)" description="분기 말 시점의 공개 보유 — 지금 보유량이 아닙니다 (최근 보고 기간 먼저, 같은 기간은 보고 가치 순)">
        {!data.institutions ? (
          <Empty>기관 13F 자료가 아직 수집되지 않았습니다.</Empty>
        ) : !data.institutions.cusip ? (
          <Empty>이 종목의 13F 식별 번호(CUSIP)를 실제 공시 가격으로 확인하지 못해 표시하지 않습니다.</Empty>
        ) : !data.institutions.holdings.length ? (
          <Empty>이 사이트가 추적하는 기관 {data.institutions.trackedCount}곳의 최근 공시에 이 종목 보유 보고가 없습니다.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>기관 (SEC 등록 이름)</th>
                    <th>보고 기간 말</th>
                    <th>제출일</th>
                    <th className="r">보고 주식 수</th>
                    <th className="r">보고 가치</th>
                    <th className="r">직전 공시 대비</th>
                    <th>상태</th>
                    <th>옵션 보고 (풋/콜)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.institutions.holdings.map((h) => {
                    const ch = holdingChange(h.shares, h.prevShares, h.prevKnown);
                    return (
                      <tr key={h.cik}>
                        <td>
                          <span className="font-semibold">{h.filer}</span>
                          <span className="block text-[11px] text-muted">{h.group}</span>
                        </td>
                        <td>
                          <span className="whitespace-nowrap">{h.period}</span>
                          {isStale(h.period, now, STALE_DAYS.thirteenF) && <span className="block text-[11px] text-warn">오래된 공시 (최근 분기 미제출)</span>}
                        </td>
                        <td className="whitespace-nowrap">{h.filed}</td>
                        <td className="r num">{h.shares !== null ? fmtInt(h.shares) : "-"}</td>
                        <td className="r num">{h.value !== null ? fmtUsdCompact(h.value) : "-"}</td>
                        <td className="r num">
                          {ch.change !== null ? `${signedInt(ch.change)}주` : "-"}
                          {ch.changePct !== null && <span className="block text-[11px] text-muted">{signedPct(ch.changePct)}</span>}
                          {h.prevPeriod && <span className="block text-[11px] text-muted">vs {h.prevPeriod}</span>}
                        </td>
                        <td className="text-xs">
                          {HOLDING_STATUS_KO[ch.status]}
                          {h.priceCheck.ok === false && <span className="block text-warn">가격 대조 불일치 (신고 {h.priceCheck.implied?.toFixed(2)} vs 종가 {h.priceCheck.close?.toFixed(2)})</span>}
                          {h.amendments.length > 0 && <span className="block text-[11px] text-muted">{h.amendments.join(" · ")}</span>}
                          {h.valueNote && <span className="block text-[11px] text-warn">{h.valueNote}</span>}
                        </td>
                        <td className="text-xs num">{h.putShares || h.callShares ? `${fmtCompact(h.putShares ?? 0)} / ${fmtCompact(h.callShares ?? 0)}` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SourceLine>
              출처: SEC EDGAR 13F (CUSIP {data.institutions.cusip}) · 이 사이트가 추적하는 기관 {data.institutions.trackedCount}곳만 표시 (미국 기관 전체가 아님) · 수집 {formatEt(data.institutions.info.fetchedAt)}.
              13F 는 운용자산 1억 달러 이상 기관이 분기 말 기준 롱 보유를 45일 안에 보고하는 공시로, 공매도(숏)·분기 중 매매·비공개 승인 보유는 나오지 않습니다. 지금도 같은 수량을 보유한다는 뜻이 아니며 &lsquo;목록에서 빠짐&rsquo;은 전량 매도 외에 보고 기준 변경일 수도 있습니다.
              옵션 보고는 기초자산 수량 기준이라 매수·매도 방향을 알 수 없습니다. 신고 가치 ÷ 주식 수가 그날 종가와 10% 넘게 다르면 &lsquo;가격 대조 불일치&rsquo;로 표시합니다.
            </SourceLine>
          </div>
        )}
      </Section>

      {/* ── 시장 전체 (참고) ── */}
      <Section
        title="시장 전체 투자심리 (참고 — 이 종목 값 아님)"
        description="설문·거래 통계·CNN 지수 — 실제 포지션이 아닙니다"
        right={
          <Link href="/sentiment" className="text-xs link">
            시장 심리 전체 보기
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="AAII 강세 / 약세" value={sent?.latest ? `${sent.latest.bullish.toFixed(1)}% / ${sent.latest.bearish.toFixed(1)}%` : "자료 없음"} sub={sent?.latest ? `설문 마감 ${sent.latest.week} · 개인 투자자 6개월 전망` : undefined} />
          <Stat label="강세 − 약세" value={sent?.latest ? `${sent.latest.spread > 0 ? "+" : sent.latest.spread < 0 ? "−" : ""}${Math.abs(sent.latest.spread).toFixed(1)}%p` : "-"} />
          <Stat
            label="주식 옵션 풋/콜 (Cboe)"
            value={eqLast ? (ratio(eqLast.putVolume, eqLast.callVolume)?.toFixed(2) ?? "-") : "자료 없음"}
            sub={eqLast ? `${eqLast.date} · Cboe 거래소 주식 옵션 전체${publishedRatioConsistent(ratio(eqLast.putVolume, eqLast.callVolume), eqLast.published) === false ? " · 공표값과 다름" : ""}` : undefined}
          />
          <Stat
            label="CNN 공포·탐욕 (0~100)"
            value={market.fearGreed ? `${market.fearGreed.now.score.toFixed(0)} · ${fgLabel(market.fearGreed.now.score, market.fearGreed.now.rating)}` : "자료 없음"}
            sub={market.fearGreed ? `CNN ${formatEt(market.fearGreed.now.at)} · 시장 전체` : undefined}
          />
        </div>
      </Section>
    </div>
  );
}
