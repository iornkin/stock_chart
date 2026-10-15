/**
 * AAII 투자심리 설문 (American Association of Individual Investors Sentiment Survey)
 * - AAII 회원(개인 투자자)에게 "앞으로 6개월 동안 주식시장 방향"을 묻는 주간 설문. 목~수 투표, 목요일 공표.
 * - 실제 계좌의 매수·매도 포지션이 아니라 '전망'이다. 응답자는 AAII 회원으로 한정된다.
 * - 공개 페이지에 최근 몇 주 결과와 장기 평균이 나온다. 이 사이트는 공개 페이지의 값만 읽어 주마다 쌓고, 원문 링크를 함께 표시한다.
 *   (전체 과거 엑셀 파일은 재배포하지 않는다 — 출처 이용 조건)
 */
import { env } from "../env";
import { BROWSER_UA, ProviderError, requestText } from "../http";

const P = "aaii";

export interface SentimentWeek {
  /** 설문 마감일(수요일) */
  weekEnding: string;
  bullish: number;
  neutral: number;
  bearish: number;
}

export interface AaiiPage {
  weeks: SentimentWeek[];
  averages: { bullish: number; neutral: number; bearish: number } | null;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (x: number) => String(x).padStart(2, "0");

/** HTML → 공백 하나로 정리한 본문 글자 (스크립트·스타일 제외) */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/\s+/g, " ");
}

const PCT = String.raw`(\d{1,3}(?:\.\d+)?)%`;

/** 설문 메인 페이지: 'Week Ending … Bullish Neutral Bearish' 표(전체 날짜)와 'Historical Averages' */
export function parseSurveyPage(html: string): AaiiPage {
  const t = htmlText(html);
  const weeks: SentimentWeek[] = [];
  const block = t.match(/Week Ending[^0-9]*Bullish Neutral Bearish (.*?)(?:Historical|$)/i)?.[1] ?? "";
  for (const m of block.matchAll(new RegExp(String.raw`(\d{1,2})/(\d{1,2})/(\d{4}) ${PCT} ${PCT} ${PCT}`, "g"))) {
    weeks.push({ weekEnding: `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`, bullish: Number(m[4]), neutral: Number(m[5]), bearish: Number(m[6]) });
  }
  const avg = t.match(new RegExp(String.raw`Historical Averages? ${PCT} ${PCT} ${PCT}`, "i"));
  return { weeks, averages: avg ? { bullish: Number(avg[1]), neutral: Number(avg[2]), bearish: Number(avg[3]) } : null };
}

/**
 * 결과 페이지: 'Oct 14 | 38.7% | 19.7% | 41.6%' 처럼 연도 없이 월·일만 있는 표.
 * 연도는 기준일(메인 페이지의 가장 최근 주, 연도 포함)부터 거꾸로 붙인다 — 날짜가 앞 행보다 늦어지면 한 해 전으로.
 */
export function parseResultsPage(html: string, anchor: string): SentimentWeek[] {
  const out: SentimentWeek[] = [];
  let year = Number(anchor.slice(0, 4));
  let prev = anchor;
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1]).trim());
    if (cells.length < 4) continue;
    const md = cells[0].match(/^([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})$/);
    const vals = cells.slice(1, 4).map((c) => c.match(/^(\d{1,3}(?:\.\d+)?)%$/)?.[1]);
    if (!md || !MONTHS[md[1]] || vals.some((v) => v === undefined)) continue;
    let d = `${year}-${pad(MONTHS[md[1]])}-${pad(Number(md[2]))}`;
    if (d > prev) {
      year -= 1;
      d = `${year}-${pad(MONTHS[md[1]])}-${pad(Number(md[2]))}`;
    }
    prev = d;
    out.push({ weekEnding: d, bullish: Number(vals[0]), neutral: Number(vals[1]), bearish: Number(vals[2]) });
  }
  return out;
}

export async function fetchAaii(): Promise<AaiiPage> {
  const headers = { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" };
  const main = parseSurveyPage(await requestText(P, `${env.aaiiBase}/sentimentsurvey`, { headers, retries: 1, timeoutMs: 30000 }));
  if (!main.weeks.length) throw new ProviderError(P, "설문 결과 표를 찾지 못했습니다 (페이지 구조 변경 가능)");
  const anchor = main.weeks.map((w) => w.weekEnding).sort().at(-1)!;
  let more: SentimentWeek[] = [];
  try {
    more = parseResultsPage(await requestText(P, `${env.aaiiBase}/sentimentsurvey/sent_results`, { headers, retries: 1, timeoutMs: 30000 }), anchor);
  } catch {
    // 결과 페이지가 없어도 메인 페이지 값은 쓴다
  }
  // 같은 주는 메인 페이지(연도 포함) 값을 우선
  const byWeek = new Map<string, SentimentWeek>();
  for (const w of more) byWeek.set(w.weekEnding, w);
  for (const w of main.weeks) byWeek.set(w.weekEnding, w);
  return { weeks: [...byWeek.values()].sort((a, b) => (a.weekEnding < b.weekEnding ? 1 : -1)), averages: main.averages };
}
