/**
 * 분배금 세후 계산 (순수 함수) — 세율은 사용자가 고르거나 넣은 '가정'이며 확정 세액이 아니다
 *
 * - 미국 상장 종목의 배당은 지급 때 미국에서 원천징수된다. 한·미 조세조약 제한세율은 15%,
 *   조약을 적용받지 못하면 미국 법정 세율 30%.
 * - 분배금 성격(자본 반환·일부 이자 관련 분배 등)에 따라 실제 원천징수가 다를 수 있고,
 *   한국에서 금융소득(이자·배당)이 연 2,000만 원을 넘으면 종합과세로 세금이 더 나올 수 있다.
 */

export interface TaxPreset {
  id: "none" | "us15" | "us30" | "custom";
  label: string;
  /** % (직접 입력은 null) */
  rate: number | null;
  basis: string;
}

export const DIV_TAX_PRESETS: TaxPreset[] = [
  { id: "none", label: "세전", rate: 0, basis: "세금을 빼기 전 금액 (비교용)" },
  { id: "us15", label: "15%", rate: 15, basis: "한·미 조세조약의 배당 제한세율 — 증권사에 거주자 확인(W-8BEN 등)이 된 경우 보통 적용" },
  { id: "us30", label: "30%", rate: 30, basis: "조세조약을 적용받지 못한 비거주 외국인에 대한 미국 법정 원천징수 세율" },
  { id: "custom", label: "직접 입력", rate: null, basis: "금융소득종합과세 등 개인 상황에 맞는 실효세율을 넣으세요" },
];

export interface TaxSplit {
  gross: number;
  tax: number;
  net: number;
}

export function afterTax(gross: number, ratePct: number): TaxSplit {
  const r = Math.min(100, Math.max(0, ratePct));
  const tax = (gross * r) / 100;
  return { gross, tax, net: gross - tax };
}

export interface TaxScenarioRow {
  label: string;
  rate: number;
  annual: TaxSplit;
  monthly: TaxSplit;
}

/** 같은 세전 연 분배금을 여러 세율 가정으로 나란히 (월은 연 ÷ 12 평균) */
export function compareTaxScenarios(annualGross: number, scenarios: { label: string; rate: number }[]): TaxScenarioRow[] {
  return scenarios.map((s) => {
    const a = afterTax(annualGross, s.rate);
    return { label: s.label, rate: s.rate, annual: a, monthly: { gross: a.gross / 12, tax: a.tax / 12, net: a.net / 12 } };
  });
}

export interface ReinvestYear {
  year: number;
  /** 세후 분배금을 다시 산 경우의 평가액 */
  valueNetReinvest: number;
  /** 세전 분배금을 다시 산 경우 (세금이 없다면 — 비교용) */
  valueGrossReinvest: number;
  /** 재투자하지 않은 경우의 평가액 (받은 현금 제외) */
  valueNoReinvest: number;
  /** 재투자하지 않고 받은 세후 현금 누적 */
  cashNoReinvest: number;
  /** 그해 받은 세후 분배금 (세후 재투자 기준) */
  incomeNet: number;
}

/**
 * 분배금 재투자 가정 (분배금 수익률·가격 변화율이 일정하다고 가정)
 * 한 지급마다: 분배금 = 평가액 × 수익률 ÷ 연 지급 횟수, 세후 금액을 그 자리에서 다시 산다.
 */
export function reinvestScenario(input: { startValue: number; yieldPct: number; taxPct: number; priceChangePct: number; years: number; perYear: number }): ReinvestYear[] {
  const { startValue, yieldPct, taxPct, priceChangePct, years } = input;
  const n = Math.max(1, Math.round(input.perYear));
  const y = yieldPct / 100 / n;
  const t = Math.min(100, Math.max(0, taxPct)) / 100;
  const g = Math.pow(1 + priceChangePct / 100, 1 / n);
  let vNet = startValue;
  let vGross = startValue;
  let vNo = startValue;
  let cash = 0;
  const out: ReinvestYear[] = [];
  for (let year = 1; year <= Math.max(0, Math.floor(years)); year++) {
    let incomeNet = 0;
    for (let k = 0; k < n; k++) {
      // 지급 직전 가격 변화 반영 후 분배
      vNet *= g;
      vGross *= g;
      vNo *= g;
      const dNet = vNet * y * (1 - t);
      incomeNet += dNet;
      vNet += dNet;
      vGross += vGross * y;
      cash += vNo * y * (1 - t);
    }
    out.push({ year, valueNetReinvest: vNet, valueGrossReinvest: vGross, valueNoReinvest: vNo, cashNoReinvest: cash, incomeNet });
  }
  return out;
}
