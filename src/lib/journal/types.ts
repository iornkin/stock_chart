/** 투자 판단 기록장 (이 브라우저에만 저장) — 처음 적은 판단은 고치지 않고, 사후 평가를 따로 쌓는다 */

export type JournalAction = "buy" | "sell" | "hold" | "watch";
export const JOURNAL_ACTION_KO: Record<JournalAction, string> = { buy: "매수", sell: "매도", hold: "보유 유지", watch: "관찰" };

export interface JournalReview {
  id: string;
  date: string;
  /** 당시 근거 중 지금도 유효한 것 */
  stillValid: string;
  /** 실제로 일어난 변화 */
  happened: string;
  /** 예상과 달랐던 점 */
  differed: string;
  /** 당시 놓친 위험 */
  missedRisks: string;
  memo: string;
  /** 평가할 때의 계산 결과 (나중에 비교용) */
  snapshot: { price: number | null; totalReturnPct: number | null } | null;
  createdAt: number;
}

export interface JournalEntry {
  id: string;
  symbol: string;
  action: JournalAction;
  date: string;
  /** 당시 가격 — 비워 두면 그날(또는 직전 거래일) 종가 */
  price: number | null;
  priceSource: "user" | "close";
  reason: string;
  horizon: string;
  expectation: string;
  /** 감수할 수 있는 손실 (%) */
  maxLossPct: number | null;
  invalidation: string;
  reviewDate: string | null;
  refs: string;
  memo: string;
  createdAt: number;
  reviews: JournalReview[];
}
