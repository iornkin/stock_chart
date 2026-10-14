/**
 * 브라우저에 저장하는 개인 데이터의 형식 (서버로 보내지 않음)
 * 모든 금액은 USD. 환율(fx)은 1달러당 원화이며, 거래 당시 환율을 따로 기록한다.
 */

export type TxnType = "opening" | "buy" | "sell" | "deposit" | "withdraw" | "dividend" | "reinvest";

export const TXN_KO: Record<TxnType, string> = {
  opening: "기초 보유",
  buy: "매수",
  sell: "매도",
  deposit: "입금",
  withdraw: "출금",
  dividend: "분배금 수령",
  reinvest: "분배금 재투자",
};

export interface Txn {
  id: string;
  type: TxnType;
  /** 거래일 YYYY-MM-DD */
  date: string;
  symbol?: string;
  /** 수량 (opening/buy/sell/reinvest) */
  shares?: number;
  /** 주당 가격 (opening = 평균 매수 단가) */
  price?: number;
  /** 수수료 (buy/sell) */
  fee?: number;
  /** 금액 (deposit/withdraw = 입출금액, dividend/reinvest = 세전 분배금) */
  amount?: number;
  /** 원천징수 세금 (dividend/reinvest) */
  tax?: number;
  /** 거래 당시 환율 (원/달러) — 선택 */
  fx?: number | null;
  memo?: string;
  createdAt: number;
}

export interface SimpleHolding {
  id: string;
  symbol: string;
  shares: number;
  avgCost: number;
  /** 최초 매수일 (선택) */
  firstDate?: string;
  /** 평균 매수 환율 (선택) */
  avgFx?: number | null;
  memo?: string;
}

export interface PortfolioData {
  version: 1;
  mode: "simple" | "ledger";
  simple: { holdings: SimpleHolding[]; cash: number; cashFx?: number | null };
  ledger: Txn[];
  /** 간편 입력 → 거래 내역 전환 기록 */
  convertedAt?: number | null;
  /** 간편 입력 모드의 하루 한 번 평가금액 기록 (이 사이트를 연 날만) */
  snapshots?: { date: string; totalAssets: number; cost: number }[];
  /** 목표 비중 (리밸런싱 도우미) — 합이 100% 보다 작으면 나머지는 현금 목표 */
  targets?: PortfolioTargets;
  updatedAt: number;
}

export interface PortfolioTargets {
  items: { symbol: string; weight: number }[];
  /** 목표에서 이만큼(%p) 넘게 벗어나면 알림 */
  driftPct: number;
  /** 사용자가 넣은 거래 수수료율 가정 (%) */
  feePct: number;
  updatedAt: number;
}

export const EMPTY_PORTFOLIO: PortfolioData = {
  version: 1,
  mode: "simple",
  simple: { holdings: [], cash: 0 },
  ledger: [],
  convertedAt: null,
  updatedAt: 0,
};

export interface StrategyItem {
  symbol: string;
  weight: number;
}

export interface Strategy {
  id: string;
  name: string;
  items: StrategyItem[];
  memo?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedRun {
  id: string;
  kind: "backtest" | "future" | "montecarlo" | "dividend_stress" | "market_stress";
  title: string;
  at: number;
  /** 화면에 보여 줄 핵심 수치 (라벨 → 값 문자열) */
  summary: { label: string; value: string }[];
  /** 다시 실행할 때 쓰는 설정 */
  config?: unknown;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
