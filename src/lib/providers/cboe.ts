/**
 * Cboe 일일 옵션 시장 통계 (무료 공개 파일, cdn.cboe.com)
 * - Cboe 가 운영하는 미국 옵션 거래소들의 상품군별 풋·콜 거래량과 미결제약정, 공표 풋/콜 비율(거래량 기준).
 * - 미국 옵션 시장 '전체'(OCC 집계)가 아니라 Cboe 거래소 기준이다. 개별 종목 값이 아니다.
 * - 이용 조건은 Cboe 웹사이트 약관을 따른다.
 */
import { env } from "../env";
import { BROWSER_UA, ProviderError, requestText } from "../http";

const P = "cboe";

export type CboeProduct = "total" | "equity" | "index" | "etp" | "vix" | "spx";

export const CBOE_PRODUCT_LABELS: Record<CboeProduct, string> = {
  total: "전체 (모든 상품)",
  equity: "주식 옵션",
  index: "지수 옵션",
  etp: "ETF 등 상장 상품 옵션",
  vix: "VIX 옵션",
  spx: "S&P 500 지수 옵션 (SPX·SPXW)",
};

const SECTION: Record<string, CboeProduct> = {
  "SUM OF ALL PRODUCTS": "total",
  "EQUITY OPTIONS": "equity",
  "INDEX OPTIONS": "index",
  "EXCHANGE TRADED PRODUCTS": "etp",
  "CBOE VOLATILITY INDEX (VIX)": "vix",
  "SPX + SPXW": "spx",
};
const RATIO: Record<string, CboeProduct> = {
  "TOTAL PUT/CALL RATIO": "total",
  "EQUITY PUT/CALL RATIO": "equity",
  "INDEX PUT/CALL RATIO": "index",
  "EXCHANGE TRADED PRODUCTS PUT/CALL RATIO": "etp",
  "CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO": "vix",
  "SPX + SPXW PUT/CALL RATIO": "spx",
};

export interface CboeProductStats {
  product: CboeProduct;
  callVolume: number | null;
  putVolume: number | null;
  callOI: number | null;
  putOI: number | null;
  /** Cboe 가 공표한 풋/콜 비율 (거래량 기준, 소수 둘째 자리) */
  publishedRatio: number | null;
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
};

export function parseCboeDaily(json: unknown): CboeProductStats[] {
  if (!json || typeof json !== "object") throw new ProviderError(P, "옵션 통계 형식이 예상과 다릅니다");
  const j = json as Record<string, unknown>;
  const ratios = new Map<CboeProduct, number | null>();
  if (Array.isArray(j.ratios)) for (const r of j.ratios as { name?: string; value?: unknown }[]) if (r.name && RATIO[r.name]) ratios.set(RATIO[r.name], n(r.value));
  const out: CboeProductStats[] = [];
  for (const [key, product] of Object.entries(SECTION)) {
    const rows = j[key];
    if (!Array.isArray(rows)) continue;
    const vol = (rows as { name?: string; call?: unknown; put?: unknown }[]).find((r) => r.name === "VOLUME");
    const oi = (rows as { name?: string; call?: unknown; put?: unknown }[]).find((r) => r.name === "OPEN INTEREST");
    out.push({ product, callVolume: n(vol?.call), putVolume: n(vol?.put), callOI: n(oi?.call), putOI: n(oi?.put), publishedRatio: ratios.get(product) ?? null });
  }
  if (!out.length) throw new ProviderError(P, "옵션 통계에 상품별 표가 없습니다");
  return out;
}

/** 해당일 통계. 휴장일·미게시이면 null (Cboe 는 이때 403 을 준다) */
export async function fetchCboeDaily(date: string): Promise<CboeProductStats[] | null> {
  try {
    const text = await requestText(P, `${env.cboeCdnBase}/data/us/options/market_statistics/daily/${date}_daily_options`, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" }, retries: 1, timeoutMs: 30000 });
    return parseCboeDaily(JSON.parse(text));
  } catch (e) {
    if (e instanceof ProviderError && (e.status === 403 || e.status === 404)) return null;
    if (e instanceof SyntaxError) throw new ProviderError(P, "옵션 통계 JSON 파싱 실패");
    throw e;
  }
}
