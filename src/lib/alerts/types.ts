/** 브라우저 알림 규칙·기록 (이 브라우저의 IndexedDB 에만 저장, 서버로 보내지 않음) */

export type AlertKind = "dividend_change" | "new_schedule" | "ex_soon" | "expense_change" | "holdings_change" | "target_drift" | "price" | "pnl";

export const ALERT_KIND_KO: Record<AlertKind, string> = {
  dividend_change: "배당·분배금 금액 변경",
  new_schedule: "새 지급 일정 발표",
  ex_soon: "배당락일 임박",
  expense_change: "총보수 변경",
  holdings_change: "상위 편입 종목 변경",
  target_drift: "목표 비중 이탈",
  price: "가격 도달",
  pnl: "내 자산 손익률 도달",
};

/** 종목을 지정하는 규칙 */
export const SYMBOL_KINDS: AlertKind[] = ["dividend_change", "new_schedule", "ex_soon", "expense_change", "holdings_change", "price"];

export interface AlertRule {
  id: string;
  kind: AlertKind;
  symbol?: string;
  /** ex_soon: 며칠 전부터 */
  days?: number;
  /** price·pnl: 이상/이하 */
  op?: "above" | "below";
  /** price: 달러, pnl: % */
  value?: number;
  enabled: boolean;
  createdAt: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  kind: AlertKind;
  /** 같은 알림을 두 번 보내지 않기 위한 키 */
  key: string;
  title: string;
  body: string;
  /** 판단에 쓴 데이터의 기준 (날짜·시각 문자열) */
  dataAsOf: string | null;
  at: number;
  read: boolean;
}

export interface AlertsData {
  version: 1;
  rules: AlertRule[];
  log: AlertEvent[];
  /** 규칙별 마지막으로 본 값 (변경 감지 기준) */
  baseline: Record<string, unknown>;
  /** 브라우저 알림(Notification)도 띄울지 */
  notify: boolean;
  lastCheck: number | null;
}

export const EMPTY_ALERTS: AlertsData = { version: 1, rules: [], log: [], baseline: {}, notify: false, lastCheck: null };
