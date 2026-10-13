/**
 * Alpha Vantage — API 키 필요 (무료 플랜: 하루 25회)
 * ETF_PROFILE: 순자산, 순 총보수, 섹터 비중, 편입 종목·비중
 * 무료 호출 수가 매우 적으므로 하루 예산(ALPHAVANTAGE_DAILY_BUDGET) 안에서 순환 갱신한다.
 */
import { env } from "../env";
import { ProviderError, consumeBudget, requestJson } from "../http";
import { etDate } from "../time";

const P = "alphavantage";

export function alphaVantageEnabled() {
  return Boolean(env.alphaVantageKey);
}

export interface AvEtfProfile {
  netAssets: number | null;
  netExpenseRatio: number | null;
  portfolioTurnover: number | null;
  dividendYield: number | null;
  inceptionDate: string | null;
  leveraged: string | null;
  sectors: { sector: string; weight: number }[];
  holdings: { symbol: string | null; name: string; weight: number }[];
}

const num = (v: unknown) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || v === "None" || v === "n/a" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseEtfProfile(json: Record<string, unknown>): AvEtfProfile {
  if (typeof json.Information === "string" || typeof json.Note === "string") {
    throw new ProviderError(P, `호출 한도 또는 안내: ${String(json.Information ?? json.Note).slice(0, 160)}`, 429, true);
  }
  if (typeof json["Error Message"] === "string") throw new ProviderError(P, String(json["Error Message"]));
  const sectors = Array.isArray(json.sectors) ? (json.sectors as Array<Record<string, unknown>>) : [];
  const holdings = Array.isArray(json.holdings) ? (json.holdings as Array<Record<string, unknown>>) : [];
  return {
    netAssets: num(json.net_assets),
    netExpenseRatio: num(json.net_expense_ratio),
    portfolioTurnover: num(json.portfolio_turnover),
    dividendYield: num(json.dividend_yield),
    inceptionDate: typeof json.inception_date === "string" ? json.inception_date : null,
    leveraged: typeof json.leveraged === "string" ? json.leveraged : null,
    sectors: sectors
      .map((s) => ({ sector: String(s.sector ?? ""), weight: num(s.weight) ?? NaN }))
      .filter((s) => s.sector && Number.isFinite(s.weight)),
    holdings: holdings
      .map((h) => ({
        symbol: typeof h.symbol === "string" && h.symbol !== "n/a" ? h.symbol : null,
        name: String(h.description ?? h.symbol ?? ""),
        weight: num(h.weight) ?? NaN,
      }))
      .filter((h) => h.name && Number.isFinite(h.weight)),
  };
}

export async function fetchEtfProfile(symbol: string): Promise<AvEtfProfile> {
  if (!alphaVantageEnabled()) throw new ProviderError(P, "ALPHAVANTAGE_API_KEY 미설정");
  if (!consumeBudget(P, etDate(), env.alphaVantageDailyBudget)) {
    throw new ProviderError(P, "오늘 호출 예산 소진", 429, true);
  }
  const url = `${env.alphaVantageBase}/query?function=ETF_PROFILE&symbol=${encodeURIComponent(symbol)}&apikey=${env.alphaVantageKey}`;
  const json = await requestJson<Record<string, unknown>>(P, url);
  return parseEtfProfile(json);
}
