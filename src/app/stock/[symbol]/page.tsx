import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInstrument, normalizeSymbol, CATEGORY_LABELS } from "@/lib/instruments";
import { INSTRUMENTS } from "@/config/instruments";
import { getQuotes, delayLabel } from "@/lib/data/quotes";
import { readNews } from "@/lib/data/news";
import { latestBriefing, briefingHistory } from "@/lib/briefing/store";
import type { SymbolBriefing } from "@/lib/briefing/types";
import { marketStatus } from "@/lib/market-calendar";
import { formatEt } from "@/lib/time";
import { fmtCompact, fmtPct, fmtPrice, fmtUsd, fmtUsdCompact } from "@/lib/format";
import StockChart from "@/components/StockChart";
import Tabs from "@/components/Tabs";
import WatchButton from "@/components/WatchButton";
import BriefingView, { Statements, UpcomingTable } from "@/components/BriefingView";
import DividendsView from "@/components/DividendsView";
import FinancialsView from "@/components/FinancialsView";
import EtfView from "@/components/EtfView";
import NewsList from "@/components/NewsList";
import CompareClient from "@/components/CompareClient";
import AutoRefresh from "@/components/AutoRefresh";
import { Change, Empty, Notice, Section, Stat } from "@/components/ui";
import { readDividends } from "@/lib/data/dividends";
import { summarizeDividends } from "@/lib/dividend-analytics";
import { etfProfile, readFilings, stockFundamentals } from "@/lib/data/profile";
import KrwHint from "@/components/KrwHint";
import { lastFailure, lastSuccessAt } from "@/lib/jobs/runner";
import { perRequest, readSearchParams } from "@/lib/page-mode";
import { IS_STATIC } from "@/lib/static-mode";
import RelTime from "@/components/RelTime";
import MarketPhaseText from "@/components/MarketPhaseText";

/** 정적 사이트: 지원 종목(과 이전 티커) 페이지를 모두 미리 만든다. 서버 모드에서는 내보내지 않는다(요청마다 렌더링). */
export const generateStaticParams = IS_STATIC
  ? async () => INSTRUMENTS.flatMap((i) => [i.symbol, ...(i.formerSymbols ?? [])]).map((symbol) => ({ symbol }))
  : undefined;

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const inst = getInstrument(symbol);
  return { title: inst ? `${inst.symbol} ${inst.nameKo}` : "종목" };
}

export default async function StockPage({ params, searchParams }: Props) {
  await perRequest();
  const { symbol: raw } = await params;
  const { tab } = await readSearchParams(searchParams);
  const symbol = normalizeSymbol(raw);
  const inst = getInstrument(symbol);
  if (!inst) notFound();
  if (symbol !== decodeURIComponent(raw)) redirect(`/stock/${symbol}${tab ? `?tab=${tab}` : ""}`);

  const quotes = await getQuotes([symbol], "detail");
  const q = quotes.get(symbol);
  const renderedAt = Date.now();
  const st = marketStatus(renderedAt);
  const brief = latestBriefing<SymbolBriefing>(symbol);
  const history = briefingHistory(symbol, 15);
  const news = readNews(symbol, Date.now() - 14 * 86400_000, Date.now(), 40);
  const divSum = summarizeDividends(readDividends(symbol), st.etDate, q?.price ?? null);
  const isEtf = inst.kind === "etf";
  const etf = isEtf ? etfProfile(symbol) : null;
  const fund = !isEtf ? stockFundamentals(symbol, q?.price ?? null) : null;
  const delay = q ? delayLabel(q) : null;
  const word = isEtf ? "분배금" : "배당금";
  const quotesFail = lastFailure("refresh_quotes");
  const filings = !isEtf ? readFilings(symbol) : null;

  const tabs = [
    { key: "overview", label: "개요" },
    { key: "briefing", label: "일일 브리핑" },
    { key: "fundamentals", label: isEtf ? "ETF 정보" : "재무 정보" },
    { key: "dividends", label: `배당·분배금` },
    { key: "news", label: "뉴스·공시" },
    { key: "compare", label: "종목 비교" },
  ];

  const recentNews = news.filter((n) => n.publishedAt >= Date.now() - 36 * 3600_000);
  const olderNews = news.filter((n) => n.publishedAt < Date.now() - 36 * 3600_000);

  const overview = (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="시가" value={fmtPrice(q?.open)} />
        <Stat label="고가 / 저가" value={`${fmtPrice(q?.high)} / ${fmtPrice(q?.low)}`} />
        <Stat label="전일 종가" value={fmtPrice(q?.prevClose)} />
        <Stat label="거래량" value={`${fmtCompact(q?.volume)}주`} sub={`3개월 평균 ${fmtCompact(q?.avgVolume3m)}주`} />
        <Stat label="추정 거래대금" value={q?.price && q.volume ? fmtUsdCompact(q.price * q.volume) : "-"} sub="현재가 × 거래량 (추정)" />
        <Stat label="52주 범위" value={`${fmtPrice(q?.fiftyTwoLow)} ~ ${fmtPrice(q?.fiftyTwoHigh)}`} />
        {isEtf ? (
          <>
            <Stat label="운용자산" value={etf?.totalAssets.value != null ? fmtUsdCompact(etf.totalAssets.value) : "미제공"} sub={etf?.totalAssets.source ?? ""} />
            <Stat label="총보수" value={etf?.expenseRatio.value != null ? fmtPct(etf.expenseRatio.value, 2, false) : "미제공"} sub={etf?.expenseRatio.source ?? ""} />
            {inst.leverage && <Stat label="레버리지" value={`${inst.leverage}배 (일일)`} sub={inst.underlying} />}
          </>
        ) : (
          <>
            <Stat label="시가총액" value={fund?.marketCap.value != null ? fmtUsdCompact(fund.marketCap.value) : "미제공"} sub={fund?.marketCap.source ?? ""} />
            <Stat label="PER / 선행 PER" value={`${fund?.trailingPE.value?.toFixed(1) ?? "-"} / ${fund?.forwardPE.value?.toFixed(1) ?? "-"}`} sub={fund?.trailingPE.source ?? ""} />
          </>
        )}
        <Stat label={`TTM ${word} 수익률`} value={fmtPct(divSum.ttmYield, 2, false)} sub={divSum.latest ? `최근 ${word} $${divSum.latest.amount.toFixed(4)}` : `${word} 기록 없음`} />
        <Stat label="추종 지수·기초자산" value={<span className="text-xs font-normal">{inst.underlying ?? (isEtf ? "미제공" : "개별 기업")}</span>} />
      </div>
      <Section
        title="오늘의 투자 브리핑 요약"
        right={<Link href={`?tab=briefing`} className="text-xs link">전체 브리핑 보기</Link>}
        description={brief ? `${brief.content.sessionLabel} · 생성 ${formatEt(brief.generatedAt)}` : undefined}
      >
        {brief ? (
          <div className="flex flex-col gap-3">
            <Statements items={brief.content.summary} prefix={`b-${symbol}`} />
            {brief.content.technical.available && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-2">기술적 지표 요약</p>
                <Statements items={brief.content.technical.interpretations.slice(0, 4)} prefix={`b-${symbol}`} />
              </div>
            )}
          </div>
        ) : (
          <Empty>아직 생성된 브리핑이 없습니다. 스케줄러가 장 마감 후 자동 생성합니다.</Empty>
        )}
      </Section>
      {brief && brief.content.upcoming.items.length > 0 && (
        <Section title="앞으로 확인할 일정">
          <UpcomingTable items={brief.content.upcoming.items.slice(0, 8)} />
        </Section>
      )}
    </div>
  );

  const briefingPanel = brief ? (
    <div className="flex flex-col gap-4">
      <BriefingView b={brief.content} />
      {history.length > 1 && (
        <Section title="지난 브리핑">
          <ul className="flex flex-wrap gap-2 text-xs">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/briefing/${symbol}?date=${h.tradeDate}&session=${h.session}`} className="rounded-md border border-line px-2 py-1 hover:border-accent">
                  {h.tradeDate} {h.session === "close" ? "마감" : h.session === "intraday" ? "장중" : "휴장일"}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  ) : (
    <Empty>생성된 브리핑이 없습니다. 워커(npm run worker)가 실행 중이면 정해진 시각에 생성됩니다.</Empty>
  );

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh />
      <nav className="-mb-2 text-xs text-muted" aria-label="경로">
        <Link href="/stocks" className="hover:text-accent">전체 종목</Link> / {CATEGORY_LABELS[inst.category]} / {symbol}
      </nav>
      <header className="card flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{symbol}</h1>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{isEtf ? "ETF" : "주식"}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{CATEGORY_LABELS[inst.category]}</span>
              {inst.core && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">핵심 종목</span>}
            </div>
            <p className="text-sm text-ink-2">
              {q?.name ?? inst.name} · {inst.nameKo}
            </p>
            {inst.formerSymbols?.length ? <p className="text-xs text-muted">이전 티커: {inst.formerSymbols.join(", ")}</p> : null}
          </div>
          <WatchButton symbol={symbol} />
        </div>
        {q && q.price !== null ? (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <span className="num text-3xl font-bold">{fmtUsd(q.price)}</span>
              <Change value={q.change} pct={q.changePct} className="ml-2 text-lg" />
              <span className="ml-2 text-xs text-muted">USD</span>
              <KrwHint usd={q.price} />
            </div>
            {q.prePrice !== null && st.phase === "pre" && (
              <span className="text-sm text-ink-2">
                프리마켓 {fmtUsd(q.prePrice)} <span className="text-xs">({fmtPct(q.preChangePct)})</span>
              </span>
            )}
            {q.postPrice !== null && (st.phase === "post" || st.phase === "closed") && (
              <span className="text-sm text-ink-2">
                애프터마켓 {fmtUsd(q.postPrice)} <span className="text-xs">({fmtPct(q.postChangePct)})</span>
              </span>
            )}
          </div>
        ) : (
          <Notice tone="critical" title="현재 시세를 불러오지 못했습니다">
            {q?.refreshError ?? quotesFail?.message ?? "데이터 제공처 응답 없음"} · 마지막 정상 시세 갱신: {lastSuccessAt("refresh_quotes") ? formatEt(lastSuccessAt("refresh_quotes")) : "기록 없음"}
          </Notice>
        )}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{q?.exchange ?? inst.exchange ?? "거래소 미제공"}</span>
          <span aria-hidden>·</span>
          <MarketPhaseText at={renderedAt} />
          <span aria-hidden>·</span>
          <span className="num">마지막 거래 {formatEt(q?.marketTime)}</span>
          <span aria-hidden>·</span>
          <span className={delay?.realtime ? "text-good" : "text-warn"}>{delay?.text ?? "-"}</span>
          <span aria-hidden>·</span>
          <span className="num" title={q ? `데이터 갱신 ${formatEt(q.fetchedAt)}` : undefined}>
            {q ? <>갱신 <RelTime ms={q.fetchedAt} /></> : "갱신 기록 없음"}
          </span>
          <span aria-hidden>·</span>
          <span>출처 {q?.source ?? "-"}</span>
        </p>
        {q?.freshness === "stale" && (
          <Notice tone="warn">
            최신 시세 조회에 실패해 {formatEt(q.fetchedAt)}에 받은 데이터를 표시하고 있습니다. {q.refreshError ? `(${q.refreshError})` : ""}
          </Notice>
        )}
      </header>

      <Section title="차트" description="휠·핀치로 확대, 드래그로 이동 · 패널 경계를 끌어 높이 조절">
        <StockChart symbol={symbol} />
      </Section>

      <Tabs
        tabs={tabs}
        initial={tab}
        panels={{
          overview,
          briefing: briefingPanel,
          fundamentals: isEtf ? <EtfView inst={inst} quote={q} /> : <FinancialsView symbol={symbol} price={q?.price ?? null} />,
          dividends: <DividendsView inst={inst} price={q?.price ?? null} />,
          news: (
            <div className="flex flex-col gap-5">
              <Section title="최근 36시간 관련 뉴스" description="관련 이유: 제공처 분류, 제목 언급, 기초지수·기초자산 검색 결과로 구분">
                <NewsList items={recentNews} showReason empty="최근 36시간 내 수집된 관련 뉴스가 없습니다." />
              </Section>
              <Section title="이전 뉴스 (14일 이내)" description="게시 날짜를 확인하세요 — 오늘의 뉴스가 아닙니다">
                <NewsList items={olderNews} showReason empty="이전 뉴스가 없습니다." />
              </Section>
              {!isEtf ? (
                <Section title="관련 공시 (SEC EDGAR)" description={filings ? `연차·분기 보고서, 수시 공시(8-K), 주주총회 위임장 · 수집 ${formatEt(filings.fetchedAt)}` : undefined}>
                  {filings && filings.items.length ? (
                    <ul className="flex flex-col divide-y divide-line text-sm">
                      {filings.items.map((f) => (
                        <li key={f.url} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                          <span className="num w-24 shrink-0 text-xs text-muted">{f.filingDate}</span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold">{f.form}</span>
                          <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 link">
                            {f.description ?? f.form}
                            {f.reportDate ? ` (보고 기준일 ${f.reportDate})` : ""} ↗
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>아직 수집된 공시 목록이 없습니다. 참조 데이터 수집 작업이 하루 한 번 SEC EDGAR 에서 가져옵니다(SEC_USER_AGENT 설정 필요).</Empty>
                  )}
                </Section>
              ) : (
                <Section title="관련 공시">
                  <p className="text-sm text-ink-2">
                    ETF 의 보유 내역·분배금 구성(19a-1)·투자설명서는 운용사가 공시합니다.{" "}
                    {inst.officialUrl ? (
                      <a href={inst.officialUrl} target="_blank" rel="noopener noreferrer" className="link">
                        운용사 공식 페이지 ↗
                      </a>
                    ) : (
                      "운용사 공식 페이지를 확인하세요."
                    )}
                  </p>
                </Section>
              )}
            </div>
          ),
          compare: <CompareClient initial={[symbol, ...(inst.peers ?? []).slice(0, 2)]} showPresets={false} />,
        }}
      />
    </div>
  );
}
