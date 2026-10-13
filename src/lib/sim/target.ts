/**
 * 목표 배당 역산 (순수 함수)
 * "매달 X원(또는 달러)을 받으려면 얼마를 투자해야 하나" — 최근 12개월 실제 지급 기준.
 * - 평균 기준: 연간 목표 ÷ (가중 분배금 수익률 × 세후 비율)
 * - 가장 적은 달 기준: 지급 월이 몰린 종목(분기 지급 등)이 있으면 어떤 달은 적게 들어온다 → 모든 달에 목표 이상 받으려면 필요한 금액
 */
export interface TargetHolding {
  symbol: string;
  weight: number;
  /** 최근 12개월 실제 분배금 수익률(%) */
  yieldPct: number | null;
  /** 최근 지급액 연환산 수익률(%) — 참고 */
  annualizedYieldPct: number | null;
  /** 1~12월 지급 비중 (합계 1) */
  monthWeights: number[];
  price: number | null;
}

export interface TargetResult {
  /** 가중 분배금 수익률 (세전, %) */
  yieldPct: number;
  netFactor: number;
  /** 평균 기준 필요 투자금 (USD) */
  requiredAvg: number;
  /** 모든 달에 목표 이상을 받기 위한 투자금 (지급이 없는 달이 있으면 null) */
  requiredEveryMonth: number | null;
  weakestMonth: number | null;
  /** 지급이 없는 달 (1~12) */
  zeroMonths: number[];
  /** 평균 기준 금액을 넣었을 때 월별 세후 분배금 */
  monthly: number[];
  annualGross: number;
  perHolding: { symbol: string; amount: number; shares: number | null; annualGross: number; months: number[] }[];
  /** 최근 지급액 연환산 기준 필요 투자금 (참고) */
  requiredAnnualized: number | null;
  missing: string[];
}

export function solveTarget(holdings: TargetHolding[], targetMonthlyUsd: number, taxPct: number, afterTax: boolean): TargetResult | { error: string } {
  if (!(targetMonthlyUsd > 0)) return { error: "목표 금액을 입력하세요." };
  const sum = holdings.reduce((a, h) => a + h.weight, 0);
  if (!holdings.length || Math.abs(sum - 100) > 0.01) return { error: `비중 합계가 ${Math.round(sum * 100) / 100}%입니다. 100%로 맞추세요.` };
  const missing = holdings.filter((h) => h.yieldPct === null).map((h) => h.symbol);
  const netFactor = afterTax ? 1 - taxPct / 100 : 1;
  const w = holdings.map((h) => h.weight / 100);
  const y = holdings.map((h) => (h.yieldPct ?? 0) / 100);
  const yieldPct = holdings.reduce((a, h, i) => a + w[i] * y[i], 0) * 100;
  if (yieldPct <= 0) return { error: "최근 12개월 실제 지급 기록이 있는 종목이 없어 계산할 수 없습니다." };
  const mw = holdings.map((h) => (h.monthWeights.some((x) => x > 0) ? h.monthWeights : Array(12).fill(0)));
  // 투자금 1달러당 월별 세후 분배금
  const perDollar = Array.from({ length: 12 }, (_, m) => holdings.reduce((a, _h, i) => a + w[i] * y[i] * mw[i][m], 0) * netFactor);
  const annualTarget = targetMonthlyUsd * 12;
  const requiredAvg = annualTarget / ((yieldPct / 100) * netFactor);
  const zeroMonths = perDollar.map((v, m) => (v <= 1e-12 ? m + 1 : 0)).filter(Boolean);
  const minRate = Math.min(...perDollar);
  const weakest = perDollar.indexOf(minRate) + 1;
  const annY = holdings.reduce((a, h, i) => a + w[i] * ((h.annualizedYieldPct ?? h.yieldPct ?? 0) / 100), 0);
  return {
    yieldPct,
    netFactor,
    requiredAvg,
    requiredEveryMonth: zeroMonths.length ? null : targetMonthlyUsd / minRate,
    weakestMonth: zeroMonths.length ? null : weakest,
    zeroMonths,
    monthly: perDollar.map((v) => v * requiredAvg),
    annualGross: requiredAvg * (yieldPct / 100),
    perHolding: holdings.map((h, i) => ({
      symbol: h.symbol,
      amount: requiredAvg * w[i],
      shares: h.price ? (requiredAvg * w[i]) / h.price : null,
      annualGross: requiredAvg * w[i] * y[i],
      months: mw[i].map((x, m) => (x > 0 ? m + 1 : 0)).filter(Boolean),
    })),
    requiredAnnualized: annY > 0 ? annualTarget / (annY * netFactor) : null,
    missing,
  };
}
