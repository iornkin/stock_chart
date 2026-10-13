/** 공통 데이터 타입 (서버·클라이언트 공용, 서버 전용 import 금지) */

export interface Quote {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  avgVolume3m: number | null;
  avgVolume10d: number | null;
  marketCap: number | null;
  fiftyTwoHigh: number | null;
  fiftyTwoLow: number | null;
  prePrice: number | null;
  preChangePct: number | null;
  postPrice: number | null;
  postChangePct: number | null;
  /** 제공처가 알려준 시장 상태 (PRE, REGULAR, POST, CLOSED ...) */
  marketState: string | null;
  exchange: string | null;
  currency: string | null;
  quoteType: string | null;
  /** 제공처 기준 마지막 거래 시각 (epoch ms) */
  marketTime: number | null;
  /** 제공처가 밝힌 지연 시간(분). 0 이면 제공처 기준 실시간 */
  delayMinutes: number | null;
  source: string;
  sourceDetail: string | null;
  /** 이 사이트가 제공처에서 데이터를 받아 온 시각 */
  fetchedAt: number;
  extra: QuoteExtra;
}

export interface QuoteExtra {
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  epsTTM?: number | null;
  epsForward?: number | null;
  dividendYield?: number | null;
  trailingAnnualDividendRate?: number | null;
  trailingAnnualDividendYield?: number | null;
  sharesOutstanding?: number | null;
  bookValue?: number | null;
  earningsTimestamp?: number | null;
  firstTradeDate?: number | null;
}

export type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";

export interface Bar {
  /** 봉 시작 시각 (epoch seconds, UTC) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** 배당·분할 조정 종가 (일봉 이상에서 제공될 때) */
  ac?: number | null;
}

export interface DataMeta {
  source: string | null;
  fetchedAt: number | null;
  /** 최신 데이터 조회에 실패해 보관된 과거 데이터를 보여 주는 경우 true */
  stale: boolean;
  error: string | null;
}

export type DividendKind = "regular" | "special" | "capital_gain" | "unknown";

export interface Dividend {
  symbol: string;
  exDate: string;
  amount: number;
  amountRaw: number | null;
  splitAdjusted: boolean;
  payDate: string | null;
  recordDate: string | null;
  declaredDate: string | null;
  kind: DividendKind;
  frequencyReported: number | null;
  sources: string[];
}

export interface Split {
  symbol: string;
  date: string;
  numerator: number;
  denominator: number;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  publisher: string | null;
  publishedAt: number;
  provider: string;
  fetchedAt: number;
  related: string[];
  /** 제공처가 준 기사 대표 이미지 주소 (없으면 null) */
  image?: string | null;
  aiTitleKo?: string | null;
  aiSummaryKo?: string | null;
  /** news_symbols 에서 온 연관 이유 */
  reason?: string | null;
  matchType?: string | null;
  /** 중복 기사 통합 시 함께 묶인 기사 */
  duplicates?: { title: string; url: string; publisher: string | null; publishedAt: number }[];
}

export interface MarketEvent {
  id: string;
  symbol: string | null;
  kind: "earnings" | "ex_dividend" | "dividend_pay" | "economic" | "holiday" | "early_close";
  date: string;
  timeHint: string | null;
  title: string;
  data: Record<string, unknown> | null;
  source: string;
  fetchedAt: number;
}
