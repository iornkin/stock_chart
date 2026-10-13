/** 페이지 공용 서버 헬퍼 */
import { all } from "./db";
import { env } from "./env";
import { lastFailure, lastSuccessAt } from "./jobs/runner";
import { redactSecrets } from "./redact";

export function sparkCloses(symbol: string, n = 22): number[] {
  return all<{ close: number }>("SELECT close FROM bars WHERE symbol=? AND interval='1d' ORDER BY ts DESC LIMIT ?", symbol, n)
    .map((r) => r.close)
    .reverse();
}

export function providerConfig() {
  return [
    { name: "Yahoo Finance", role: "시세·차트·배당 이벤트·ETF/기업 지표·뉴스 헤드라인", enabled: env.yahooEnabled, needsKey: false },
    { name: "Nasdaq.com", role: "배당·분배금 지급일·선언일·기준일", enabled: env.nasdaqEnabled, needsKey: false },
    { name: "SEC EDGAR", role: "M7 재무제표 (10-K/10-Q)", enabled: Boolean(env.secUserAgent), needsKey: true, keyName: "SEC_USER_AGENT" },
    { name: "Finnhub", role: "기업 뉴스·시장 뉴스·실적 일정·기본 지표", enabled: Boolean(env.finnhubKey), needsKey: true, keyName: "FINNHUB_API_KEY" },
    { name: "Polygon.io", role: "배당 상세(지급 주기·유형)·뉴스", enabled: Boolean(env.polygonKey), needsKey: true, keyName: "POLYGON_API_KEY" },
    { name: "FRED", role: "국채금리·달러지수·경제지표 발표 일정", enabled: Boolean(env.fredKey), needsKey: true, keyName: "FRED_API_KEY" },
    { name: "Alpha Vantage", role: "ETF 총보수·순자산·편입 종목 (보완)", enabled: Boolean(env.alphaVantageKey), needsKey: true, keyName: "ALPHAVANTAGE_API_KEY" },
    { name: "Google News RSS", role: "ETF·기초자산 관련 뉴스 검색", enabled: env.googleNewsEnabled, needsKey: false },
    { name: "Anthropic Claude", role: "(선택) 브리핑 서술·뉴스 한국어 요약", enabled: Boolean(env.anthropicKey), needsKey: true, keyName: "ANTHROPIC_API_KEY" },
  ];
}

export function providerStats(sinceMs: number) {
  return all<{ provider: string; ok: number; fail: number; last_at: number; last_error: string | null }>(
    `SELECT provider, sum(ok) AS ok, sum(1-ok) AS fail, max(at) AS last_at,
       (SELECT error FROM provider_calls p2 WHERE p2.provider = p.provider AND p2.ok = 0 ORDER BY at DESC LIMIT 1) AS last_error
     FROM provider_calls p WHERE at >= ? GROUP BY provider ORDER BY provider`,
    sinceMs,
  ).map((r) => ({ ...r, last_error: r.last_error ? redactSecrets(r.last_error) : null }));
}

export function dataHealth() {
  return {
    quotesOk: lastSuccessAt("refresh_quotes"),
    quotesFail: lastFailure("refresh_quotes"),
    eodOk: lastSuccessAt("collect_eod"),
    newsOk: lastSuccessAt("collect_news"),
    briefingOk: Math.max(lastSuccessAt("briefing_close") ?? 0, lastSuccessAt("briefing_intraday") ?? 0, lastSuccessAt("briefing_non_trading") ?? 0) || null,
    briefingFail: lastFailure("briefing_close") ?? lastFailure("briefing_intraday") ?? lastFailure("briefing_non_trading"),
  };
}
