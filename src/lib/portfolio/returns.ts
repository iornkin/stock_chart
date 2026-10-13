/**
 * 내 자산 수익률 — 달러 기준과 원화 기준(환율 반영)을 같은 방식으로 계산 (순수 함수)
 *
 * 종목별
 * - 평가손익 = 평가금액 − 보유분 매수 원가, 수익률 = 평가손익 ÷ 보유분 매수 원가
 * - 총손익 = 평가손익 + 실현손익 + 받은 분배금(세후), 총수익률 = 총손익 ÷ 총 매수 금액(기초 보유·매수, 재투자 제외)
 * 계좌 전체
 * - 거래 내역: 총손익 = 총자산 − 순납입 원금 (= 평가손익 + 실현손익 + 세후 분배금), 총수익률 = 총손익 ÷ 순납입 원금
 * - 간편 입력: 총손익 = 평가손익 + 분배금 추정(최초 매수일을 넣은 종목만), 총수익률 = 총손익 ÷ 매수 원가
 *   (간편 입력의 현금 잔액에는 이미 받은 분배금이 들어 있을 수 있어 분배금 추정은 총자산에 더하지 않는다)
 * 원화 기준
 * - 매수·매도·분배금·입출금은 그때 환율(입력값, 없으면 그날 원/달러 종가로 근사), 지금 평가금액은 현재 환율
 * - 환율 효과 = 원화 총손익 − 달러 총손익 × 현재 환율 (환율이 오르면 +, 내리면 −)
 */
import { computeLedger, computeSimple } from "./ledger";
import type { PortfolioData } from "./types";
import type { SeriesDiv } from "@/lib/sim/series";

export interface ReturnFigures {
  /** 평가금액 */
  value: number | null;
  /** 보유분 매수 원가 */
  cost: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  realized: number | null;
  /** 받은 분배금 (세후) */
  dividends: number | null;
  totalGain: number | null;
  /** 총수익률의 분모 */
  invested: number | null;
  totalReturnPct: number | null;
  /** 원화 기준만: 환율 효과 */
  fxEffect?: number | null;
}

export interface HoldingReturn {
  symbol: string;
  shares: number;
  avgCost: number;
  price: number | null;
  usd: ReturnFigures;
  krw: ReturnFigures | null;
}

export interface AccountReturn extends ReturnFigures {
  totalAssets: number | null;
}

export interface PortfolioReturns {
  mode: "simple" | "ledger";
  holdings: HoldingReturn[];
  usd: AccountReturn;
  /** 원화 기준 — 현재 환율이 없거나 매수 환율을 알 수 없는 종목이 있으면 null */
  krw: AccountReturn | null;
  fxNow: number | null;
  /** 거래 당시 환율 대신 그날 원/달러 종가로 근사한 건수 */
  fxEstimated: number;
  /** 원화 기준을 계산하지 못한 이유 */
  krwUnavailable: string[];
  /** 간편 입력: 분배금을 추정했는지 (최초 매수일 이후 실제 지급 기록 × 지금 수량) */
  dividendsEstimated: boolean;
  missingPrices: string[];
}

export interface ReturnsInput {
  data: PortfolioData;
  prices: Record<string, number | null | undefined>;
  today: string;
  fxNow: number | null;
  fxOn: (date: string) => number | null;
  /** 간편 입력의 분배금 추정용 실제 지급 기록 (없으면 추정하지 않음) */
  divsOf?: (symbol: string) => SeriesDiv[] | null;
  /** 분배금 추정에 쓰는 원천징수 세율 (%) */
  divTaxPct?: number;
}

const pctOf = (gain: number | null, base: number | null) => (gain !== null && base !== null && base > 0 ? (gain / base) * 100 : null);
const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce((a: number, b) => a + (b as number), 0));

function figures(o: { value: number | null; cost: number | null; realized: number | null; dividends: number | null; invested: number | null }): ReturnFigures {
  const unrealized = o.value !== null && o.cost !== null ? o.value - o.cost : null;
  const totalGain = unrealized !== null ? unrealized + (o.realized ?? 0) + (o.dividends ?? 0) : null;
  return { ...o, unrealized, unrealizedPct: pctOf(unrealized, o.cost), totalGain, totalReturnPct: pctOf(totalGain, o.invested) };
}

export function portfolioReturns(input: ReturnsInput): PortfolioReturns {
  const { data, prices, today, fxNow, fxOn } = input;
  const krwUnavailable: string[] = [];
  if (!fxNow) krwUnavailable.push("현재 원/달러 환율이 없습니다.");
  const toKrw = (v: number | null) => (v !== null && fxNow ? v * fxNow : null);
  const withFx = (usd: ReturnFigures, krw: ReturnFigures): ReturnFigures => ({ ...krw, fxEffect: krw.totalGain !== null && usd.totalGain !== null && fxNow ? krw.totalGain - usd.totalGain * fxNow : null });

  if (data.mode === "ledger") {
    const l = computeLedger(data.ledger, prices, today, { fxOn });
    if (l.fxMissing.length) krwUnavailable.push(`환율을 알 수 없는 거래 ${l.fxMissing.length}건 (${l.fxMissing.slice(0, 2).join(", ")}${l.fxMissing.length > 2 ? " 등" : ""})`);
    const held = l.positions.filter((p) => p.shares > 0);
    const holdings: HoldingReturn[] = held.map((p) => {
      const usd = figures({ value: p.value, cost: p.cost, realized: p.realized, dividends: p.dividendsNet, invested: p.invested });
      const ok = fxNow && p.costKrw !== null && p.realizedKrw !== null && p.dividendsNetKrw !== null;
      return {
        symbol: p.symbol,
        shares: p.shares,
        avgCost: p.avgCost,
        price: p.price,
        usd,
        krw: ok ? withFx(usd, figures({ value: toKrw(p.value), cost: p.costKrw, realized: p.realizedKrw, dividends: p.dividendsNetKrw, invested: p.investedKrw })) : null,
      };
    });
    const complete = l.pricesComplete;
    const usd: AccountReturn = {
      totalAssets: complete ? l.totalAssets : null,
      value: complete ? l.marketValue : null,
      cost: l.totalCost,
      unrealized: complete ? l.unrealized : null,
      unrealizedPct: complete ? pctOf(l.unrealized, l.totalCost) : null,
      realized: l.realized,
      dividends: l.dividendsNet,
      totalGain: complete ? l.totalPnl : null,
      invested: l.netContributions,
      totalReturnPct: complete ? l.totalReturnPct : null,
    };
    let krw: AccountReturn | null = null;
    // 매도까지 끝난 종목도 실현손익·분배금이 계좌 전체에 들어가므로 모든 종목의 원화 값이 있어야 한다
    const all = l.positions;
    if (fxNow && l.netContributionsKrw !== null && !l.fxMissing.length) {
      const costKrw = sumOrNull(held.map((p) => p.costKrw));
      const totalAssetsKrw = complete ? l.totalAssets * fxNow : null;
      const totalGain = totalAssetsKrw !== null ? totalAssetsKrw - l.netContributionsKrw : null;
      const unrealized = complete && costKrw !== null ? l.marketValue * fxNow - costKrw : null;
      krw = {
        totalAssets: totalAssetsKrw,
        value: complete ? l.marketValue * fxNow : null,
        cost: costKrw,
        unrealized,
        unrealizedPct: pctOf(unrealized, costKrw),
        realized: sumOrNull(all.map((p) => p.realizedKrw)),
        dividends: sumOrNull(all.map((p) => p.dividendsNetKrw)),
        totalGain,
        invested: l.netContributionsKrw,
        totalReturnPct: pctOf(totalGain, l.netContributionsKrw),
        fxEffect: totalGain !== null && usd.totalGain !== null ? totalGain - usd.totalGain * fxNow : null,
      };
    }
    return { mode: "ledger", holdings, usd, krw, fxNow, fxEstimated: l.fxEstimated, krwUnavailable, dividendsEstimated: false, missingPrices: l.missingPrices };
  }

  // ── 간편 입력 ──
  const s = computeSimple(data.simple.holdings, data.simple.cash, prices, { fxOn });
  const tax = (input.divTaxPct ?? 15) / 100;
  let estimated = false;
  const noFx: string[] = [];
  const holdings: HoldingReturn[] = s.positions.map((p) => {
    // 분배금 추정: 최초 매수일 다음 날부터 오늘까지 배당락이 있었던 실제 지급 × 지금 수량 (세후)
    let divUsd: number | null = null;
    let divKrw: number | null = null;
    const divs = p.firstDate && input.divsOf ? input.divsOf(p.symbol) : null;
    if (p.firstDate && divs) {
      const got = divs.filter((d) => d.ex > (p.firstDate as string) && d.ex <= today);
      divUsd = got.reduce((a, d) => a + d.amount * p.shares * (1 - tax), 0);
      divKrw = 0;
      for (const d of got) {
        const f = fxOn(d.pay ?? d.ex);
        divKrw = divKrw !== null && f ? divKrw + d.amount * p.shares * (1 - tax) * f : null;
      }
      if (got.length) estimated = true;
    }
    if (p.costKrw === null) noFx.push(p.symbol);
    const usd = figures({ value: p.value, cost: p.cost, realized: null, dividends: divUsd, invested: p.cost });
    const krw = fxNow && p.costKrw !== null && (divUsd === null || divKrw !== null) ? withFx(usd, figures({ value: toKrw(p.value), cost: p.costKrw, realized: null, dividends: divKrw, invested: p.costKrw })) : null;
    return { symbol: p.symbol, shares: p.shares, avgCost: p.avgCost, price: p.price, usd, krw };
  });
  if (noFx.length) krwUnavailable.push(`${noFx.join(", ")}: 평균 매수 환율이나 최초 매수일을 넣으면 원화 기준으로 계산합니다.`);
  const complete = s.pricesComplete;
  const divUsd = holdings.some((h) => h.usd.dividends !== null) ? holdings.reduce((a, h) => a + (h.usd.dividends ?? 0), 0) : null;
  const unrealized = complete ? s.unrealized : null;
  const totalGain = unrealized !== null ? unrealized + (divUsd ?? 0) : null;
  const usd: AccountReturn = {
    totalAssets: complete ? s.totalAssets : null,
    value: complete ? s.marketValue : null,
    cost: s.totalCost,
    unrealized,
    unrealizedPct: pctOf(unrealized, s.totalCost),
    realized: null,
    dividends: divUsd,
    totalGain,
    invested: s.totalCost,
    totalReturnPct: pctOf(totalGain, s.totalCost),
  };
  let krw: AccountReturn | null = null;
  if (fxNow && holdings.length && holdings.every((h) => h.krw)) {
    const costKrw = holdings.reduce((a, h) => a + (h.krw!.cost as number), 0);
    const valueKrw = complete ? s.marketValue * fxNow : null;
    const unrealizedKrw = valueKrw !== null ? valueKrw - costKrw : null;
    const divKrw = holdings.some((h) => h.krw!.dividends !== null) ? holdings.reduce((a, h) => a + (h.krw!.dividends ?? 0), 0) : null;
    const gain = unrealizedKrw !== null ? unrealizedKrw + (divKrw ?? 0) : null;
    krw = {
      totalAssets: complete ? s.totalAssets * fxNow : null,
      value: valueKrw,
      cost: costKrw,
      unrealized: unrealizedKrw,
      unrealizedPct: pctOf(unrealizedKrw, costKrw),
      realized: null,
      dividends: divKrw,
      totalGain: gain,
      invested: costKrw,
      totalReturnPct: pctOf(gain, costKrw),
      fxEffect: gain !== null && totalGain !== null ? gain - totalGain * fxNow : null,
    };
  }
  const fxEstimated = s.positions.filter((p) => p.fxEstimated).length;
  return { mode: "simple", holdings, usd, krw, fxNow, fxEstimated, krwUnavailable, dividendsEstimated: estimated, missingPrices: s.missingPrices };
}
