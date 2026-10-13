import Link from "next/link";
import { MARKET_SYMBOLS } from "@/config/instruments";
import { allSymbols, coreSymbols, getInstrument } from "@/lib/instruments";
import { getQuotes, type QuoteView } from "@/lib/data/quotes";
import { readNews, MARKET_SCOPE } from "@/lib/data/news";
import { readEvents } from "@/lib/data/events";
import { readAllDividends } from "@/lib/data/dividends";
import { latestBriefing, latestBriefingRecords } from "@/lib/briefing/store";
import type { MarketBriefing, SymbolBriefing } from "@/lib/briefing/types";
import { digestOf, type BriefingDigest } from "@/lib/briefing/digest";
import { leverageRiskSnapshot } from "@/lib/leverage";
import ChangeChips from "@/components/ChangeChips";
import { marketStatus } from "@/lib/market-calendar";
import { addDays, formatEt } from "@/lib/time";
import { changeClass, fmtDividend, fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import { dataHealth, sparkCloses } from "@/lib/views";
import Sparkline from "@/components/Sparkline";
import PanelTabs from "@/components/PanelTabs";
import { Empty, Notice, PageHeader, PctBadge, Section } from "@/components/ui";
import MyDashboard from "@/components/MyDashboard";
import WatchlistPanel from "@/components/WatchlistPanel";
import AutoRefresh from "@/components/AutoRefresh";
import NewsList from "@/components/NewsList";
import RelTime from "@/components/RelTime";
import MarketPhaseText from "@/components/MarketPhaseText";
import { perRequest } from "@/lib/page-mode";

function IndexTile({ symbol, name, q, note }: { symbol: string; name: string; q?: QuoteView; note?: string }) {
  if (!q || q.price === null) return null;
  return (
    <div className="card min-w-0 px-3.5 py-3" title={`${note ? `${note} · ` : ""}${q.source} · ${formatEt(q.marketTime ?? q.fetchedAt)}`}>
      <div className="truncate text-xs text-muted">{name}</div>
      <div className="num mt-0.5 text-lg font-semibold leading-tight">{fmtPrice(q.price)}{symbol === "^TNX" || symbol === "^IRX" ? "%" : ""}</div>
      <span className={`num text-[13px] font-semibold ${changeClass(q.changePct)}`}>
        {fmtSigned(q.change)} · {fmtPct(q.changePct)}
      </span>
    </div>
  );
}

type CheckItem = { tag: string; text: React.ReactNode; href?: string; tone?: "warn" | "up" | "down" };

function Checklist({ items }: { items: CheckItem[] }) {
  if (!items.length) return <Empty>오늘 따로 확인할 새 항목이 없습니다.</Empty>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((it, i) => {
        const body = (
          <span className="flex items-start gap-3 py-2.5">
            <span className={`mt-0.5 w-16 shrink-0 truncate rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${it.tone === "warn" ? "bg-warn-soft text-warn" : it.tone === "up" ? "bg-up-soft text-up" : it.tone === "down" ? "bg-down-soft text-down" : "bg-surface-2 text-ink-2"}`}>{it.tag}</span>
            <span className="min-w-0 flex-1 text-[14px] leading-relaxed">{it.text}</span>
            {it.href && <span aria-hidden className="text-muted">›</span>}
          </span>
        );
        return <li key={i}>{it.href ? <Link href={it.href} className="block hover:text-accent">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

/** 한 줄 시세 (종목·작은 선 그래프·가격·등락률·판단) */
function QuoteRow({ symbol, q, spark, digest }: { symbol: string; q?: QuoteView; spark: number[]; digest?: BriefingDigest }) {
  return (
    <Link href={`/stock/${symbol}`} className="grid grid-cols-[minmax(0,1fr)_64px_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
      <span className="min-w-0">
        <span className="font-semibold">{symbol}</span>
        <span className="block truncate text-[11px] text-muted">
          {getInstrument(symbol)?.nameKo}
          {digest?.stanceLabel ? ` · ${digest.stanceLabel}` : ""}
        </span>
      </span>
      <Sparkline values={spark} width={64} height={24} direction={q?.changePct} label={`${symbol} 최근 1개월 종가`} />
      <span className="flex flex-col items-end">
        <span className="num text-sm">{q?.price != null ? `$${fmtPrice(q.price)}` : "-"}</span>
        <span className={`num text-xs font-semibold ${changeClass(q?.changePct)}`}>{fmtPct(q?.changePct ?? null)}</span>
      </span>
    </Link>
  );
}

function MoverList({ items }: { items: { q: QuoteView; extra?: string }[] }) {
  if (!items.length) return <Empty>데이터 없음</Empty>;
  return (
    <ol className="flex flex-col divide-y divide-line text-sm">
      {items.map(({ q, extra }) => (
        <li key={q.symbol}>
          <Link href={`/stock/${q.symbol}`} className="flex items-center justify-between gap-2 py-2 hover:text-accent">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{q.symbol}</span> <span className="text-xs text-muted">{getInstrument(q.symbol)?.nameKo}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {extra && <span className="num text-xs text-ink-2">{extra}</span>}
              <PctBadge pct={q.changePct} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
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

  const records = latestBriefingRecords();
  const market = latestBriefing<MarketBriefing>("MARKET");
  const digests = new Map(records.filter((r) => r.scope !== "MARKET").map((r) => [r.scope, digestOf(r.content as SymbolBriefing)]));
  const coreSet = new Set(core);
  const notable = [...digests.values()]
    .filter((d) => d.changes.some((c) => c.importance >= 2 && c.tag !== "news"))
    .sort((a, b) => b.maxImportance - a.maxImportance || Number(coreSet.has(b.scope)) - Number(coreSet.has(a.scope)) || Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 6);
  const news = readNews(MARKET_SCOPE, Date.now() - 36 * 3600_000, Date.now(), 6);
  const earnings = readEvents(addDays(today, -1), addDays(today, 7), { kinds: ["earnings"] }).filter((e) => e.symbol && (getInstrument(e.symbol) || ((e.data?.relatedEtfs as string[] | undefined) ?? []).length));
  const econ = readEvents(today, addDays(today, 7), { kinds: ["economic"] });
  const divs = readAllDividends(today, addDays(today, 21)).filter((d) => getInstrument(d.symbol));
  const lastQuote = Math.max(0, ...[...quotes.values()].map((q) => q.fetchedAt)) || null;
  const levRisk = leverageRiskSnapshot();

  // ── 오늘 확인할 것 ──
  const checklist: CheckItem[] = [];
  if (market) checklist.push({ tag: "시장", text: market.content.headline, href: "/briefing" });
  for (const d of notable.slice(0, 3)) {
    const c = d.changes[0];
    checklist.push({
      tag: d.scope,
      tone: c?.direction === "up" ? "up" : c?.direction === "down" ? "down" : undefined,
      text: (
        <>
          {d.changes.filter((x) => x.importance >= 2 && x.tag !== "news").slice(0, 2).map((x) => x.short).join(" · ")}
          {d.stanceLabel && <span className="ml-1.5 text-xs text-muted">판단: {d.stanceLabel}</span>}
        </>
      ),
      href: `/stock/${d.scope}?tab=briefing`,
    });
  }
  const exSoon = divs.filter((d) => d.exDate >= today && d.exDate <= addDays(today, 5)).sort((a, b) => Number(coreSet.has(b.symbol)) - Number(coreSet.has(a.symbol)) || a.exDate.localeCompare(b.exDate));
  if (exSoon.length) checklist.push({ tag: "배당", text: `배당락 임박: ${exSoon.slice(0, 4).map((d) => `${d.symbol} ${d.exDate.slice(5).replace("-", "/")} (${fmtDividend(d.amount)})`).join(", ")}${exSoon.length > 4 ? ` 외 ${exSoon.length - 4}건` : ""}`, href: "/calendar" });
  const earnSoon = earnings.filter((e) => e.date >= today && getInstrument(e.symbol as string));
  if (earnSoon.length) checklist.push({ tag: "실적", text: `이번 주 실적 발표: ${earnSoon.slice(0, 5).map((e) => `${e.symbol} ${e.date.slice(5).replace("-", "/")}`).join(", ")}` });
  const econSoon = econ.filter((e) => e.data?.importance === "high" && e.date <= addDays(today, 3));
  if (econSoon.length) checklist.push({ tag: "경제", text: `주요 경제지표: ${econSoon.slice(0, 3).map((e) => `${e.date.slice(5).replace("-", "/")} ${e.title}`).join(", ")}` });
  const worstLev = [...levRisk].sort((a, b) => a.fromAth - b.fromAth)[0];
  if (worstLev) {
    const vol = levRisk.find((r) => r.base === "QQQ")?.baseVol20 ?? worstLev.baseVol20;
    checklist.push({
      tag: "레버리지",
      tone: worstLev.fromAth <= -20 || (vol ?? 0) >= 25 ? "warn" : undefined,
      text: `${worstLev.symbol} 최고점 대비 ${fmtPct(worstLev.fromAth, 1)}${vol !== null && vol !== undefined ? ` · ${levRisk.find((r) => r.base === "QQQ") ? "QQQ" : worstLev.base} 20일 변동성 ${vol.toFixed(1)}%` : ""}`,
      href: "/leverage",
    });
  }
  if (health.quotesFail || health.briefingFail) checklist.push({ tag: "데이터", tone: "warn", text: `최근 수집 실패 기록이 있습니다 (${(health.quotesFail ?? health.briefingFail)?.message ?? ""})`, href: "/status" });

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh />
      <PageHeader
        title="오늘의 대시보드"
        description={<MarketPhaseText at={renderedAt} variant="line" />}
        right={
          <Link href="/status" className="text-xs text-muted hover:text-accent">
            시세 {lastQuote ? <RelTime ms={lastQuote} /> : "없음"} · 브리핑 {health.briefingOk ? <RelTime ms={health.briefingOk} /> : "없음"} 갱신 ›
          </Link>
        }
      />

      {quotes.size === 0 && (
        <Notice tone="critical" title="시세 데이터를 불러오지 못했습니다">
          데이터 제공처 응답이 없거나 아직 수집 작업이 실행되지 않았습니다. 과거 데이터를 현재 데이터처럼 표시하지 않습니다. <Link href="/status" className="link">데이터 상태</Link>
        </Notice>
      )}
      {health.quotesFail && (
        <Notice tone="warn" title="최근 시세 갱신 작업이 실패했습니다">
          {health.quotesFail.message} · 마지막 정상 갱신: {health.quotesOk ? formatEt(health.quotesOk) : "기록 없음"}
        </Notice>
      )}

      <section aria-label="미국 시장 요약" className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {MARKET_SYMBOLS.filter((m) => m.headline).map((m) => (
            <IndexTile key={m.symbol} symbol={m.symbol} name={m.nameKo} q={quotes.get(m.symbol)} note={m.note} />
          ))}
        </div>
        <ul aria-label="금리·환율·금·변동성" className="-mx-1 flex gap-x-4 gap-y-1 overflow-x-auto px-1 pb-1 text-xs sm:flex-wrap">
          {MARKET_SYMBOLS.filter((m) => !m.headline).map((m) => {
            const q = quotes.get(m.symbol);
            if (!q || q.price === null) return null;
            return (
              <li key={m.symbol} className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap" title={m.note}>
                <span className="text-muted">{m.nameKo}</span>
                <span className="num font-semibold">{fmtPrice(q.price, m.unit === "%" ? 3 : 2)}{m.unit === "%" ? "%" : m.unit === "krw" ? "원" : ""}</span>
                <span className={`num ${changeClass(q.changePct)}`}>{fmtPct(q.changePct)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="오늘 확인할 것" right={<Link href="/briefing" className="text-xs link">브리핑 모아보기</Link>}>
          <Checklist items={checklist} />
        </Section>
        <MyDashboard />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="핵심 종목" description="선 그래프: 최근 1개월 종가 · 색은 오늘 등락 방향">
          <div className="grid gap-x-4 sm:grid-cols-2">
            {core.map((s) => (
              <QuoteRow key={s} symbol={s} q={quotes.get(s)} spark={sparkCloses(s)} digest={digests.get(s)} />
            ))}
          </div>
        </Section>
        <WatchlistPanel />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="시장 움직임" description="지원 종목 안에서만 계산">
          <PanelTabs
            label="시장 움직임"
            variant="pill"
            tabs={[
              {
                key: "changes",
                label: "새 변화",
                count: notable.length,
                content: notable.length ? (
                  <ul className="flex flex-col divide-y divide-line">
                    {notable.map((d) => (
                      <li key={d.scope}>
                        <Link href={`/stock/${d.scope}?tab=briefing`} className="flex flex-col gap-1 py-2 hover:text-accent">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold">{d.scope} <span className="text-xs font-normal text-muted">{getInstrument(d.scope)?.nameKo}</span></span>
                            <span className={`num text-sm font-semibold ${changeClass(d.changePct)}`}>{fmtPct(d.changePct)}</span>
                          </span>
                          <ChangeChips d={d} max={3} minImportance={2} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>{digests.size ? "전일 대비 새로 생긴 중요한 변화가 있는 종목이 없습니다." : "아직 생성된 종목별 브리핑이 없습니다."}</Empty>
                ),
              },
              { key: "up", label: "상승", content: <MoverList items={gainers.map((q) => ({ q }))} /> },
              { key: "down", label: "하락", content: <MoverList items={losers.map((q) => ({ q }))} /> },
              { key: "vol", label: "거래량", content: <MoverList items={volumeMovers.map((v) => ({ q: v.q, extra: `평균의 ${v.ratio.toFixed(1)}배` }))} /> },
            ]}
          />
        </Section>
        <Section title="시장 브리핑" right={<Link href="/briefing" className="text-xs link">전체 보기</Link>}>
          {market ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">{market.content.sessionLabel} · {formatEt(market.generatedAt)}</p>
              <p className="text-[15px] font-semibold leading-relaxed">{market.content.headline}</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
                {market.content.sections.slice(0, 3).flatMap((x) => x.statements.slice(0, 1)).map((x, i) => (
                  <li key={i}>{x.text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>아직 생성된 시장 브리핑이 없습니다. 장 마감 후 자동으로 생성됩니다.</Empty>
          )}
          {health.briefingFail && <p className="mt-2 text-xs text-warn">최근 브리핑 생성 실패: {health.briefingFail.message}</p>}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="시장 뉴스" description="최근 36시간 · 같은 내용은 하나로">
          <NewsList items={news.slice(0, 5)} empty="수집된 시장 뉴스가 없습니다." compact />
        </Section>
        <Section title="다가오는 일정" description="발표·확인된 일정만">
          <PanelTabs
            label="다가오는 일정"
            variant="pill"
            tabs={[
              {
                key: "div",
                label: "배당락·지급",
                count: divs.length,
                content: divs.length ? (
                  <ul className="flex flex-col divide-y divide-line text-sm">
                    {divs.slice(0, 8).map((d) => (
                      <li key={`${d.symbol}${d.exDate}${d.kind}`} className="flex items-center justify-between gap-2 py-2">
                        <Link href={`/stock/${d.symbol}?tab=dividends`} className="font-semibold hover:text-accent">{d.symbol}</Link>
                        <span className="num text-xs text-ink-2">락 {d.exDate.slice(5).replace("-", "/")} · 지급 {d.payDate ? d.payDate.slice(5).replace("-", "/") : "미제공"} · {fmtDividend(d.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>21일 안에 발표된 배당락·지급 일정이 없습니다.</Empty>
                ),
              },
              {
                key: "earn",
                label: "실적",
                count: earnings.length,
                content: earnings.length ? (
                  <ul className="flex flex-col divide-y divide-line text-sm">
                    {earnings.slice(0, 8).map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                        <span>
                          <span className="num mr-2 text-xs text-muted">{e.date.slice(5).replace("-", "/")}</span>
                          <span className="font-semibold">{e.symbol}</span> <span className="text-xs text-muted">{e.timeHint ?? ""}</span>
                        </span>
                        <span className="text-right text-xs text-ink-2">{e.data?.epsActual != null ? `EPS ${e.data.epsActual} (예상 ${e.data.epsEstimate ?? "-"})` : ((e.data?.relatedEtfs as string[] | undefined) ?? []).slice(0, 2).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>확인된 실적 발표 일정이 없습니다.</Empty>
                ),
              },
              {
                key: "econ",
                label: "경제지표",
                count: econ.length,
                content: econ.length ? (
                  <ul className="flex flex-col divide-y divide-line text-sm">
                    {econ.slice(0, 8).map((e) => (
                      <li key={e.id} className="flex justify-between gap-2 py-2">
                        <span>{e.title}</span>
                        <span className="num text-xs text-muted">{e.date.slice(5).replace("-", "/")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>7일 안에 확인된 경제지표 발표 일정이 없습니다.</Empty>
                ),
              },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

export const metadata = { title: "대시보드" };
