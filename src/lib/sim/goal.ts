/**
 * 목표 달성 계획 (순수 함수) — "지금 자산 + 매달 투자로 N년 뒤 월 X 분배금을 받으려면?"
 * 모든 수익률·분배금은 사용자가 넣은 가정이며 보장값이 아니다.
 * - 매달: 납입(월초) → 가격 변화 (1+가격 수익률)^(1/12) → 분배금 = 평가액 × 분배금 수익률 ÷ 12 → 세후 금액 재투자(또는 현금)
 * - 가격 수익률 = 총수익률 − 분배금 수익률 (분배금이 높다고 총수익이 높아지지 않게)
 * - 목표 달성: 투자 평가액 × 분배금 수익률 × (1 − 세율) ÷ 12 ≥ 목표 월 분배금
 */
export interface GoalInput {
  currentUsd: number;
  monthlyUsd: number;
  years: number;
  /** 목표 월 분배금 (USD, afterTax 이면 세후) */
  targetMonthlyUsd: number;
  afterTax: boolean;
  yieldPct: number;
  totalReturnPct: number;
  taxPct: number;
  reinvest: boolean;
  /** 시작 직후 한 번 가격이 이만큼 떨어진다고 가정 (%) */
  shockPct?: number;
}

export interface GoalResult {
  /** 목표에 필요한 투자 평가액 */
  requiredAssets: number;
  projectedAssets: number;
  /** N년 뒤 월 분배금 (목표와 같은 기준) */
  projectedMonthlyIncome: number;
  /** N년 뒤 재투자하지 않고 쌓인 현금 */
  cash: number;
  gap: number;
  /** 지금 조건으로 목표에 닿는 개월 수 (50년 안에 못 닿으면 null) */
  monthsToGoal: number | null;
  /** N년 안에 닿으려면 필요한 월 투자금 (불가능하면 null) */
  requiredMonthly: number | null;
  totalContributed: number;
  yearly: { year: number; assets: number; monthlyIncome: number; contributed: number }[];
}

const MAX_MONTHS = 600;

function simulate(i: GoalInput, monthly: number, months: number) {
  const y = i.yieldPct / 100;
  const t = i.afterTax ? i.taxPct / 100 : 0;
  const tax = i.taxPct / 100;
  const g = Math.pow(1 + (i.totalReturnPct - i.yieldPct) / 100, 1 / 12);
  let v = i.currentUsd * (1 - (i.shockPct ?? 0) / 100);
  let cash = 0;
  let contributed = i.currentUsd;
  const income = () => (v * y * (1 - t)) / 12;
  const yearly: GoalResult["yearly"] = [];
  let reached: number | null = income() >= i.targetMonthlyUsd && i.targetMonthlyUsd > 0 ? 0 : null;
  for (let m = 1; m <= months; m++) {
    v += monthly;
    contributed += monthly;
    v *= g;
    const net = ((v * y) / 12) * (1 - tax);
    if (i.reinvest) v += net;
    else cash += net;
    if (reached === null && income() >= i.targetMonthlyUsd) reached = m;
    if (m % 12 === 0) yearly.push({ year: m / 12, assets: v + cash, monthlyIncome: income(), contributed });
  }
  return { v, cash, contributed, income: income(), reached, yearly };
}

export function goalPlan(i: GoalInput): GoalResult | { error: string } {
  if (!(i.targetMonthlyUsd > 0)) return { error: "목표 월 분배금을 넣으세요." };
  if (!(i.yieldPct > 0) || i.yieldPct > 30) return { error: "분배금 수익률 가정은 0보다 크고 30% 이하로 넣으세요." };
  if (!(i.years > 0) || i.years > 50) return { error: "기간은 1~50년 사이로 넣으세요." };
  if (!(i.currentUsd >= 0) || !(i.monthlyUsd >= 0)) return { error: "현재 자산과 월 투자금은 0 이상이어야 합니다." };
  if (!(i.totalReturnPct > -50 && i.totalReturnPct < 50)) return { error: "총수익률 가정을 확인하세요." };
  const months = Math.round(i.years * 12);
  const requiredAssets = (i.targetMonthlyUsd * 12) / ((i.yieldPct / 100) * (1 - (i.afterTax ? i.taxPct / 100 : 0)));
  const base = simulate(i, i.monthlyUsd, months);
  const long = base.reached === null ? simulate(i, i.monthlyUsd, MAX_MONTHS) : base;
  // N년 안에 닿는 최소 월 투자금 (이분 탐색)
  let requiredMonthly: number | null = null;
  if (simulate(i, 0, months).reached !== null) requiredMonthly = 0;
  else {
    let lo = 0;
    let hi = Math.max(1000, requiredAssets);
    if (simulate(i, hi, months).reached === null) hi = requiredAssets * 2;
    if (simulate(i, hi, months).reached !== null) {
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (simulate(i, mid, months).reached !== null) hi = mid;
        else lo = mid;
      }
      requiredMonthly = hi;
    }
  }
  return {
    requiredAssets,
    projectedAssets: base.v + base.cash,
    projectedMonthlyIncome: base.income,
    cash: base.cash,
    gap: requiredAssets - base.v,
    monthsToGoal: long.reached,
    requiredMonthly,
    totalContributed: base.contributed,
    yearly: base.yearly,
  };
}
