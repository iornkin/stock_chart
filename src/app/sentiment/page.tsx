import Link from "next/link";
import { STALE_DAYS } from "@/config/positioning";
import { readMarketSentiment } from "@/lib/data/positioning";
import { CBOE_PRODUCT_LABELS, type CboeProduct } from "@/lib/providers/cboe";
import { HOLDING_STATUS_KO, ageDays, holdingChange, isStale, publishedRatioConsistent, putCallSummary, sentimentSummary } from "@/lib/positioning";
import { fmtCompact, fmtInt, fmtUsdCompact } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { perRequest } from "@/lib/page-mode";
import { Empty, Fold, Notice, PageHeader, Section, SourceLine, Stat } from "@/components/ui";
import { LineSvg, StackedShareBars } from "@/components/positioning/Charts";

export const metadata = { title: "시장 심리·포지션" };

const pp = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p`);
const AAII_URL = "https://www.aaii.com/sentimentsurvey";

/** 실제 롱·숏 비율 자료 검토 결과 (조사일 2026-10-15) */
const LONG_SHORT_REVIEW: { name: string; what: string; perStock: string; actual: string; sample: string; access: string; verdict: string }[] = [
  { name: "FINRA 공매도 잔고", what: "증권사가 보고한 결제일 기준 숏 포지션 수량", perStock: "예 (상장 주식·ETF)", actual: "실제 숏 포지션 (롱은 없음)", sample: "FINRA 회원 증권사 보고분", access: "무료 공개 API, 월 2회, 약 8영업일 지연", verdict: "사용 — 숏 쪽만 있어 롱·숏 비율은 만들 수 없음" },
  { name: "AAII 투자심리 설문", what: "6개월 뒤 시장 방향 전망 (강세·중립·약세)", perStock: "아니오 (시장 전체)", actual: "설문 (포지션 아님)", sample: "AAII 회원 개인 투자자", access: "공개 페이지 주 1회", verdict: "사용 — 전망으로만 표시" },
  { name: "NAAIM Exposure Index", what: "회원 운용역이 보고한 미국 주식 노출 평균", perStock: "아니오", actual: "운용역 자기 보고", sample: "NAAIM 회원 운용사", access: "2026-08-01부터 구독제 (비회원 유료)", verdict: "사용 안 함 — 유료" },
  { name: "IG Client Sentiment", what: "IG 고객 중 롱·숏 포지션 보유 비율", perStock: "일부 시장 (주로 지수·외환 CFD)", actual: "실제 포지션", sample: "IG 플랫폼 리테일 고객 한정", access: "공개 API 문서를 확인하지 못함", verdict: "사용 안 함 — 특정 플랫폼 고객이라 미국 투자자 전체로 볼 수 없음" },
  { name: "eToro 투자자 심리", what: "eToro 사용자 매수·매도 비중", perStock: "일부 종목", actual: "플랫폼 사용자 포지션", sample: "eToro 사용자 한정", access: "공개 API 는 선택된 사용자에게만 제공, 해당 항목 확인 못 함", verdict: "사용 안 함 — 플랫폼 한정·접근 불가" },
  { name: "Nasdaq Retail Trading Activity Tracker", what: "개인 투자자 매수·매도 거래 비율", perStock: "예", actual: "거래 흐름 (보유 포지션 아님)", sample: "공개 체결 자료에서 추정한 개인 거래", access: "무료판은 상위 10종목만, 전체는 Nasdaq Data Link 유료", verdict: "사용 안 함 — 유료·포지션 아님" },
  { name: "Schwab Trading Activity Index", what: "슈왑 고객 거래·보유 기반 행동 지수 (월간)", perStock: "아니오", actual: "지수 (비율 아님)", sample: "슈왑 고객 계좌 표본", access: "월 1회 발표 자료", verdict: "사용 안 함 — 플랫폼 한정·비율 아님" },
  { name: "Ortex 등 공매도 추정 서비스", what: "공매도 잔고 실시간 추정", perStock: "예", actual: "추정치", sample: "대차 시장 자료 기반 자체 추정", access: "유료 (API 월 수십~수백 달러로 알려짐)", verdict: "사용 안 함 — 유료·추정치" },
];

export default async function SentimentPage() {
  await perRequest();
  const now = Date.now();
  const d = readMarketSentiment();
  const s = d.sentiment ? sentimentSummary(d.sentiment.rows, d.sentiment.averages) : null;
  const products: CboeProduct[] = ["total", "equity", "index", "etp"];
  const mo = d.marketOptions;
  const pcs = Object.fromEntries(
    products.map((p) => [p, putCallSummary((mo?.rows ?? []).filter((r) => r.product === p).map((r) => ({ date: r.date, callVolume: r.callVolume, putVolume: r.putVolume, callOI: r.callOI, putOI: r.putOI })))]),
  ) as Record<CboeProduct, ReturnType<typeof putCallSummary>>;
  const published = (p: CboeProduct, date: string | undefined) => mo?.rows.find((r) => r.product === p && r.date === date)?.published ?? null;
  const recent26 = s ? s.valid.slice(-26) : [];
  const cboeDates = pcs.total.history.slice(-260).map((h) => h.date);
  const byDate = (p: CboeProduct) => new Map(pcs[p].history.map((h) => [h.date, h.volumeRatio]));

  return (
    <div className="flex flex-col">
      <PageHeader title="시장 심리·포지션" description="투자심리 설문, 시장 전체 옵션 통계, 기관 13F 공시를 따로 보여 줍니다. 서로 다른 자료를 합쳐 하나의 점수나 롱·숏 비율로 만들지 않습니다." />
      <div className="flex flex-col gap-5">
        {/* ── AAII ── */}
        <Section title="개인 투자자 투자심리 설문 (AAII)" description="실제 매수·매도 포지션이 아니라 '앞으로 6개월 시장 방향' 전망 설문입니다">
          {s?.latest ? (
            <div className="flex flex-col gap-3">
              {isStale(s.latest.week, now, STALE_DAYS.sentiment) && <Notice tone="warn">최근 설문 결과가 {s.latest.week} 기준으로 {ageDays(s.latest.week, now)}일 지났습니다. 출처 갱신이 늦거나 수집에 실패했을 수 있습니다.</Notice>}
              {s.invalid.length > 0 && <Notice tone="warn">세 비율 합계가 100% 가 아니거나 범위를 벗어난 {s.invalid.length}주는 계산에서 뺐습니다: {s.invalid.slice(0, 3).map((x) => `${x.week} (${x.reason})`).join(", ")}</Notice>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="강세 (Bullish)" value={`${s.latest.bullish.toFixed(1)}%`} sub={d.sentiment!.averages ? `장기 평균 ${d.sentiment!.averages.bullish.toFixed(1)}% 대비 ${pp(s.vsAverage?.bullish)}` : "장기 평균 자료 없음"} />
                <Stat label="중립 (Neutral)" value={`${s.latest.neutral.toFixed(1)}%`} sub={d.sentiment!.averages ? `장기 평균 ${d.sentiment!.averages.neutral.toFixed(1)}% 대비 ${pp(s.vsAverage?.neutral)}` : undefined} />
                <Stat label="약세 (Bearish)" value={`${s.latest.bearish.toFixed(1)}%`} sub={d.sentiment!.averages ? `장기 평균 ${d.sentiment!.averages.bearish.toFixed(1)}% 대비 ${pp(s.vsAverage?.bearish)}` : undefined} />
                <Stat label="강세 − 약세 (Bull-Bear Spread)" value={pp(s.latest.spread)} sub={`지난주 ${pp(s.previous?.spread)} · 8주 평균 ${pp(s.spreadAvg8)}`} />
              </div>
              <p className="text-xs text-ink-2">
                설문 마감 {s.latest.week} (수요일, 결과는 목요일 공표).
                {s.range52 && ` 이 사이트가 모은 최근 ${s.range52.weeks}주 중 강세 최고 ${s.range52.bullHigh.value.toFixed(1)}% (${s.range52.bullHigh.week}), 약세 최고 ${s.range52.bearHigh.value.toFixed(1)}% (${s.range52.bearHigh.week}).`}
              </p>
              <StackedShareBars
                rows={recent26.map((r) => ({ label: r.week, values: [r.bullish, r.neutral, r.bearish] }))}
                keys={[
                  { label: "강세", color: "var(--s1)" },
                  { label: "중립", color: "var(--muted)" },
                  { label: "약세", color: "var(--s2)" },
                ]}
                ariaLabel="AAII 주간 강세·중립·약세 비율"
              />
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-2">강세 − 약세 추이</p>
                <LineSvg
                  dates={s.valid.map((r) => r.week)}
                  series={[{ key: "sp", label: "강세 − 약세", color: "var(--s1)", values: s.valid.map((r) => r.spread) }]}
                  fmt="pp"
                  refLines={[{ value: 0, label: "0" }, ...(d.sentiment!.averages ? [{ value: d.sentiment!.averages.bullish - d.sentiment!.averages.bearish, label: `장기 평균 ${pp(d.sentiment!.averages.bullish - d.sentiment!.averages.bearish)}` }] : [])]}
                  ariaLabel="AAII 강세−약세 추이"
                />
              </div>
              <Fold summary="주별 표">
                <div className="overflow-x-auto">
                  <table className="table-basic">
                    <thead>
                      <tr>
                        <th>설문 마감</th>
                        <th className="r">강세</th>
                        <th className="r">중립</th>
                        <th className="r">약세</th>
                        <th className="r">강세 − 약세</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...s.valid].reverse().map((r) => (
                        <tr key={r.week}>
                          <td>{r.week}</td>
                          <td className="r num">{r.bullish.toFixed(1)}%</td>
                          <td className="r num">{r.neutral.toFixed(1)}%</td>
                          <td className="r num">{r.bearish.toFixed(1)}%</td>
                          <td className="r num">{pp(r.spread)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>
              <SourceLine>
                출처:{" "}
                <a href={AAII_URL} target="_blank" rel="noopener noreferrer" className="link">
                  AAII Investor Sentiment Survey
                </a>{" "}
                · 모집단: AAII 회원 개인 투자자 (미국 투자자 전체가 아님) · 질문: 앞으로 6개월 주식시장 방향 · 갱신: 매주 (목~수 투표, 목요일 공표) · 장기 평균은 AAII 공표값 · 이 사이트는 공개 페이지의 최근 결과를 매주 모으며 전체 과거 자료는 재배포하지 않습니다 · 수집 {formatEt(d.sentiment!.info.fetchedAt)}.
                설문은 전망일 뿐이며 응답자의 실제 계좌 포지션이나 매매와 다를 수 있습니다.
              </SourceLine>
            </div>
          ) : (
            <Empty>투자심리 설문 자료가 아직 수집되지 않았습니다.</Empty>
          )}
        </Section>

        {/* ── Cboe ── */}
        <Section title="시장 전체 옵션 풋/콜 비율 (Cboe)" description="Cboe 거래소의 상품군 합계 — 개별 종목 값이 아닙니다">
          {mo && pcs.total.latest ? (
            <div className="flex flex-col gap-3">
              {isStale(pcs.total.latest.date, now, STALE_DAYS.marketOptions) && <Notice tone="warn">최근 옵션 통계가 {pcs.total.latest.date} 기준입니다.</Notice>}
              <div className="overflow-x-auto">
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>상품군</th>
                      <th className="r">풋/콜 (거래량)</th>
                      <th className="r">Cboe 공표값</th>
                      <th className="r">풋/콜 (미결제약정)</th>
                      <th className="r">거래량 기준 20일 평균</th>
                      <th className="r">모은 기록 중 위치</th>
                      <th className="r">콜 / 풋 거래량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const l = pcs[p].latest;
                      const pub = published(p, l?.date);
                      const same = publishedRatioConsistent(l?.volumeRatio ?? null, pub);
                      return (
                        <tr key={p}>
                          <td>{CBOE_PRODUCT_LABELS[p]}</td>
                          <td className="r num">{l?.volumeRatio?.toFixed(2) ?? "-"}</td>
                          <td className="r num">
                            {pub?.toFixed(2) ?? "-"}
                            {same === false && <span className="block text-[11px] text-warn">직접 계산값과 다름</span>}
                          </td>
                          <td className="r num">{l?.oiRatio?.toFixed(2) ?? "-"}</td>
                          <td className="r num">{pcs[p].volumeAvg20?.toFixed(2) ?? "-"}</td>
                          <td className="r num">{pcs[p].volumePercentile !== null ? `하위 ${pcs[p].volumePercentile!.toFixed(0)}%` : "-"}</td>
                          <td className="r num">{l ? `${fmtCompact(l.callVolume)} / ${fmtCompact(l.putVolume)}` : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <LineSvg
                dates={cboeDates}
                series={[
                  { key: "t", label: "전체", color: "var(--s1)", values: cboeDates.map((x) => byDate("total").get(x) ?? null) },
                  { key: "e", label: "주식 옵션", color: "var(--s2)", values: cboeDates.map((x) => byDate("equity").get(x) ?? null) },
                ]}
                fmt="ratio"
                refLines={[{ value: 1, label: "1.0" }]}
                ariaLabel="Cboe 풋/콜 비율 (거래량 기준) 추이"
              />
              <SourceLine>
                출처: {mo.info.source} · 기준일 {pcs.total.latest.date} · 수집 {formatEt(mo.info.fetchedAt)}. 미국 옵션 시장 전체(OCC 집계)가 아니라 Cboe 가 운영하는 거래소의 합계입니다. Cboe 공표 비율은 거래량 기준이며, 미결제약정 기준 비율과 평균·위치는 이 사이트가 계산했습니다(모은 기록이 20일 미만이면 위치는 계산하지 않음).
                지수 옵션에는 기관의 하락 대비(헤지) 거래가 많아 풋 비중이 원래 높게 나오는 경향이 있고, 풋/콜 비율만으로 시장 참여자의 순 포지션 방향을 알 수 없습니다.
              </SourceLine>
            </div>
          ) : (
            <Empty>시장 전체 옵션 통계가 아직 수집되지 않았습니다.</Empty>
          )}
        </Section>

        {/* ── 기관 13F ── */}
        <Section title="기관 투자자 공시 보유 (SEC 13F)" description="이 사이트가 추적하는 기관의 가장 최근 분기 말 보유 — 지금 보유량이 아닙니다 (최근 보고 기간 먼저, 같은 기간은 신고 총액 순)">
          {d.institutions.length ? (
            <div className="flex flex-col gap-2">
              {d.institutions.map((it) => (
                <Fold
                  key={it.cik}
                  summary={
                    <span>
                      <span className="font-semibold">{it.filer}</span> <span className="text-xs text-muted">· {it.group} · {it.period} 기준 · 제출 {it.filed} · 신고 총액 {fmtUsdCompact(it.totalValue)}{it.entries ? ` · ${fmtInt(it.entries)}행` : ""}{isStale(it.period, now, STALE_DAYS.thirteenF) ? " · 오래된 공시" : ""}</span>
                    </span>
                  }
                >
                  {it.top.length ? (
                    <div className="overflow-x-auto">
                      <table className="table-basic">
                        <thead>
                          <tr>
                            <th className="r">순위</th>
                            <th>종목 (공시 이름)</th>
                            <th className="r">보고 주식 수</th>
                            <th className="r">보고 가치</th>
                            <th className="r">직전 공시 대비</th>
                            <th>상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {it.top.map((h) => {
                            const ch = holdingChange(h.shares, h.prevShares, h.prevKnown);
                            return (
                              <tr key={h.cusip}>
                                <td className="r num">{h.rank}</td>
                                <td>
                                  {h.symbol ? (
                                    <Link href={`/stock/${h.symbol}?tab=positioning`} className="link font-semibold">
                                      {h.symbol}
                                    </Link>
                                  ) : null}{" "}
                                  {h.issuer} <span className="text-[11px] text-muted">{h.title} · {h.cusip}</span>
                                </td>
                                <td className="r num">{fmtInt(h.shares)}</td>
                                <td className="r num">{fmtUsdCompact(h.value)}</td>
                                <td className="r num">{ch.changePct !== null ? `${ch.changePct > 0 ? "+" : ch.changePct < 0 ? "−" : ""}${Math.abs(ch.changePct).toFixed(1)}%` : "-"}</td>
                                <td className="text-xs">{h.prevKnown ? HOLDING_STATUS_KO[ch.status] : "직전 공시에서 확인 안 됨"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[11px] text-muted">
                        주식 보유 가치 상위 10개 (옵션 보고 행 제외){it.prevPeriod ? ` · 직전 공시 ${it.prevPeriod}` : " · 직전 공시 자료 없음"}{it.amendmentNotes.length ? ` · ${it.amendmentNotes.join(" · ")}` : ""}
                      </p>
                      {it.valueNote && <p className="text-[11px] text-warn">{it.valueNote}</p>}
                    </div>
                  ) : (
                    <Empty>상위 보유 자료가 없습니다.</Empty>
                  )}
                </Fold>
              ))}
              <SourceLine>
                출처: SEC EDGAR 13F · 수집 {formatEt(d.institutionsInfo.fetchedAt)}. 운용자산 1억 달러 이상 기관이 분기 말 기준 미국 상장 주식 등 롱 보유를 분기 종료 후 45일 안에 보고합니다. 공매도(숏)·분기 중 매매·비공개 승인 보유는 나오지 않고, 기관이 지금도 같은 수량을 보유한다는 뜻이 아닙니다. 이름은 SEC 에 등록된 그대로이며 &lsquo;그룹&rsquo;은 이 사이트의 분류입니다.
                종목별 보유는 각 종목 상세의 &lsquo;포지션·심리&rsquo; 탭에서 볼 수 있습니다.
              </SourceLine>
            </div>
          ) : (
            <Empty>기관 13F 자료가 아직 수집되지 않았습니다.</Empty>
          )}
        </Section>

        {/* ── 롱·숏 비율 ── */}
        <Section id="long-short" title="실제 롱·숏 비율은 왜 없나요?" description="'지금 투자자 중 롱과 숏이 몇 %인가'를 제공하는 자료를 조사한 결과 (2026-10-15)">
          <Notice title="미지원 — 신뢰할 수 있는 공개 자료가 없음">
            미국 주식 종목별로 &lsquo;전체 투자자의 실제 롱·숏 포지션 비율&rsquo;을 공개하는 출처는 확인하지 못했습니다. 실제 포지션 비율은 특정 증권사·플랫폼 고객 자료뿐이라 미국 투자자 전체로 볼 수 없고, 나머지는 설문·추정·거래 흐름이거나 유료입니다. 그래서 이 사이트는 롱·숏 비율을 계산하거나 다른 지표를 합쳐 만들지 않고, 위의 실제 지표(공매도 잔고, 옵션 통계, 13F, 설문)를 각각 따로 보여 줍니다.
          </Notice>
          <div className="mt-3 overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>자료</th>
                  <th>무엇을 재나</th>
                  <th>종목별</th>
                  <th>실제 포지션인가</th>
                  <th>표본</th>
                  <th>이용 조건</th>
                  <th>판단</th>
                </tr>
              </thead>
              <tbody>
                {LONG_SHORT_REVIEW.map((r) => (
                  <tr key={r.name}>
                    <td className="font-semibold">{r.name}</td>
                    <td className="text-xs">{r.what}</td>
                    <td className="text-xs">{r.perStock}</td>
                    <td className="text-xs">{r.actual}</td>
                    <td className="text-xs">{r.sample}</td>
                    <td className="text-xs">{r.access}</td>
                    <td className="text-xs">{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceLine>조사 시점의 공개 정보 기준이며 제공처의 조건은 바뀔 수 있습니다. 종합 심리 점수도 만들지 않았습니다 — 서로 다른 자료를 임의 가중치로 합친 점수는 검증할 방법이 없어 사실처럼 보일 위험이 큽니다.</SourceLine>
        </Section>
      </div>
    </div>
  );
}
