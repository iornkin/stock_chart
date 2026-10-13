/**
 * Nasdaq.com 공개 API (비공식) — 배당/분배금 이력
 * 배당락일, 선언일, 기준일, 지급일, 지급액을 제공한다.
 * 개인적 용도 외 사용 조건은 Nasdaq 이용약관을 확인해야 한다.
 */
import { env } from "../env";
import { BROWSER_UA, ProviderError, requestJson } from "../http";

const P = "nasdaq";

export interface NasdaqDividendRow {
  exDate: string;
  amount: number;
  type: string | null;
  declaredDate: string | null;
  recordDate: string | null;
  payDate: string | null;
  currency: string | null;
}

/** MM/DD/YYYY → YYYY-MM-DD */
export function mdyToIso(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseAmount(s: unknown): number | null {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const v = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

interface NasdaqDivResponse {
  data?: {
    dividends?: { rows?: Array<Record<string, unknown>> | null } | null;
  } | null;
  status?: { rCode?: number; bCodeMessage?: Array<{ errorMessage?: string }> | null };
}

export function parseNasdaqDividends(json: NasdaqDivResponse): NasdaqDividendRow[] {
  if (json.status?.rCode && json.status.rCode !== 200) {
    const msg = json.status.bCodeMessage?.[0]?.errorMessage ?? `rCode ${json.status.rCode}`;
    throw new ProviderError(P, msg);
  }
  const rows = json.data?.dividends?.rows ?? [];
  const out: NasdaqDividendRow[] = [];
  for (const r of rows) {
    const exDate = mdyToIso(r.exOrEffDate);
    const amount = parseAmount(r.amount);
    if (!exDate || amount === null) continue;
    out.push({
      exDate,
      amount,
      type: typeof r.type === "string" ? r.type : null,
      declaredDate: mdyToIso(r.declarationDate),
      recordDate: mdyToIso(r.recordDate),
      payDate: mdyToIso(r.paymentDate),
      currency: typeof r.currency === "string" ? r.currency : null,
    });
  }
  return out;
}

export async function fetchDividends(symbol: string, assetClass: "stocks" | "etf"): Promise<NasdaqDividendRow[]> {
  const url = `${env.nasdaqBase}/api/quote/${encodeURIComponent(symbol)}/dividends?assetclass=${assetClass}`;
  const json = await requestJson<NasdaqDivResponse>(P, url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  return parseNasdaqDividends(json);
}
