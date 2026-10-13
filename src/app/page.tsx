import Link from "next/link";
import { MARKET_SYMBOLS } from "@/config/instruments";
import { allSymbols, coreSymbols, getInstrument } from "@/lib/instruments";
import { getQuotes, type QuoteView } from "@/lib/data/quotes";
import { readNews, MARKET_SCOPE } from "@/lib/data/news";
import { readEvents } from "@/lib/data/events";
import { readAllDividends } from "@/lib/data/dividends";
import { latestBriefing, latestBriefingRecords } from "@/lib/briefing/store";
import type { MarketBriefing, SymbolBriefing } from "@/lib/briefing/types";
import { digestOf } from "@/lib/briefing/digest";
import { leverageRiskSnapshot } from "@/lib/leverage";
import ChangeChips from "@/components/ChangeChips";
import { marketStatus } from "@/lib/market-calendar";
import { addDays, formatEt } from "@/lib/time";
import { changeClass, fmtDividend, fmtPct, fmtPrice } from "@/lib/format";
import { dataHealth, sparkCloses } from "@/lib/views";
import QuoteCard from "@/components/QuoteCard";
import { Change, Empty, Notice, PctBadge, Section } from "@/components/ui";
import MyDashboard from "@/components/MyDashboard";
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

type CheckItem = { tag: string; text: React.ReactNode; href?: string; tone?: "warn" | "up" | "down" };

function Checklist({ items }: { items: CheckItem[] }) {
  if (!items.length) return <Empty>오늘 따로 확인할 새 항목이 없습니다.</Empty>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((it, i) => {
        const body = (
          <span className="flex items-start gap-3 py-2.5">
            <span className={`mt-0.5 w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${it.tone === "warn" ? "bg-warn-soft text-warn" : it.tone === "up" ? "bg-up-soft text-up" : it.tone === "down" ? "bg-down-soft text-down" : "bg-surface-2 text-ink-2"}`}>{it.tag}</span>
            <span className="min-w-0 flex-1 text-[14px] leading-relaxed">{it.text}</span>
            {it.href && <span aria-hidden className="text-muted">›</span>}
          </span>
        );
        return <li key={i}>{it.href ? <Link href={it.href} className="block hover:text-accent">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

function Fresh({ label, ms }: { label: string; ms: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
      {label} <span className="num font-semibold text-ink">{ms ? formatEt(ms).slice(5) : "없음"}</span> <RelTime ms={ms} paren />
    </span>
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
    .filter((d) => d.maxImportance >= 2)
    .sort((a, b) => b.maxImportance - a.maxImportance || Number(coreSet.has(b.scope)) - Number(coreSet.has(a.scope)) || Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .slice(0, 9);
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
          {d.changes.filter((x) => x.importance >= 2).slice(0, 2).map((x) => x.short).join(" · ")}
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
    <div className="flex flex-col gap-6">
      <AutoRefresh />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">오늘의 투자자 대시보드</h1>
        <p className="text-sm text-ink-2">
          <MarketPhaseText at={renderedAt} variant="line" />
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Fresh label="시세" ms={lastQuote} />
          <Fresh label="장 마감 데이터" ms={health.eodOk} />
          <Fresh label="뉴스" ms={health.newsOk} />
          <Fresh label="브리핑" ms={health.briefingOk} />
          <Link href="/status" className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] text-muted hover:text-accent">
            데이터 상태 →
          </Link>
        </div>
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
      <section aria-label="금리·환율·금·변동성" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {MARKET_SYMBOLS.filter((m) => !m.headline).map((m) => {
          const q = quotes.get(m.symbol);
          if (!q || q.price === null) return null;
          return (
            <div key={m.symbol} className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2" title={m.note}>
              <div className="truncate text-[11px] text-muted">{m.nameKo}</div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="num text-sm font-semibold">{fmtPrice(q.price, m.unit === "%" ? 3 : 2)}{m.unit === "%" ? "%" : m.unit === "krw" ? "원" : ""}</span>
                <span className={`num text-xs font-semibold ${changeClass(q.changePct)}`}>{fmtPct(q.changePct)}</span>
              </div>
            </div>
          );
        })}
      </section>

      <MyDashboard />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Section title="오늘 확인할 것" description="수집된 데이터와 브리핑에서 자동으로 고른 항목입니다. 누르면 자세한 내용으로 이동합니다.">
          <Checklist items={checklist} />
        </Section>
        <WatchlistPanel />
      </div>

      <Section
        title="오늘 새 변화가 있는 종목"
        description="전일 대비 새로 생긴 중요한 변화(이동평균 돌파, 신고가·신저가, 평소보다 큰 등락, 배당 발표 등)가 있는 종목입니다."
        right={<Link href="/briefing" className="text-xs link">브리핑 모아보기</Link>}
      >
        {notable.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {notable.map((d) => (
              <li key={d.scope}>
                <Link href={`/stock/${d.scope}?tab=briefing`} className="flex h-full flex-col gap-2 rounded-xl border border-line p-3.5 transition-colors hover:border-accent">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-bold">{d.scope}</span> <span className="block truncate text-xs text-muted">{getInstrument(d.scope)?.nameKo} 오늘의 브리핑</span>
                    </span>
                    <span className={`num shrink-0 text-sm font-semibold ${changeClass(d.changePct)}`}>{fmtPct(d.changePct)}</span>
                  </span>
                  <ChangeChips d={d} max={3} minImportance={2} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{digests.size ? "오늘은 전일 대비 새로 생긴 중요한 변화가 있는 종목이 없습니다." : "아직 생성된 종목별 브리핑이 없습니다. 수집 작업이 실행되면 자동으로 생성됩니다."}</Empty>
        )}
      </Section>

      <Section title="핵심 종목 현황" description="카드의 선 그래프는 최근 1개월 종가이며, 색은 오늘 등락 방향(상승·하락)을 따릅니다.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {core.map((s) => (
            <QuoteCard key={s} symbol={s} nameKo={getInstrument(s)?.nameKo ?? s} quote={quotes.get(s)} spark={sparkCloses(s)} sparkLabel="최근 1개월 종가 추이" digest={digests.get(s)} />
          ))}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="오늘의 시장 브리핑" right={<Link href="/briefing" className="text-xs link">전체 보기</Link>}>
          {market ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">{market.content.sessionLabel} · 생성 {formatEt(market.generatedAt)}</p>
              <p className="text-[15px] font-semibold leading-relaxed">{market.content.headline}</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
                {market.content.sections.slice(0, 3).flatMap((s) => s.statements.slice(0, 1)).map((s, i) => (
                  <li key={i}>{s.text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>아직 생성된 시장 브리핑이 없습니다. 장 마감 후 자동으로 생성됩니다.</Empty>
          )}
          {health.briefingFail && <p className="mt-2 text-xs text-warn">최근 브리핑 생성 실패: {health.briefingFail.message} (마지막 정상 생성 {health.briefingOk ? formatEt(health.briefingOk) : "없음"})</p>}
        </Section>
        <Section title="레버리지 ETF 위험 지표" description="상장 이후 최고 종가 대비, 최근 20거래일 실제 수익률과 '기준 ETF × 배수'의 차이" right={<Link href="/leverage" className="text-xs link">자세히</Link>}>
          {levRisk.length ? (
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th className="r">최고점 대비</th>
                    <th className="r">20일 수익률</th>
                    <th className="r">배수 대비</th>
                    <th className="r">기준 20일 변동성</th>
                  </tr>
                </thead>
                <tbody>
                  {levRisk.map((r) => (
                    <tr key={r.symbol}>
                      <td>
                        <Link href={`/stock/${r.symbol}`} className="font-semibold hover:text-accent">{r.symbol}</Link>
                        <span className="ml-1 text-xs text-muted">{r.leverage}배·{r.base}</span>
                      </td>
                      <td className={`r font-semibold ${r.fromAth <= -20 ? "text-critical" : changeClass(r.fromAth)}`}>{fmtPct(r.fromAth, 1)}</td>
                      <td className={`r ${changeClass(r.ret20)}`}>{fmtPct(r.ret20, 1)}</td>
                      <td className={`r ${changeClass(r.gap20)}`}>{r.gap20 === null ? "-" : `${fmtPct(r.gap20, 1)}p`}</td>
                      <td className="r num">{r.baseVol20 !== null ? `${r.baseVol20.toFixed(1)}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>레버리지 ETF 일봉 데이터가 아직 없습니다.</Empty>
          )}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="상승률 상위" description="지원 종목 안에서만 계산">
          <MoverList items={gainers.map((q) => ({ q }))} />
        </Section>
        <Section title="하락률 상위" description="지원 종목 안에서만 계산">
          <MoverList items={losers.map((q) => ({ q }))} />
        </Section>
        <Section title="거래량 변화 상위" description="오늘 거래량 ÷ 3개월 평균 (장중에는 누적치)">
          <MoverList items={volumeMovers.map((v) => ({ q: v.q, extra: `${v.ratio.toFixed(2)}배` }))} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="주요 시장 뉴스" description="최근 36시간 게시 · 같은 내용은 하나로 묶음">
          <NewsList items={news} empty="수집된 시장 뉴스가 없습니다." compact />
        </Section>
        <div className="flex flex-col gap-5">
          <Section title="실적 발표 일정" description="지원 종목·ETF 상위 편입 종목 (어제~7일 후)">
            {earnings.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {earnings.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="num mr-2 text-xs text-muted">{e.date.slice(5).replace("-", "/")}</span>
                      <span className="font-semibold">{e.symbol}</span> <span className="text-xs text-muted">{e.timeHint ?? ""}</span>
                    </span>
                    <span className="text-right text-xs text-ink-2">
                      {e.data?.epsActual != null ? `EPS ${e.data.epsActual} (예상 ${e.data.epsEstimate ?? "-"})` : ((e.data?.relatedEtfs as string[] | undefined) ?? []).slice(0, 2).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>확인된 실적 발표 일정이 없습니다.</Empty>
            )}
            {econ.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 text-xs font-semibold text-ink-2">경제지표 발표 (FRED 일정)</p>
                <ul className="text-sm">
                  {econ.slice(0, 6).map((e) => (
                    <li key={e.id} className="flex justify-between py-1">
                      <span>{e.title}</span>
                      <span className="num text-xs text-muted">{e.date.slice(5).replace("-", "/")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
          <Section title="다가오는 배당락·지급일" description="발표된 일정만 (21일 이내)" right={<Link href="/income" className="text-xs link">현금흐름 계산</Link>}>
            {divs.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {divs.slice(0, 8).map((d) => (
                  <li key={`${d.symbol}${d.exDate}${d.kind}`} className="flex items-center justify-between py-2">
                    <Link href={`/stock/${d.symbol}?tab=dividends`} className="font-semibold hover:text-accent">{d.symbol}</Link>
                    <span className="num text-xs text-ink-2">
                      락 {d.exDate.slice(5).replace("-", "/")} · 지급 {d.payDate ? d.payDate.slice(5).replace("-", "/") : "미제공"} · {fmtDividend(d.amount)}
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
