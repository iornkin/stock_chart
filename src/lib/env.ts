/**
 * 서버 측 환경변수 (API 키는 절대로 클라이언트 번들에 포함하지 않는다).
 * 이 모듈은 서버 코드(Route Handler, Server Component, worker)에서만 import 한다.
 */
import path from "node:path";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" ? v : fallback;
}

export const env = {
  get databasePath() {
    return path.resolve(str("DATABASE_PATH", "./data/app.db"));
  },
  // ── 데이터 제공처 활성화 여부 / API 키 ──
  get yahooEnabled() { return bool("ENABLE_YAHOO", true); },
  get nasdaqEnabled() { return bool("ENABLE_NASDAQ", true); },
  get googleNewsEnabled() { return bool("ENABLE_GOOGLE_NEWS", true); },
  get secUserAgent() { return str("SEC_USER_AGENT"); },
  get finnhubKey() { return str("FINNHUB_API_KEY"); },
  get polygonKey() { return str("POLYGON_API_KEY"); },
  get fredKey() { return str("FRED_API_KEY"); },
  get alphaVantageKey() { return str("ALPHAVANTAGE_API_KEY"); },
  get alphaVantageDailyBudget() { return num("ALPHAVANTAGE_DAILY_BUDGET", 20); },
  get anthropicKey() { return str("ANTHROPIC_API_KEY"); },
  // ── 기본 URL (프록시/테스트 환경에서 재정의 가능) ──
  get yahooQuery1() { return str("YAHOO_QUERY1_BASE", "https://query1.finance.yahoo.com"); },
  get yahooQuery2() { return str("YAHOO_QUERY2_BASE", "https://query2.finance.yahoo.com"); },
  get yahooCookieUrl() { return str("YAHOO_COOKIE_URL", "https://fc.yahoo.com"); },
  get nasdaqBase() { return str("NASDAQ_API_BASE", "https://api.nasdaq.com"); },
  get secBase() { return str("SEC_API_BASE", "https://data.sec.gov"); },
  get polygonBase() { return str("POLYGON_API_BASE", "https://api.polygon.io"); },
  get finnhubBase() { return str("FINNHUB_API_BASE", "https://finnhub.io/api/v1"); },
  get fredBase() { return str("FRED_API_BASE", "https://api.stlouisfed.org"); },
  get alphaVantageBase() { return str("ALPHAVANTAGE_API_BASE", "https://www.alphavantage.co"); },
  get googleNewsBase() { return str("GOOGLE_NEWS_BASE", "https://news.google.com"); },
  // ── AI 브리핑 (선택) ──
  get llmModel() { return str("LLM_MODEL", "claude-opus-5-5"); },
  get llmEffort() { return str("LLM_EFFORT", "low") as "low" | "medium" | "high"; },
  /** 쉼표로 구분: intraday, close, non_trading, market */
  get llmSessions() { return str("LLM_SESSIONS", "close,market").split(",").map((s) => s.trim()).filter(Boolean); },
  // ── 운영 ──
  get adminToken() { return str("ADMIN_TOKEN"); },
  get httpTimeoutMs() { return num("HTTP_TIMEOUT_MS", 15000); },
  get onDemandFetch() { return bool("ON_DEMAND_FETCH", true); },
  get logLevel() { return str("LOG_LEVEL", "info"); },
};

export type Env = typeof env;
