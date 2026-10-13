/**
 * Google News RSS 검색 — 키 불필요.
 * ETF·기초자산(금, 지수 등) 관련 기사처럼 티커 태그가 부족한 뉴스를 보완한다.
 * 링크는 Google News 리디렉트 URL 이며, 원문 매체명은 <source> 태그 값이다.
 * RSS 는 개인적·비상업적 용도로 사용해야 한다.
 */
import { env } from "../env";
import { BROWSER_UA, requestText } from "../http";
import { decodeEntities, newsId, stripHtml, stripPublisherSuffix } from "../news-utils";
import type { NewsItem } from "../types";

const P = "googlenews";

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : null;
}

export function parseRss(xml: string, fetchedAt: number): NewsItem[] {
  const out: NewsItem[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const it of items) {
    const rawTitle = tag(it, "title");
    const link = tag(it, "link");
    const pub = Date.parse(tag(it, "pubDate") ?? "");
    if (!rawTitle || !link || !Number.isFinite(pub)) continue;
    const publisher = tag(it, "source");
    const desc = tag(it, "description");
    const title = stripPublisherSuffix(stripHtml(rawTitle), publisher);
    const summaryText = desc ? stripHtml(desc) : null;
    out.push({
      id: newsId(link),
      title,
      // Google News 의 description 은 대부분 제목 반복이므로 제목과 다를 때만 요약으로 사용
      summary: summaryText && !summaryText.startsWith(title.slice(0, 30)) ? summaryText : null,
      url: link,
      publisher,
      publishedAt: pub,
      provider: "Google News",
      fetchedAt,
      related: [],
    });
  }
  return out;
}

export async function searchRss(query: string, days = 3): Promise<NewsItem[]> {
  const q = encodeURIComponent(`${query} when:${days}d`);
  const xml = await requestText(P, `${env.googleNewsBase}/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml, text/xml" },
    // 같은 검색어(예: 'S&P 500')를 여러 ETF 가 공유하므로 30분간 재사용
    cacheKey: `gnews:${query}:${days}`,
    cacheTtlMs: 30 * 60_000,
  });
  return parseRss(xml, Date.now());
}
