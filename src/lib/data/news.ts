/**
 * 뉴스 수집·저장·조회
 * - 종목 뉴스: Yahoo 검색(티커), Finnhub company-news(개별 기업), Polygon(키 있을 때), Google News RSS(ETF·기초자산 검색어)
 * - 시장 뉴스: Finnhub general, Yahoo 검색, Google News RSS
 * 각 기사에는 "해당 종목과 관련이 있는 이유"를 규칙 기반으로 기록한다.
 */
import { all, run, tx } from "../db";
import { env } from "../env";
import { getInstrument } from "../instruments";
import * as yahoo from "../providers/yahoo";
import * as finnhub from "../providers/finnhub";
import * as polygon from "../providers/polygon";
import * as gnews from "../providers/googlenews";
import { dedupeNews } from "../news-utils";
import type { NewsItem } from "../types";
import { addDays, etDate } from "../time";

export const MARKET_SCOPE = "MARKET";

type MatchType = "tagged" | "title" | "query" | "search" | "market";

interface Tagged {
  item: NewsItem;
  matchType: MatchType;
  reason: string;
}

function keywords(symbol: string): string[] {
  const inst = getInstrument(symbol);
  const kws = [symbol];
  if (inst?.kind === "stock") {
    for (const q of inst.newsQueries ?? []) kws.push(...q.split(/\s+/).filter((w) => w.length > 2));
  }
  return kws;
}

export function classify(symbol: string, item: NewsItem, via: { kind: "ticker" | "query"; query?: string }): Tagged {
  if (item.related.includes(symbol)) {
    return { item, matchType: "tagged", reason: `제공처(${item.provider})가 ${symbol} 관련 기사로 분류` };
  }
  for (const kw of keywords(symbol)) {
    const re = new RegExp(`(^|[^A-Za-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, kw === symbol ? "" : "i");
    if (re.test(item.title)) return { item, matchType: "title", reason: `제목에 '${kw}' 언급` };
  }
  if (via.kind === "query") {
    return { item, matchType: "query", reason: `'${via.query}' 검색 결과 (기초지수·기초자산·업종 관련 기사)` };
  }
  return { item, matchType: "search", reason: `제공처 티커 검색 결과 (제목·태그에 직접 언급 없음)` };
}

function saveTagged(scope: string, tagged: Tagged[]) {
  if (!tagged.length) return;
  tx(() => {
    for (const { item, matchType, reason } of tagged) {
      run(
        `INSERT INTO news(id, title, summary, url, publisher, published_at, provider, fetched_at, related)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET summary=COALESCE(news.summary, excluded.summary),
           related=CASE WHEN length(excluded.related) > length(COALESCE(news.related,'')) THEN excluded.related ELSE news.related END`,
        item.id,
        item.title,
        item.summary,
        item.url,
        item.publisher,
        item.publishedAt,
        item.provider,
        item.fetchedAt,
        JSON.stringify(item.related),
      );
      const rank: Record<MatchType, number> = { tagged: 4, title: 3, query: 2, market: 2, search: 1 };
      const existing = all<{ match_type: string }>("SELECT match_type FROM news_symbols WHERE news_id=? AND symbol=?", item.id, scope)[0];
      if (!existing || rank[matchType] > (rank[existing.match_type as MatchType] ?? 0)) {
        run(
          "INSERT INTO news_symbols(news_id, symbol, reason, match_type) VALUES(?,?,?,?) ON CONFLICT(news_id, symbol) DO UPDATE SET reason=excluded.reason, match_type=excluded.match_type",
          item.id,
          scope,
          reason,
          matchType,
        );
      }
    }
  });
}

export interface NewsCollectResult {
  scope: string;
  count: number;
  providers: string[];
  errors: string[];
}

export async function collectSymbolNews(symbol: string, opts: { usePolygon?: boolean } = {}): Promise<NewsCollectResult> {
  const inst = getInstrument(symbol);
  const tagged: Tagged[] = [];
  const providers = new Set<string>();
  const errors: string[] = [];
  const since = Date.now() - 7 * 86400_000;
  const add = (items: NewsItem[], via: { kind: "ticker" | "query"; query?: string }) => {
    for (const it of items) if (it.publishedAt >= since) tagged.push(classify(symbol, it, via));
  };

  if (env.yahooEnabled) {
    try {
      add(await yahoo.searchNews(symbol, 15), { kind: "ticker" });
      providers.add("Yahoo Finance");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (inst?.kind === "stock" && finnhub.finnhubEnabled()) {
    try {
      add(await finnhub.companyNews(symbol, addDays(etDate(), -4), etDate()), { kind: "ticker" });
      providers.add("Finnhub");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (opts.usePolygon && polygon.polygonEnabled()) {
    try {
      add(await polygon.fetchNews(symbol, 15), { kind: "ticker" });
      providers.add("Polygon.io");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (env.googleNewsEnabled && inst?.kind === "etf") {
    try {
      add(await gnews.searchRss(`"${symbol}" ETF`, 4), { kind: "ticker" });
      providers.add("Google News");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // 기초지수·기초자산 검색어 (ETF) — 같은 검색어는 http 캐시로 재사용
  if (inst?.kind === "etf") {
    for (const q of inst.newsQueries ?? []) {
      if (q.toUpperCase().includes(symbol)) continue;
      if (env.googleNewsEnabled) {
        try {
          add(await gnews.searchRss(q, 2), { kind: "query", query: q });
          providers.add("Google News");
        } catch (e) {
          errors.push((e as Error).message);
        }
      } else if (env.yahooEnabled) {
        try {
          add(await yahoo.searchNews(q, 10), { kind: "query", query: q });
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
    }
  }
  saveTagged(symbol, tagged);
  return { scope: symbol, count: tagged.length, providers: [...providers], errors };
}

export async function collectMarketNews(): Promise<NewsCollectResult> {
  const tagged: Tagged[] = [];
  const providers = new Set<string>();
  const errors: string[] = [];
  const since = Date.now() - 3 * 86400_000;
  const add = (items: NewsItem[], reason: string) => {
    for (const it of items) if (it.publishedAt >= since) tagged.push({ item: it, matchType: "market", reason });
  };
  if (finnhub.finnhubEnabled()) {
    try {
      add(await finnhub.generalNews(), "Finnhub 일반 시장 뉴스");
      providers.add("Finnhub");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (env.yahooEnabled) {
    try {
      add(await yahoo.searchNews("stock market today", 15), "'stock market today' 검색 결과");
      providers.add("Yahoo Finance");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (env.googleNewsEnabled) {
    for (const q of ["stock market today", "Federal Reserve rates", "Treasury yields"]) {
      try {
        add(await gnews.searchRss(q, 1), `'${q}' 검색 결과`);
        providers.add("Google News");
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  saveTagged(MARKET_SCOPE, tagged);
  return { scope: MARKET_SCOPE, count: tagged.length, providers: [...providers], errors };
}

interface NewsRow {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  publisher: string | null;
  published_at: number;
  provider: string;
  fetched_at: number;
  related: string | null;
  ai_title_ko: string | null;
  ai_summary_ko: string | null;
  reason: string | null;
  match_type: string | null;
}

function rowToItem(r: NewsRow): NewsItem {
  let related: string[] = [];
  try {
    related = r.related ? JSON.parse(r.related) : [];
  } catch {
    related = [];
  }
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publisher: r.publisher,
    publishedAt: r.published_at,
    provider: r.provider,
    fetchedAt: r.fetched_at,
    related,
    aiTitleKo: r.ai_title_ko,
    aiSummaryKo: r.ai_summary_ko,
    reason: r.reason,
    matchType: r.match_type,
  };
}

/** 종목(또는 MARKET) 뉴스 조회 — 중복 통합 후 최신순 */
export function readNews(scope: string, sinceMs: number, untilMs = Date.now() + 3600_000, limit = 30, minMatch: MatchType[] = ["tagged", "title", "query", "search", "market"]): NewsItem[] {
  const rows = all<NewsRow>(
    `SELECT n.*, s.reason, s.match_type FROM news n JOIN news_symbols s ON s.news_id = n.id
     WHERE s.symbol = ? AND n.published_at >= ? AND n.published_at <= ? AND s.match_type IN (${minMatch.map(() => "?").join(",")})
     ORDER BY n.published_at DESC LIMIT 200`,
    scope,
    sinceMs,
    untilMs,
    ...minMatch,
  );
  return dedupeNews(rows.map(rowToItem)).slice(0, limit);
}

export function lastNewsFetch(scope: string): number | null {
  const r = all<{ m: number | null }>(
    "SELECT max(n.fetched_at) AS m FROM news n JOIN news_symbols s ON s.news_id = n.id WHERE s.symbol = ?",
    scope,
  )[0];
  return r?.m ?? null;
}

export function saveAiNewsText(id: string, titleKo: string | null, summaryKo: string | null) {
  run("UPDATE news SET ai_title_ko=?, ai_summary_ko=? WHERE id=?", titleKo, summaryKo, id);
}
