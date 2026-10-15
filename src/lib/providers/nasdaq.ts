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

/**
 * 옵션 체인 합계 (Nasdaq, OPRA 통합 시세 기준) — 모든 만기·행사가의 콜·풋 거래량과 미결제약정 합계
 * - 거래량: 수집 시각까지의 그 거래일 거래량 (장 마감 후 수집해야 하루 전체)
 * - 미결제약정: OCC 가 하루 한 번 갱신하는 값으로 보통 전 거래일 말 기준
 * '--'·빈 값은 거래가 없었던 것으로 보고 0 으로 더한다. 숫자 행이 하나도 없으면 null.
 */
export interface OptionChainTotals {
  callVolume: number;
  putVolume: number;
  callOI: number;
  putOI: number;
  /** 행사가 행 수 (만기×행사가) */
  contracts: number;
  expiries: number;
  /** 'AS OF OCT 15, 2026' → 2026-10-15 */
  asOf: string | null;
  totalRecord: number | null;
}

interface NasdaqOptionResponse {
  data?: { totalRecord?: number; lastTrade?: string; table?: { rows?: Array<Record<string, unknown>> | null } | null } | null;
  message?: string | null;
  status?: { rCode?: number; bCodeMessage?: Array<{ errorMessage?: string }> | null };
}

const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function optNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "" || t === "--") return 0;
  const x = Number(t.replace(/,/g, ""));
  return Number.isFinite(x) && x >= 0 ? x : null;
}

export function parseOptionChain(json: NasdaqOptionResponse): OptionChainTotals | null {
  if (json.status?.rCode && json.status.rCode !== 200) {
    throw new ProviderError(P, json.status.bCodeMessage?.[0]?.errorMessage ?? `rCode ${json.status.rCode}`);
  }
  const rows = json.data?.table?.rows ?? [];
  if (!rows.length) return null; // 옵션이 없는 종목 ("Options are not available for this symbol")
  let cv = 0, pv = 0, co = 0, po = 0, contracts = 0, bad = 0;
  const expiries = new Set<string>();
  for (const r of rows) {
    if (typeof r.expirygroup === "string" && r.expirygroup.trim()) {
      expiries.add(r.expirygroup.trim());
      continue;
    }
    if (r.strike === null || r.strike === undefined) continue;
    const vals = [optNum(r.c_Volume), optNum(r.p_Volume), optNum(r.c_Openinterest), optNum(r.p_Openinterest)];
    if (vals.some((x) => x === null)) {
      bad++;
      continue;
    }
    contracts++;
    cv += vals[0]!;
    pv += vals[1]!;
    co += vals[2]!;
    po += vals[3]!;
  }
  // 숫자 형식이 깨진 행이 많으면(전부 깨진 경우 포함) '옵션 없음'이 아니라 형식 오류로 본다
  if (bad > contracts * 0.05) throw new ProviderError(P, `옵션 체인 숫자 형식 오류 ${bad}행`);
  if (!contracts) return null;
  const m = (json.data?.lastTrade ?? "").toUpperCase().match(/AS OF ([A-Z]{3}) (\d{1,2}), (\d{4})/);
  return { callVolume: cv, putVolume: pv, callOI: co, putOI: po, contracts, expiries: expiries.size, asOf: m && MON[m[1]] ? `${m[3]}-${MON[m[1]]}-${m[2].padStart(2, "0")}` : null, totalRecord: json.data?.totalRecord ?? null };
}

export async function fetchOptionChainTotals(symbol: string, assetClass: "stocks" | "etf"): Promise<OptionChainTotals | null> {
  const url = `${env.nasdaqBase}/api/quote/${encodeURIComponent(symbol)}/option-chain?assetclass=${assetClass}&limit=10000&fromdate=all&todate=undefined&excode=oprac&callput=callput&money=all&type=all`;
  const json = await requestJson<NasdaqOptionResponse>(P, url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
    timeoutMs: 60000,
  });
  const r = parseOptionChain(json);
  // 한 번에 다 받지 못했으면(행 수 < 전체) 일부만 더한 값이 되므로 버린다
  const got = json.data?.table?.rows?.length ?? 0;
  if (r && r.totalRecord !== null && got < r.totalRecord) throw new ProviderError(P, `옵션 체인 일부만 수신 (${got}/${r.totalRecord}행)`);
  return r;
}
