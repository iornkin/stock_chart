/** 뉴스 식별·중복 통합 유틸리티 (서버 전용) */
import { createHash } from "node:crypto";
import type { NewsItem } from "./types";

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|guccounter|guce_|ncid|yptr|soc_|cmpid|ref$)/i.test(k)) url.searchParams.delete(k);
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return u.trim();
  }
}

export function newsId(url: string): string {
  return createHash("sha1").update(canonicalUrl(url)).digest("hex").slice(0, 20);
}

const STOP = new Set(
  "a an the of to in on for and or is are was were be with as at by from its it this that after over into amid than vs says say said".split(" "),
);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9%$.\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/\.$/, ""))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Google News 제목의 " - 매체명" 접미사 제거 */
export function stripPublisherSuffix(title: string, publisher: string | null): string {
  if (publisher && title.endsWith(` - ${publisher}`)) return title.slice(0, -(publisher.length + 3)).trim();
  return title.trim();
}

/**
 * 같은 사건을 다룬 중복 기사 통합.
 * - URL 이 같으면 동일 기사
 * - 제목 토큰 유사도(Jaccard)가 기준 이상이고 게시 시각이 48시간 이내면 같은 내용으로 간주
 * 대표 기사는 가장 먼저 게시된 기사(요약이 있는 기사 우선)로 정한다.
 */
export function dedupeNews(items: NewsItem[], threshold = 0.55): NewsItem[] {
  const sorted = [...items].sort((a, b) => a.publishedAt - b.publishedAt);
  const clusters: { rep: NewsItem; tokens: Set<string>; members: NewsItem[] }[] = [];
  const byUrl = new Map<string, number>();
  for (const it of sorted) {
    const cu = canonicalUrl(it.url);
    const existing = byUrl.get(cu);
    if (existing !== undefined) {
      clusters[existing].members.push(it);
      continue;
    }
    const tokens = titleTokens(it.title);
    let idx = -1;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (Math.abs(c.rep.publishedAt - it.publishedAt) > 48 * 3600_000) continue;
      if (jaccard(c.tokens, tokens) >= threshold) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      clusters.push({ rep: it, tokens, members: [it] });
      byUrl.set(cu, clusters.length - 1);
    } else {
      clusters[idx].members.push(it);
      byUrl.set(cu, idx);
    }
  }
  return clusters
    .map((c) => {
      const withSummary = c.members.find((m) => m.summary);
      const withImage = c.members.find((m) => m.image);
      let rep = withSummary && !c.rep.summary ? { ...c.rep, summary: withSummary.summary } : c.rep;
      if (withImage && !rep.image) rep = { ...rep, image: withImage.image };
      const seen = new Set([canonicalUrl(rep.url)]);
      const duplicates = c.members
        .filter((m) => {
          const cu = canonicalUrl(m.url);
          if (seen.has(cu)) return false;
          seen.add(cu);
          return true;
        })
        .map((m) => ({ title: m.title, url: m.url, publisher: m.publisher, publishedAt: m.publishedAt }));
      return { ...rep, duplicates };
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/** HTML 태그·엔티티 제거 */
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** 제공처가 준 이미지 주소 중 http(s) 만 허용 */
export function safeImageUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
