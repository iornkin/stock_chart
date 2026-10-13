import Link from "next/link";
import { MARKET_SYMBOLS } from "@/config/instruments";
import { allSymbols, coreSymbols, getInstrument } from "@/lib/instruments";
import { getQuotes, type QuoteView } from "@/lib/data/quotes";
import { readNews, MARKET_SCOPE } from "@/lib/data/news";
import { readEvents } from "@/lib/data/events";
import { readAllDividends } from "@/lib/data/dividends";
import { latestBriefing, latestBriefingList } from "@/lib/briefing/store";
import type { MarketBriefing } from "@/lib/briefing/types";
import { marketStatus } from "@/lib/market-calendar";
import { addDays, formatEt } from "@/lib/time";
import { fmtCompact, fmtDividend, fmtPrice } from "@/lib/format";
import { dataHealth, sparkCloses } from "@/lib/views";
import QuoteCard from "@/components/QuoteCard";
import { Change, Empty, Notice, PctBadge, Section } from "@/components/ui";
import WatchlistPanel from "@/components/WatchlistPanel";
import AutoRefresh from "@/components/AutoRefresh";
import NewsList from "@/components/NewsList";
import RelTime from "@/components/RelTime";
import MarketPhaseText from "@/components/MarketPhaseText";
import { perRequest } from "@/lib/page-mode";

function MarketIndexCard({ symbol, name, q, note }: { symbol: string; name: string; q?: QuoteView; note?: string }) {
  if (!q || q.price === null) return null;
  return (
    <div className="card p-3.5" title={note}>
      <div className="text-xs text-muted">{name}</div>
      <div className="num mt-1 text-xl font-semibold">{fmtPrice(q.price)}{symbol === "^TNX" || symbol === "^IRX" ? "%" : ""}</div>
      <Change value={q.change} pct={q.changePct} className="text-sm" />
      <div className="mt-1 text-[10px] text-muted">{q.source} · {formatEt(q.marketTime ?? q.fetchedAt)}</div>
    </div>
  );
}

export default async function Dashboard() {
  await perRequest();
  const renderedAt = Date.now();
  const st = marketStatus(renderedAt);
  const universe = allSymbols();
  const marketSyms = MARKET_SYMBOLS.map((m) => m.symbol);
  const quotes = await getQuotes([...universe, ...marketSyms], "list");
  const health = dataHealth();
  const core = coreSymbols();
  const today = st.etDate;

  const ranked = universe
    .map((s) => quotes.get(s))
    .filter((q): q is QuoteView => Boolean(q && q.changePct !== null));
  const gainers = [...ranked].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 6);
  const losers = [...ranked].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 6);
  const volumeMovers = ranked
    .filter((q) => q.volume && q.avgVolume3m)
    .map((q) => ({ q, ratio: (q.volume as number) / (q.avgVolume3m as number) }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 6);

  const market = latestBriefing<MarketBriefing>("MARKET");
  const briefList = latestBriefingList().filter((b) => b.scope !== "MARKET");
  const briefMap = new Map(briefList.map((b) => [b.scope, b]));
  const news = readNews(MARKET_SCOPE, Date.now() - 36 * 3600_000, Date.now(), 8);
  const earnings = readEvents(addDays(today, -1), addDays(today, 7), { kinds: ["earnings"] }).filter((e) => e.symbol && (getInstrument(e.symbol) || ((e.data?.relatedEtfs as string[] | undefined) ?? []).length));
  const econ = readEvents(today, addDays(today, 7), { kinds: ["economic"] });
  const divs = readAllDividends(today, addDays(today, 21)).filter((d) => getInstrument(d.symbol));
  const lastQuote = Math.max(0, ...[...quotes.values()].map((q) => q.fetchedAt));

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">오늘의 미국 시장</h1>
          <p className="text-sm text-muted">
            <MarketPhaseText at={renderedAt} variant="line" /> · 시세 최종 갱신{" "}
            {lastQuote ? (
              <>
                {formatEt(lastQuote)} <RelTime ms={lastQuote} paren />
              </>
            ) : (
              "없음"
            )}
          </p>
        </div>
        <Link href="/status" className="text-xs text-muted hover:text-accent">데이터 수집 상태 →</Link>
      </div>

      {quotes.size === 0 && (
        <Notice tone="critical" title="시세 데이터를 불러오지 못했습니다">
          데이터 제공처 응답이 없거나 아직 수집 작업이 실행되지 않았습니다. 과거 데이터를 현재 데이터처럼 표시하지 않습니다.{" "}
          <Link href="/status" className="link">데이터 상태</Link>에서 오류를 확인하세요.
        </Notice>
      )}
      {health.quotesFail && (
        <Notice tone="warn" title="최근 시세 갱신 작업이 실패했습니다">
          {health.quotesFail.message} · 마지막 정상 갱신: {health.quotesOk ? formatEt(health.quotesOk) : "기록 없음"}
        </Notice>
      )}

      <section aria-label="미국 시장 요약" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {MARKET_SYMBOLS.filter((m) => m.headline).map((m) => (
          <MarketIndexCard key={m.symbol} symbol={m.symbol} name={m.nameKo} q={quotes.get(m.symbol)} note={m.note} />
        ))}
      </section>
      <section aria-label="금리·달러·금·변동성" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {MARKET_SYMBOLS.filter((m) => !m.headline).map((m) => {
          const q = quotes.get(m.symbol);
          if (!q || q.price === null) return null;
          return (
            <div key={m.symbol} className="rounded-lg border border-line bg-surface px-3 py-2" title={m.note}>
              <div className="truncate text-[11px] text-muted">{m.nameKo}</div>
              <div className="num text-sm font-semibold">{fmtPrice(q.price, m.unit === "%" ? 3 : 2)}{m.unit === "%" ? "%" : ""}</div>
              <PctBadge pct={q.changePct} />
            </div>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="핵심 종목 현황" description="카드를 누르면 상세 분석 페이지로 이동합니다. 간단 차트는 최근 1개월 일봉 종가입니다.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {core.map((s) => (
              <QuoteCard key={s} symbol={s} nameKo={getInstrument(s)?.nameKo ?? s} quote={quotes.get(s)} spark={sparkCloses(s)} sparkLabel="최근 1개월 종가 추이" />
            ))}
          </div>
        </Section>
        <div className="flex flex-col gap-5">
          <Section title="오늘의 시장 브리핑" right={<Link href="/briefing" className="text-xs link">전체 보기</Link>}>
            {market ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-xs text-muted">{market.content.sessionLabel} · 생성 {formatEt(market.generatedAt)}</p>
                <p className="font-semibold">{market.content.headline}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  {market.content.sections.slice(0, 3).flatMap((s) => s.statements.slice(0, 1)).map((s, i) => (
                    <li key={i}>{s.text}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <Empty>아직 생성된 시장 브리핑이 없습니다. 스케줄러(worker)가 장 마감 후 자동으로 생성합니다.</Empty>
            )}
            {health.briefingFail && (
              <p className="mt-2 text-xs text-warn">최근 브리핑 생성 실패: {health.briefingFail.message} (마지막 정상 생성 {health.briefingOk ? formatEt(health.briefingOk) : "없음"})</p>
            )}
          </Section>
          <WatchlistPanel />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="상승률 상위" description="지원 종목 안에서만 계산">
          <MoverList items={gainers.map((q) => ({ q }))} />
        </Section>
        <Section title="하락률 상위" description="지원 종목 안에서만 계산">
          <MoverList items={losers.map((q) => ({ q }))} />
        </Section>
        <Section title="거래량 변화 상위" description="오늘 거래량 ÷ 3개월 평균 (장중에는 누적치)">
          <MoverList items={volumeMovers.map((v) => ({ q: v.q, extra: `${v.ratio.toFixed(2)}배 · ${fmtCompact(v.q.volume)}` }))} />
        </Section>
      </div>

      <Section
        title="오늘의 종목별 투자 브리핑"
        description="각 종목의 데이터와 특성에 맞춰 개별 생성된 브리핑입니다."
        right={<Link href="/briefing" className="text-xs link">브리핑 모아보기</Link>}
      >
        {briefList.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[...core, ...universe.filter((s) => !core.includes(s))]
              .filter((s) => briefMap.has(s))
              .slice(0, 18)
              .map((s) => {
                const b = briefMap.get(s)!;
                return (
                  <li key={s}>
                    <Link href={`/stock/${s}?tab=briefing`} className="block rounded-lg border border-line px-3 py-2 hover:border-accent">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getInstrument(s)?.nameKo ?? s} 오늘의 브리핑</span>
                        <span className="text-[10px] text-muted">{b.session === "close" ? "장 마감" : b.session === "intraday" ? "장중" : "휴장일"} · {b.tradeDate}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-2">{b.headline}</p>
                    </Link>
                  </li>
                );
              })}
          </ul>
        ) : (
          <Empty>생성된 종목별 브리핑이 없습니다. 워커를 실행하거나 <code>npm run job -- briefing_close --force</code> 로 생성할 수 있습니다.</Empty>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="오늘의 주요 시장 뉴스" description="최근 36시간 게시 기사 · 같은 내용은 하나로 묶어 표시">
          <NewsList items={news} empty="수집된 시장 뉴스가 없습니다." />
        </Section>
        <div className="flex flex-col gap-5">
          <Section title="실적 발표 일정" description="지원 종목 및 ETF 상위 편입 종목 (어제~7일 후)">
            {earnings.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {earnings.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <span className="num text-xs text-muted">{e.date}</span> <span className="font-semibold">{e.symbol}</span>{" "}
                      <span className="text-xs text-muted">{e.timeHint ?? ""}</span>
                    </span>
                    <span className="text-right text-xs text-ink-2">
                      {e.data?.epsActual != null ? `EPS ${e.data.epsActual} (예상 ${e.data.epsEstimate ?? "-"})` : ((e.data?.relatedEtfs as string[] | undefined) ?? []).slice(0, 2).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>확인된 실적 발표 일정이 없습니다 (Finnhub 키가 없으면 M7 일정만 Yahoo 에서 수집).</Empty>
            )}
            {econ.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 text-xs font-semibold text-ink-2">경제지표 발표 (FRED 일정)</p>
                <ul className="text-sm">
                  {econ.slice(0, 6).map((e) => (
                    <li key={e.id} className="flex justify-between py-0.5">
                      <span>{e.title}</span>
                      <span className="num text-xs text-muted">{e.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
          <Section title="다가오는 배당락·지급일" description="발표된 일정만 표시 (21일 이내)" right={<Link href="/calendar" className="text-xs link">캘린더</Link>}>
            {divs.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {divs.slice(0, 10).map((d) => (
                  <li key={`${d.symbol}${d.exDate}${d.kind}`} className="flex items-center justify-between py-1.5">
                    <Link href={`/stock/${d.symbol}?tab=dividends`} className="font-semibold hover:text-accent">{d.symbol}</Link>
                    <span className="num text-xs text-ink-2">
                      락 {d.exDate} · 지급 {d.payDate ?? "미제공"} · {fmtDividend(d.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>21일 이내에 발표된 배당락·지급 일정이 없습니다.</Empty>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function MoverList({ items }: { items: { q: QuoteView; extra?: string }[] }) {
  if (!items.length) return <Empty>데이터 없음</Empty>;
  return (
    <ol className="flex flex-col divide-y divide-line text-sm">
      {items.map(({ q, extra }) => (
        <li key={q.symbol} className="flex items-center justify-between gap-2 py-1.5">
          <Link href={`/stock/${q.symbol}`} className="min-w-0 hover:text-accent">
            <span className="font-semibold">{q.symbol}</span> <span className="truncate text-xs text-muted">{getInstrument(q.symbol)?.nameKo}</span>
          </Link>
          <span className="flex shrink-0 items-center gap-2">
            {extra && <span className="num text-xs text-ink-2">{extra}</span>}
            <span className="num text-xs">${fmtPrice(q.price)}</span>
            <PctBadge pct={q.changePct} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export const metadata = { title: "대시보드" };
