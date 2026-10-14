/**
 * 목표 비중 리밸런싱 계산 (순수 함수)
 *
 * - 현재 비중 = 종목 평가금액 ÷ (평가금액 합 + 현금). 현금 목표 = 100% − 종목 목표 합.
 * - 전체 리밸런싱(매도 포함): 지금 총액 그대로 목표 비중에 맞추기 위한 종목별 매수·매도 금액.
 * - 신규 투자금만 사용(매도 없음): 넣을 돈을 목표보다 모자란 종목에 모자란 금액 비율대로 나눠 산다.
 *   모자란 금액 합보다 돈이 많으면 남는 돈은 목표 비중대로 나눠 산다.
 * - 거래 비용 = 거래 금액 × 사용자가 넣은 수수료율 (환전 비용·세금 제외).
 */

export interface RebalPosition {
  symbol: string;
  shares: number;
  price: number | null;
}

export interface TargetWeight {
  symbol: string;
  /** % */
  weight: number;
}

export interface RebalRow {
  symbol: string;
  price: number;
  value: number;
  currentPct: number;
  targetPct: number;
  /** 현재 − 목표 (%p) */
  diffPct: number;
  /** + 매수 / − 매도 금액 */
  trade: number;
  shares: number;
  afterValue: number;
  afterPct: number;
}

export interface RebalPlan {
  rows: RebalRow[];
  total: number;
  cashBefore: number;
  cashAfter: number;
  cashTargetPct: number;
  buy: number;
  sell: number;
  fee: number;
  /** 거래 뒤 목표와 가장 크게 벗어난 정도 (%p) */
  maxDriftAfter: number;
}

export type RebalResult = { ok: true; plan: RebalPlan } | { ok: false; error: string };

function validate(positions: RebalPosition[], targets: TargetWeight[]): string | null {
  const sum = targets.reduce((a, t) => a + t.weight, 0);
  if (targets.some((t) => !(t.weight >= 0))) return "목표 비중은 0% 이상으로 넣으세요.";
  if (sum > 100 + 1e-9) return `목표 비중 합계가 ${round2(sum)}%입니다. 100% 이하로 맞추세요 (남는 비중은 현금).`;
  const priceless = [...new Set([...positions.filter((p) => p.shares > 0).map((p) => p.symbol), ...targets.filter((t) => t.weight > 0).map((t) => t.symbol)])].filter(
    (s) => !(positions.find((p) => p.symbol === s)?.price ?? 0),
  );
  if (priceless.length) return `${priceless.join(", ")} 현재가가 없어 계산할 수 없습니다.`;
  return null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function universe(positions: RebalPosition[], targets: TargetWeight[]) {
  const syms = [...new Set([...positions.filter((p) => p.shares > 0).map((p) => p.symbol), ...targets.map((t) => t.symbol)])];
  return syms.map((s) => {
    const p = positions.find((x) => x.symbol === s);
    const price = p?.price as number;
    const held = p?.shares ?? 0;
    return { symbol: s, price, held, value: held * price, target: targets.find((t) => t.symbol === s)?.weight ?? 0 };
  });
}

function finish(u: ReturnType<typeof universe>, trades: number[], cash: number, total: number, feePct: number, wholeShares: boolean): RebalPlan {
  const rows: RebalRow[] = u.map((x, i) => {
    let shares = trades[i] / x.price;
    // 정수 주: 사는 쪽은 내림, 파는 쪽은 올림(보유 수량까지) — 현금이 모자라지 않게
    if (wholeShares) shares = trades[i] >= 0 ? Math.floor(shares + 1e-9) : -Math.min(x.held, Math.ceil(-shares - 1e-9));
    const trade = wholeShares ? shares * x.price : trades[i];
    return { symbol: x.symbol, price: x.price, value: x.value, currentPct: 0, targetPct: x.target, diffPct: 0, trade, shares, afterValue: x.value + trade, afterPct: 0 };
  });
  const buy = rows.filter((r) => r.trade > 0).reduce((a, r) => a + r.trade, 0);
  const sell = rows.filter((r) => r.trade < 0).reduce((a, r) => a - r.trade, 0);
  const fee = ((buy + sell) * feePct) / 100;
  const cashAfter = cash - buy + sell - fee;
  const totalAfter = rows.reduce((a, r) => a + r.afterValue, 0) + cashAfter;
  for (const r of rows) {
    r.currentPct = total > 0 ? (r.value / total) * 100 : 0;
    r.diffPct = r.currentPct - r.targetPct;
    r.afterPct = totalAfter > 0 ? (r.afterValue / totalAfter) * 100 : 0;
  }
  const cashTargetPct = Math.max(0, 100 - u.reduce((a, x) => a + x.target, 0));
  const cashAfterPct = totalAfter > 0 ? (cashAfter / totalAfter) * 100 : 0;
  const maxDriftAfter = Math.max(Math.abs(cashAfterPct - cashTargetPct), ...rows.map((r) => Math.abs(r.afterPct - r.targetPct)));
  return { rows, total, cashBefore: cash, cashAfter, cashTargetPct, buy, sell, fee, maxDriftAfter };
}

/** 매도까지 포함해 지금 총액 그대로 목표 비중에 맞춘다 */
export function fullRebalance(positions: RebalPosition[], cash: number, targets: TargetWeight[], feePct = 0, wholeShares = false): RebalResult {
  const err = validate(positions, targets);
  if (err) return { ok: false, error: err };
  const u = universe(positions, targets);
  const total = u.reduce((a, x) => a + x.value, 0) + cash;
  if (!(total > 0)) return { ok: false, error: "평가금액과 현금이 모두 0입니다." };
  // 수수료도 현금에서 나가므로, 수수료를 뺀 금액을 목표 비중대로 나눈다 (수수료가 작아 몇 번 반복하면 수렴)
  let fee = 0;
  let trades = u.map((x) => (x.target / 100) * total - x.value);
  for (let k = 0; k < 8 && feePct > 0; k++) {
    fee = (trades.reduce((a, t) => a + Math.abs(t), 0) * feePct) / 100;
    trades = u.map((x) => (x.target / 100) * (total - fee) - x.value);
  }
  return { ok: true, plan: finish(u, trades, cash, total, feePct, wholeShares) };
}

/**
 * 매도 없이 새로 넣는 돈(추가 투자금·현금·분배금)만으로 비중을 맞춘다.
 * amount 는 이번에 쓸 돈. 보유 현금에서 쓰는 경우 cashIncluded=true (총액이 늘지 않음).
 */
export function newMoneyRebalance(positions: RebalPosition[], cash: number, targets: TargetWeight[], amount: number, opts: { feePct?: number; wholeShares?: boolean; fromCash?: boolean } = {}): RebalResult {
  const err = validate(positions, targets);
  if (err) return { ok: false, error: err };
  if (!(amount > 0)) return { ok: false, error: "넣을 금액을 0보다 크게 입력하세요." };
  const feePct = opts.feePct ?? 0;
  if (opts.fromCash && amount > cash + 1e-9) return { ok: false, error: `보유 현금(${round2(cash)}달러)보다 많이 쓸 수 없습니다.` };
  const u = universe(positions, targets);
  const cashAfterDeposit = opts.fromCash ? cash : cash + amount;
  const total = u.reduce((a, x) => a + x.value, 0) + cashAfterDeposit;
  // 수수료를 뺀 실제로 살 수 있는 금액
  const spendable = amount / (1 + feePct / 100);
  const deficits = u.map((x) => Math.max(0, (x.target / 100) * total - x.value));
  const need = deficits.reduce((a, d) => a + d, 0);
  let trades: number[];
  if (need <= 1e-9) {
    const tsum = u.reduce((a, x) => a + x.target, 0);
    trades = u.map((x) => (tsum > 0 ? (spendable * x.target) / tsum : 0));
  } else if (spendable <= need) {
    trades = deficits.map((d) => (spendable * d) / need);
  } else {
    const rest = spendable - need;
    const tsum = u.reduce((a, x) => a + x.target, 0);
    trades = deficits.map((d, i) => d + (tsum > 0 ? (rest * u[i].target) / tsum : 0));
  }
  return { ok: true, plan: finish(u, trades, cashAfterDeposit, total, feePct, opts.wholeShares ?? false) };
}

/** 목표에서 threshold(%p) 넘게 벗어난 종목 (현금 포함) */
export function driftAlerts(positions: RebalPosition[], cash: number, targets: TargetWeight[], thresholdPct: number): { symbol: string; currentPct: number; targetPct: number; diffPct: number }[] {
  if (validate(positions, targets)) return [];
  const u = universe(positions, targets);
  const total = u.reduce((a, x) => a + x.value, 0) + cash;
  if (!(total > 0)) return [];
  const rows = u.map((x) => ({ symbol: x.symbol, currentPct: (x.value / total) * 100, targetPct: x.target }));
  const cashTarget = Math.max(0, 100 - u.reduce((a, x) => a + x.target, 0));
  rows.push({ symbol: "현금", currentPct: (cash / total) * 100, targetPct: cashTarget });
  return rows.map((r) => ({ ...r, diffPct: r.currentPct - r.targetPct })).filter((r) => Math.abs(r.diffPct) > thresholdPct);
}
