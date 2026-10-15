/**
 * 기술적 지표 전략 백테스트 (순수 함수) — 한 종목, 롱 온리(보유 또는 현금)
 *
 * 시점 규칙 (미래 정보 차단)
 * - 신호는 i 번째 봉 '종가 확정 후' i 번째까지의 데이터로만 계산한다 (지표도 ta.ts 의 같은 함수).
 * - 주문은 다음 봉에 체결한다: 다음 날 시가(기본) 또는 다음 날 종가. 같은 종가에 미리 체결하지 않는다.
 * - 체결 가격이 없는 봉(누락)이면 다음 유효한 봉까지 미룬다. 마지막 봉의 신호는 체결되지 않는다.
 * - 배당락일에는 전날 종가 기준 보유 수량에만 분배금을 준다 (그날 시가에 산 주식은 받지 않음, 그날 시가에 판 주식은 받음).
 *
 * 거래 가정
 * - 자금 전부로 사고 전부 판다 (소수점 수량 허용). 쉬는 현금의 이자는 0.
 * - 수수료 = 거래 금액 × 수수료율, 슬리피지 = 살 때 가격 × (1 + bp), 팔 때 × (1 − bp).
 * - 보유 중 받은 분배금은 원천징수 후 배당락일 종가로 같은 종목을 더 산다(비교용 '매수 후 보유'와 같은 방식). 양도세는 넣지 않는다.
 * - 실제 체결 기록이 아니라 가정에 따른 시뮬레이션이다.
 */
import * as ta from "@/lib/ta";
import { cagrPct, drawdown, isNegligible, mean, stdev, yearsBetween } from "./metrics";

// ───────────────────────────── 조건 ─────────────────────────────

export type CondKind =
  | "ma_cross_up"
  | "ma_cross_down"
  | "price_above_ma"
  | "price_below_ma"
  | "rsi_below"
  | "rsi_above"
  | "rsi_cross_up"
  | "rsi_cross_down"
  | "macd_cross_up"
  | "macd_cross_down"
  | "macd_above_zero"
  | "bb_below_lower"
  | "bb_back_inside"
  | "bb_above_upper"
  | "donchian_breakout"
  | "donchian_breakdown"
  | "supertrend_up"
  | "supertrend_down"
  | "adx_above"
  | "atr_pct_below"
  | "volume_above_ma"
  | "stoch_cross_up";

export interface Condition {
  kind: CondKind;
  params: Record<string, number>;
}

export interface CondDef {
  kind: CondKind;
  label: string;
  /** 진입·청산 어디에 어울리는지 (화면 안내용) */
  role: "entry" | "exit" | "filter" | "any";
  params: { key: string; label: string; def: number; min: number; max: number; step?: number }[];
  describe: (p: Record<string, number>) => string;
}

const P = (key: string, label: string, def: number, min: number, max: number, step = 1) => ({ key, label, def, min, max, step });

export const CONDITIONS: CondDef[] = [
  { kind: "ma_cross_up", label: "이동평균 골든크로스", role: "entry", params: [P("fast", "단기", 50, 2, 200), P("slow", "장기", 200, 5, 400), P("ema", "EMA=1", 0, 0, 1)], describe: (p) => `${p.ema ? "EMA" : "SMA"}${p.fast} 이 ${p.ema ? "EMA" : "SMA"}${p.slow} 을 위로 뚫음` },
  { kind: "ma_cross_down", label: "이동평균 데드크로스", role: "exit", params: [P("fast", "단기", 50, 2, 200), P("slow", "장기", 200, 5, 400), P("ema", "EMA=1", 0, 0, 1)], describe: (p) => `${p.ema ? "EMA" : "SMA"}${p.fast} 이 ${p.ema ? "EMA" : "SMA"}${p.slow} 을 아래로 뚫음` },
  { kind: "price_above_ma", label: "종가 > 이동평균", role: "filter", params: [P("n", "기간", 200, 2, 400)], describe: (p) => `종가가 SMA${p.n} 위` },
  { kind: "price_below_ma", label: "종가 < 이동평균", role: "exit", params: [P("n", "기간", 200, 2, 400)], describe: (p) => `종가가 SMA${p.n} 아래` },
  { kind: "rsi_below", label: "RSI 아래", role: "entry", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 30, 1, 99)], describe: (p) => `RSI${p.n} < ${p.level}` },
  { kind: "rsi_above", label: "RSI 위", role: "exit", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 70, 1, 99)], describe: (p) => `RSI${p.n} > ${p.level}` },
  { kind: "rsi_cross_up", label: "RSI 기준선 회복(상향 돌파)", role: "entry", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 30, 1, 99)], describe: (p) => `RSI${p.n} 가 ${p.level} 을 아래에서 위로` },
  { kind: "rsi_cross_down", label: "RSI 기준선 하향 돌파", role: "exit", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 70, 1, 99)], describe: (p) => `RSI${p.n} 가 ${p.level} 을 위에서 아래로` },
  { kind: "macd_cross_up", label: "MACD 시그널 상향 교차", role: "entry", params: [P("fast", "단기", 12, 2, 50), P("slow", "장기", 26, 3, 100), P("sig", "시그널", 9, 2, 50)], describe: (p) => `MACD(${p.fast},${p.slow},${p.sig}) 가 시그널 위로` },
  { kind: "macd_cross_down", label: "MACD 시그널 하향 교차", role: "exit", params: [P("fast", "단기", 12, 2, 50), P("slow", "장기", 26, 3, 100), P("sig", "시그널", 9, 2, 50)], describe: (p) => `MACD(${p.fast},${p.slow},${p.sig}) 가 시그널 아래로` },
  { kind: "macd_above_zero", label: "MACD > 0", role: "filter", params: [P("fast", "단기", 12, 2, 50), P("slow", "장기", 26, 3, 100)], describe: (p) => `MACD(${p.fast},${p.slow}) > 0` },
  { kind: "bb_below_lower", label: "종가 < 볼린저 하단", role: "entry", params: [P("n", "기간", 20, 2, 100), P("k", "배수", 2, 0.5, 4, 0.1)], describe: (p) => `종가가 BB(${p.n},${p.k}) 하단 아래` },
  { kind: "bb_back_inside", label: "볼린저 하단 아래에서 복귀", role: "entry", params: [P("n", "기간", 20, 2, 100), P("k", "배수", 2, 0.5, 4, 0.1)], describe: (p) => `전날 BB(${p.n},${p.k}) 하단 아래 → 오늘 하단 위` },
  { kind: "bb_above_upper", label: "종가 > 볼린저 상단", role: "exit", params: [P("n", "기간", 20, 2, 100), P("k", "배수", 2, 0.5, 4, 0.1)], describe: (p) => `종가가 BB(${p.n},${p.k}) 상단 위` },
  { kind: "donchian_breakout", label: "n일 신고가 돌파", role: "entry", params: [P("n", "기간", 55, 5, 300)], describe: (p) => `종가가 직전 ${p.n}봉 최고가 위` },
  { kind: "donchian_breakdown", label: "n일 신저가 이탈", role: "exit", params: [P("n", "기간", 20, 5, 300)], describe: (p) => `종가가 직전 ${p.n}봉 최저가 아래` },
  { kind: "supertrend_up", label: "Supertrend 상승 전환", role: "entry", params: [P("n", "ATR", 10, 2, 50), P("m", "배수", 3, 0.5, 10, 0.5)], describe: (p) => `Supertrend(${p.n},${p.m}) 상승 전환` },
  { kind: "supertrend_down", label: "Supertrend 하락 전환", role: "exit", params: [P("n", "ATR", 10, 2, 50), P("m", "배수", 3, 0.5, 10, 0.5)], describe: (p) => `Supertrend(${p.n},${p.m}) 하락 전환` },
  { kind: "adx_above", label: "ADX 추세 필터", role: "filter", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 25, 5, 60)], describe: (p) => `ADX${p.n} > ${p.level}` },
  { kind: "atr_pct_below", label: "ATR 변동성 필터", role: "filter", params: [P("n", "기간", 14, 2, 50), P("pct", "ATR÷종가 %", 3, 0.2, 20, 0.1)], describe: (p) => `ATR${p.n} ÷ 종가 < ${p.pct}%` },
  { kind: "volume_above_ma", label: "거래량 증가 필터", role: "filter", params: [P("n", "기간", 20, 2, 100), P("k", "배수", 1.5, 0.5, 5, 0.1)], describe: (p) => `거래량 > ${p.n}봉 평균 × ${p.k}` },
  { kind: "stoch_cross_up", label: "스토캐스틱 과매도 상향 교차", role: "entry", params: [P("n", "기간", 14, 2, 50), P("level", "기준", 20, 1, 50)], describe: (p) => `%K 가 %D 를 위로 (%K < ${p.level})` },
];
export const COND_BY_KIND = new Map(CONDITIONS.map((c) => [c.kind, c]));

export function condParams(c: Condition): Record<string, number> {
  const d = COND_BY_KIND.get(c.kind);
  const out: Record<string, number> = {};
  for (const x of d?.params ?? []) {
    const v = Number(c.params?.[x.key]);
    out[x.key] = Number.isFinite(v) ? Math.min(x.max, Math.max(x.min, v)) : x.def;
  }
  return out;
}

export function describeCond(c: Condition): string {
  return COND_BY_KIND.get(c.kind)?.describe(condParams(c)) ?? c.kind;
}

/** 조건별 참/거짓 배열 (i 번째 = i 번째 봉 종가까지 보고 판단, 계산 불가면 false) */
export function evalCondition(c: Condition, b: ta.Bars & { v: number[] }, cache: Map<string, unknown> = new Map()): boolean[] {
  const p = condParams(c);
  const memo = <T>(key: string, f: () => T): T => {
    if (!cache.has(key)) cache.set(key, f());
    return cache.get(key) as T;
  };
  const len = b.c.length;
  const ma = (n: number, e: number) => memo(`${e ? "ema" : "sma"}${n}`, () => (e ? ta.ema(b.c, n) : ta.sma(b.c, n)));
  const cross = (a: ta.Series, x: ta.Series, up: boolean) =>
    Array.from({ length: len }, (_, i) => {
      if (i === 0 || a[i] === null || x[i] === null || a[i - 1] === null || x[i - 1] === null) return false;
      return up ? (a[i - 1] as number) <= (x[i - 1] as number) && (a[i] as number) > (x[i] as number) : (a[i - 1] as number) >= (x[i - 1] as number) && (a[i] as number) < (x[i] as number);
    });
  const lvl = (s: ta.Series, level: number) => s.map(() => level) as ta.Series;
  switch (c.kind) {
    case "ma_cross_up":
    case "ma_cross_down":
      return cross(ma(p.fast, p.ema), ma(p.slow, p.ema), c.kind === "ma_cross_up");
    case "price_above_ma":
    case "price_below_ma": {
      const m = ma(p.n, 0);
      return b.c.map((x, i) => m[i] !== null && Number.isFinite(x) && (c.kind === "price_above_ma" ? x > (m[i] as number) : x < (m[i] as number)));
    }
    case "rsi_below":
    case "rsi_above": {
      const r = memo(`rsi${p.n}`, () => ta.rsi(b.c, p.n));
      return r.map((x) => x !== null && (c.kind === "rsi_below" ? x < p.level : x > p.level));
    }
    case "rsi_cross_up":
    case "rsi_cross_down": {
      const r = memo(`rsi${p.n}`, () => ta.rsi(b.c, p.n));
      return cross(r, lvl(r, p.level), c.kind === "rsi_cross_up");
    }
    case "macd_cross_up":
    case "macd_cross_down": {
      const m = memo(`macd${p.fast},${p.slow},${p.sig}`, () => ta.macd(b.c, p.fast, p.slow, p.sig));
      return cross(m.macd, m.signal, c.kind === "macd_cross_up");
    }
    case "macd_above_zero": {
      const m = memo(`macd${p.fast},${p.slow},9`, () => ta.macd(b.c, p.fast, p.slow, 9));
      return m.macd.map((x) => x !== null && x > 0);
    }
    case "bb_below_lower":
    case "bb_above_upper":
    case "bb_back_inside": {
      const bb = memo(`bb${p.n},${p.k}`, () => ta.bollinger(b.c, p.n, p.k));
      if (c.kind === "bb_below_lower") return b.c.map((x, i) => bb.lower[i] !== null && x < (bb.lower[i] as number));
      if (c.kind === "bb_above_upper") return b.c.map((x, i) => bb.upper[i] !== null && x > (bb.upper[i] as number));
      return b.c.map((x, i) => i > 0 && bb.lower[i] !== null && bb.lower[i - 1] !== null && b.c[i - 1] < (bb.lower[i - 1] as number) && x >= (bb.lower[i] as number));
    }
    case "donchian_breakout":
    case "donchian_breakdown": {
      // 직전 봉까지의 채널 (오늘 봉을 포함하면 오늘 고가가 채널이 되어 돌파가 안 됨)
      const hh = memo(`hh${p.n}`, () => ta.highest(b.h, p.n));
      const ll = memo(`ll${p.n}`, () => ta.lowest(b.l, p.n));
      return b.c.map((x, i) => (i > 0 && (c.kind === "donchian_breakout" ? hh[i - 1] !== null && x > (hh[i - 1] as number) : ll[i - 1] !== null && x < (ll[i - 1] as number))));
    }
    case "supertrend_up":
    case "supertrend_down": {
      const st = memo(`st${p.n},${p.m}`, () => ta.supertrend(b, p.n, p.m));
      const want = c.kind === "supertrend_up" ? 1 : -1;
      return st.dir.map((d, i) => i > 0 && d === want && st.dir[i - 1] === -want);
    }
    case "adx_above": {
      const a = memo(`adx${p.n}`, () => ta.adx(b, p.n));
      return a.adx.map((x) => x !== null && x > p.level);
    }
    case "atr_pct_below": {
      const a = memo(`atr${p.n}`, () => ta.atr(b, p.n));
      return a.map((x, i) => x !== null && b.c[i] > 0 && (x / b.c[i]) * 100 < p.pct);
    }
    case "volume_above_ma": {
      const vm = memo(`vma${p.n}`, () => ta.sma(b.v, p.n));
      return b.v.map((x, i) => vm[i] !== null && (vm[i] as number) > 0 && x > (vm[i] as number) * p.k);
    }
    case "stoch_cross_up": {
      const s = memo(`stoch${p.n}`, () => ta.stochastic(b, p.n, 3, 3));
      const x = cross(s.k, s.d, true);
      return x.map((v, i) => v && s.k[i] !== null && (s.k[i] as number) < p.level);
    }
  }
}

// ───────────────────────────── 엔진 ─────────────────────────────

export interface StrategyRules {
  /** 모두 참이면 진입 신호 (AND) */
  entry: Condition[];
  /** 하나라도 참이면 청산 신호 (OR) */
  exit: Condition[];
  /** 진입가 대비 종가 손실이 이만큼(%)이면 청산 신호 */
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
  /** 보유 봉 수가 이만큼이면 청산 신호 */
  maxHoldBars?: number | null;
}

export interface ExecConfig {
  execution: "next_open" | "next_close";
  initial: number;
  commissionPct: number;
  slippageBps: number;
  /** 분배금 원천징수율 (%) */
  divTaxPct: number;
}

export interface StratBars {
  dates: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  divs: { ex: string; amount: number }[];
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  shares: number;
  /** 진입 신호를 낸 날 (체결 전날) */
  signalDate: string;
  /** 비용·분배금 포함 손익 (청산 전이면 기간 마지막 종가로 평가) */
  pnl: number;
  retPct: number;
  bars: number;
  days: number;
  dividends: number;
  open: boolean;
  exitReason: string | null;
  /** 진입에 쓴 돈 (수수료 포함) */
  cost: number;
}

export interface StrategyResult {
  dates: string[];
  equity: number[];
  /** 같은 비용으로 첫 체결일에 사서 끝까지 보유 (분배금 재투자) */
  buyHold: number[];
  /** 보유 중이었는지 (봉별) */
  inMarket: boolean[];
  trades: Trade[];
  signals: { entry: number; exit: number; ignoredEntry: number; delayed: number; lastBarUnfilled: boolean };
  stats: TradeStats;
  totalReturnPct: number;
  cagrPct: number | null;
  mddPct: number;
  volPct: number | null;
  sharpe: number | null;
  bhTotalReturnPct: number;
  bhCagrPct: number | null;
  bhMddPct: number;
  costs: number;
  dividends: number;
  years: number;
  notes: string[];
}

export interface TradeStats {
  trades: number;
  closed: number;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** 이익 합 ÷ 손실 합 (손실 거래가 없으면 null) */
  profitFactor: number | null;
  /** 거래당 평균 수익률 (%) */
  expectancyPct: number | null;
  avgBars: number | null;
  avgDays: number | null;
  /** 시장 노출 비중 (보유한 봉 ÷ 전체 봉, %) */
  exposurePct: number;
  /** 연 회전율 = (매수 + 매도 금액) ÷ 평균 자산 ÷ 연수 */
  turnover: number | null;
  notes: string[];
}

const ok = (x: number) => typeof x === "number" && Number.isFinite(x) && x > 0;

export function runStrategy(data: StratBars, rules: StrategyRules, cfg: ExecConfig, cache: Map<string, unknown> = new Map()): StrategyResult | { error: string } {
  const n = data.dates.length;
  if (n < 30) return { error: `가격 기록이 ${n}봉뿐이라 계산하지 않습니다 (30봉 이상 필요).` };
  if (!rules.entry.length) return { error: "진입 조건을 하나 이상 고르세요." };
  if (!(cfg.initial > 0)) return { error: "초기 자금을 입력하세요." };
  const b = { h: data.h, l: data.l, c: data.c, v: data.v };
  const entryArr = rules.entry.map((c) => evalCondition(c, b, cache));
  const exitArr = rules.exit.map((c) => evalCondition(c, b, cache));
  const entrySig = Array.from({ length: n }, (_, i) => entryArr.every((a) => a[i]));
  const exitSig = Array.from({ length: n }, (_, i) => exitArr.some((a) => a[i]));
  const slip = cfg.slippageBps / 10000;
  const fee = cfg.commissionPct / 100;
  const tax = cfg.divTaxPct / 100;
  // 배당락: 날짜순, 거래일 사이(직전 다음 날 ~ 오늘)에 들어오는 분배금 합
  const divs = [...data.divs].sort((a, c) => (a.ex < c.ex ? -1 : 1));
  const divOn = new Array<number>(n).fill(0);
  let dp = 0;
  while (dp < divs.length && divs[dp].ex <= data.dates[0]) dp++;
  for (let i = 1; i < n; i++) while (dp < divs.length && divs[dp].ex <= data.dates[i]) divOn[i] += divs[dp++].amount;

  let cash = cfg.initial;
  let shares = 0;
  let pending: "buy" | "sell" | null = null;
  let pendingSince = -1;
  let pendingReason: string | null = null;
  const equity: number[] = [];
  const inMarket: boolean[] = [];
  const trades: Trade[] = [];
  let cur: Trade | null = null;
  let costs = 0;
  let dividends = 0;
  let traded = 0;
  const sig = { entry: 0, exit: 0, ignoredEntry: 0, delayed: 0, lastBarUnfilled: false };
  // 비교용: 같은 비용으로 첫 체결 가능일에 사서 끝까지 보유 (분배금은 그날 종가로 재투자)
  let bhShares = 0;
  let bhCash = cfg.initial;
  const buyHold: number[] = [];
  let lastClose = ok(data.c[0]) ? data.c[0] : NaN;

  for (let i = 0; i < n; i++) {
    const closeOk = ok(data.c[i]);
    // 1) 배당락: 전날 종가 기준 보유분에만. 보유 중이면 세후 분배금을 그날 종가로 같은 종목에 재투자 (매수 후 보유와 같은 방식)
    if (divOn[i] > 0 && closeOk) {
      if (shares > 0) {
        const d = shares * divOn[i] * (1 - tax);
        shares += d / data.c[i];
        dividends += d;
        if (cur) {
          cur.dividends += d;
          cur.shares = shares;
        }
      }
      if (bhShares > 0) bhShares += (bhShares * divOn[i] * (1 - tax)) / data.c[i];
    }
    // 2) 전날 신호 체결 (다음 날 시가 또는 종가)
    const px = cfg.execution === "next_open" ? data.o[i] : data.c[i];
    if (pending) {
      if (!ok(px)) sig.delayed++;
      else if (pending === "buy" && shares === 0) {
        const fill = px * (1 + slip);
        const spend = cash / (1 + fee);
        shares = spend / fill;
        costs += spend * fee + shares * px * slip;
        traded += spend;
        cur = { entryDate: data.dates[i], entryPrice: fill, exitDate: null, exitPrice: null, shares, signalDate: data.dates[pendingSince], pnl: 0, retPct: 0, bars: 0, days: 0, dividends: 0, open: true, exitReason: null, cost: cash };
        cash = 0;
        trades.push(cur);
        pending = null;
      } else if (pending === "sell" && shares > 0) {
        const fill = px * (1 - slip);
        const gross = shares * fill;
        const net = gross * (1 - fee);
        costs += gross * fee + shares * px * slip;
        traded += gross;
        cash += net;
        if (cur) {
          cur.exitDate = data.dates[i];
          cur.exitPrice = fill;
          cur.pnl = net - cur.cost;
          cur.retPct = (cur.pnl / cur.cost) * 100;
          cur.open = false;
          cur.exitReason = pendingReason;
          cur.days = Math.round((Date.parse(data.dates[i]) - Date.parse(cur.entryDate)) / 86400000);
        }
        cur = null;
        shares = 0;
        pending = null;
      } else pending = null;
    }
    if (bhShares === 0 && bhCash > 0 && i > 0 && ok(px)) {
      bhShares = bhCash / (1 + fee) / (px * (1 + slip));
      bhCash = 0;
    }
    // 3) 종가 평가 (종가가 없는 봉은 직전 종가 유지)
    if (closeOk) lastClose = data.c[i];
    equity.push(cash + shares * (Number.isFinite(lastClose) ? lastClose : 0));
    inMarket.push(shares > 0);
    buyHold.push(bhCash + bhShares * (Number.isFinite(lastClose) ? lastClose : 0));
    if (cur) cur.bars++;
    // 4) 종가 확정 후 신호 → 다음 봉에 체결
    if (entrySig[i] && !(i > 0 && entrySig[i - 1])) {
      sig.entry++;
      if (shares > 0 || pending === "buy") sig.ignoredEntry++;
    }
    if (shares > 0 && pending !== "sell") {
      let reason: string | null = null;
      if (exitSig[i]) reason = "청산 조건";
      else if (cur && rules.stopLossPct && closeOk && data.c[i] <= cur.entryPrice * (1 - rules.stopLossPct / 100)) reason = `손절 −${rules.stopLossPct}% (종가 기준)`;
      else if (cur && rules.takeProfitPct && closeOk && data.c[i] >= cur.entryPrice * (1 + rules.takeProfitPct / 100)) reason = `익절 +${rules.takeProfitPct}% (종가 기준)`;
      else if (cur && rules.maxHoldBars && cur.bars >= rules.maxHoldBars) reason = `최대 보유 ${rules.maxHoldBars}봉`;
      if (reason) {
        sig.exit++;
        pending = "sell";
        pendingSince = i;
        pendingReason = reason;
      }
    } else if (shares === 0 && !pending && entrySig[i]) {
      pending = "buy";
      pendingSince = i;
    }
  }
  if (pending) sig.lastBarUnfilled = true;
  // 열린 거래는 마지막 종가로 평가 (청산 비용 미반영)
  if (cur) {
    cur.pnl = cur.shares * lastClose - cur.cost;
    cur.retPct = (cur.pnl / cur.cost) * 100;
    cur.days = Math.round((Date.parse(data.dates[n - 1]) - Date.parse(cur.entryDate)) / 86400000);
  }
  const years = yearsBetween(data.dates[0], data.dates[n - 1]);
  const dd = drawdown(equity);
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const sd = stdev(rets);
  const bhDd = drawdown(buyHold);
  const stats = tradeStats(trades, inMarket, traded, equity, years);
  const notes: string[] = [];
  if (sig.lastBarUnfilled) notes.push("마지막 봉에서 나온 신호는 다음 봉이 없어 체결하지 않았습니다.");
  if (sig.delayed) notes.push(`체결할 가격이 없는 봉이 ${sig.delayed}번 있어 다음 유효한 봉으로 미뤘습니다.`);
  if (cur) notes.push(`기간 끝에 보유 중인 거래 1건은 마지막 종가(${data.dates[n - 1]})로 평가했습니다 (청산 비용 미반영).`);
  return {
    dates: data.dates,
    equity,
    buyHold,
    inMarket,
    trades,
    signals: sig,
    stats,
    totalReturnPct: (equity[n - 1] / cfg.initial - 1) * 100,
    cagrPct: cagrPct(equity[n - 1] / cfg.initial, years),
    mddPct: dd.mddPct,
    volPct: rets.length >= 20 && !isNegligible(sd) ? sd * Math.sqrt(252) * 100 : null,
    sharpe: rets.length >= 60 && !isNegligible(sd) ? (mean(rets) * 252) / (sd * Math.sqrt(252)) : null,
    bhTotalReturnPct: (buyHold[n - 1] / cfg.initial - 1) * 100,
    bhCagrPct: cagrPct(buyHold[n - 1] / cfg.initial, years),
    bhMddPct: bhDd.mddPct,
    costs,
    dividends,
    years,
    notes,
  };
}

export function tradeStats(trades: Trade[], inMarket: boolean[], traded: number, equity: number[], years: number): TradeStats {
  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const notes: string[] = [];
  if (!closed.length) notes.push("청산된 거래가 없어 승률·손익비를 계산하지 않았습니다.");
  const gw = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = -losses.reduce((a, t) => a + t.pnl, 0);
  if (closed.length && !losses.length) notes.push("손실 거래가 없어 손익비(Profit Factor)를 계산하지 않았습니다 (분모 0).");
  const avgEq = mean(equity);
  return {
    trades: trades.length,
    closed: closed.length,
    winRatePct: closed.length ? (wins.length / closed.length) * 100 : null,
    avgWinPct: wins.length ? mean(wins.map((t) => t.retPct)) : null,
    avgLossPct: losses.length ? mean(losses.map((t) => t.retPct)) : null,
    profitFactor: closed.length && gl > 0 ? gw / gl : null,
    expectancyPct: closed.length ? mean(closed.map((t) => t.retPct)) : null,
    avgBars: closed.length ? mean(closed.map((t) => t.bars)) : null,
    avgDays: closed.length ? mean(closed.map((t) => t.days)) : null,
    exposurePct: inMarket.length ? (inMarket.filter(Boolean).length / inMarket.length) * 100 : 0,
    turnover: years > 0 && avgEq > 0 ? traded / avgEq / years : null,
    notes,
  };
}

// ───────────────────────────── 검증: 구간 나누기·민감도·워크포워드·시장 국면 ─────────────────────────────

/** 지수 구간 성과 (시작 = 1) */
export function segmentStats(dates: string[], equity: number[], from: number, to: number) {
  const seg = equity.slice(from, to + 1);
  if (seg.length < 2) return null;
  const years = yearsBetween(dates[from], dates[to]);
  const rets: number[] = [];
  for (let i = 1; i < seg.length; i++) rets.push(seg[i] / seg[i - 1] - 1);
  const sd = stdev(rets);
  return {
    from: dates[from],
    to: dates[to],
    totalReturnPct: (seg[seg.length - 1] / seg[0] - 1) * 100,
    cagrPct: cagrPct(seg[seg.length - 1] / seg[0], years),
    mddPct: drawdown(seg).mddPct,
    sharpe: rets.length >= 60 && !isNegligible(sd) ? (mean(rets) * 252) / (sd * Math.sqrt(252)) : null,
  };
}

/** 두 파라미터 격자: 각 칸의 전략을 '학습 구간'(처음 ~ splitIdx) 성과로 평가 */
export interface GridAxis {
  /** 바꿀 조건 위치 (entry/exit) 와 파라미터 키 — 같은 키를 쓰는 진입·청산 조건에 함께 적용 */
  key: string;
  label: string;
  values: number[];
}

export function applyParam(rules: StrategyRules, key: string, v: number): StrategyRules {
  const set = (cs: Condition[]) => cs.map((c) => (key in condParams(c) ? { ...c, params: { ...c.params, [key]: v } } : c));
  return { ...rules, entry: set(rules.entry), exit: set(rules.exit) };
}

export interface GridCell {
  x: number;
  y: number | null;
  /** 학습 구간 샤프·CAGR, 평가 구간 CAGR */
  isSharpe: number | null;
  isCagr: number | null;
  oosCagr: number | null;
  trades: number;
}

export function paramGrid(data: StratBars, rules: StrategyRules, cfg: ExecConfig, ax: GridAxis, ay: GridAxis | null, splitIdx: number): GridCell[] {
  const out: GridCell[] = [];
  const cache = new Map<string, unknown>();
  const ys = ay ? ay.values : [null];
  for (const x of ax.values)
    for (const y of ys) {
      let r = applyParam(rules, ax.key, x);
      if (ay && y !== null) r = applyParam(r, ay.key, y);
      const res = runStrategy(data, r, cfg, cache);
      if ("error" in res) continue;
      const is = segmentStats(res.dates, res.equity, 0, splitIdx);
      const oos = splitIdx < res.dates.length - 2 ? segmentStats(res.dates, res.equity, splitIdx, res.dates.length - 1) : null;
      out.push({ x, y, isSharpe: is?.sharpe ?? null, isCagr: is?.cagrPct ?? null, oosCagr: oos?.cagrPct ?? null, trades: res.trades.length });
    }
  return out;
}

/** 최고 칸과 그 주변(바로 옆 칸) 성과 — 주변이 크게 나쁘면 '우연히 잘 맞은 값'일 가능성 */
export function neighborhood(cells: GridCell[], ax: GridAxis, ay: GridAxis | null, metric: (c: GridCell) => number | null) {
  const valid = cells.filter((c) => metric(c) !== null);
  if (!valid.length) return null;
  const best = valid.reduce((a, c) => ((metric(c) as number) > (metric(a) as number) ? c : a));
  const xi = ax.values.indexOf(best.x);
  const yi = ay && best.y !== null ? ay.values.indexOf(best.y) : 0;
  const near = valid.filter((c) => {
    const cx = ax.values.indexOf(c.x);
    const cy = ay && c.y !== null ? ay.values.indexOf(c.y) : 0;
    return Math.abs(cx - xi) <= 1 && Math.abs(cy - yi) <= 1 && c !== best;
  });
  const vals = near.map((c) => metric(c) as number);
  return { best, bestValue: metric(best) as number, neighborMean: vals.length ? mean(vals) : null, neighborMin: vals.length ? Math.min(...vals) : null, neighbors: vals.length };
}

export interface WalkForwardWindow {
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
  chosen: { x: number; y: number | null };
  trainSharpe: number | null;
  testReturnPct: number;
}

/**
 * 워크포워드: 학습 창(trainYears)에서 샤프가 가장 높은 파라미터를 고르고, 바로 다음 평가 창(testYears)의 성과를 이어 붙인다.
 * 각 파라미터의 전략은 처음부터 끝까지 한 번 돌린 결과를 쓰며(포지션이 이어짐), 고를 때는 학습 창 끝까지의 성과만 본다.
 */
export function walkForward(data: StratBars, rules: StrategyRules, cfg: ExecConfig, ax: GridAxis, ay: GridAxis | null, trainYears = 3, testYears = 1) {
  const cache = new Map<string, unknown>();
  const combos: { x: number; y: number | null; eq: number[] }[] = [];
  for (const x of ax.values)
    for (const y of ay ? ay.values : [null]) {
      let r = applyParam(rules, ax.key, x);
      if (ay && y !== null) r = applyParam(r, ay.key, y);
      const res = runStrategy(data, r, cfg, cache);
      if (!("error" in res)) combos.push({ x, y, eq: res.equity });
    }
  if (!combos.length) return null;
  const d = data.dates;
  const idxAt = (date: string) => {
    let i = d.findIndex((x) => x >= date);
    if (i < 0) i = d.length - 1;
    return i;
  };
  const addYears = (date: string, y: number) => `${Number(date.slice(0, 4)) + y}${date.slice(4)}`;
  const windows: WalkForwardWindow[] = [];
  const oos: { date: string; ret: number }[] = [];
  let trainStart = d[0];
  for (;;) {
    const trainEnd = addYears(trainStart, trainYears);
    const testEnd = addYears(trainEnd, testYears);
    const a = idxAt(trainStart);
    const bI = idxAt(trainEnd);
    if (bI >= d.length - 2 || d[d.length - 1] < trainEnd) break;
    const cI = Math.min(idxAt(testEnd), d.length - 1);
    let best: (typeof combos)[number] | null = null;
    let bestS = -Infinity;
    for (const c of combos) {
      const s = segmentStats(d, c.eq, a, bI)?.sharpe;
      if (s !== null && s !== undefined && s > bestS) {
        bestS = s;
        best = c;
      }
    }
    if (!best) break;
    for (let i = bI + 1; i <= cI; i++) oos.push({ date: d[i], ret: best.eq[i] / best.eq[i - 1] - 1 });
    windows.push({ trainFrom: d[a], trainTo: d[bI], testFrom: d[bI], testTo: d[cI], chosen: { x: best.x, y: best.y }, trainSharpe: bestS, testReturnPct: (best.eq[cI] / best.eq[bI] - 1) * 100 });
    if (cI >= d.length - 1) break;
    trainStart = addYears(trainStart, testYears);
  }
  if (!windows.length) return null;
  const curve = [1];
  for (const r of oos) curve.push(curve[curve.length - 1] * (1 + r.ret));
  const dates = [windows[0].testFrom, ...oos.map((r) => r.date)];
  return { windows, dates, curve, stats: segmentStats(dates, curve, 0, curve.length - 1) };
}

/** 시장 국면: 연도별 '매수 후 보유' 수익률로 상승(>+10%)·하락(<−10%)·횡보로 나누고, 국면마다 전략과 보유의 평균 연 수익률 비교 (1년 전체가 있는 연도만) */
export function regimes(dates: string[], equity: number[], buyHold: number[]) {
  const years = new Map<string, { a: number; b: number; ea: number; eb: number; first: string; last: string }>();
  for (let i = 1; i < dates.length; i++) {
    const y = dates[i].slice(0, 4);
    const g = years.get(y);
    if (!g) years.set(y, { a: i - 1, b: i, ea: 0, eb: 0, first: dates[i], last: dates[i] });
    else {
      g.b = i;
      g.last = dates[i];
    }
  }
  const rows = [...years.entries()]
    .filter(([, g]) => g.first.slice(5) <= "01-06" && g.last.slice(5) >= "12-24")
    .map(([y, g]) => {
      const bh = (buyHold[g.b] / buyHold[g.a] - 1) * 100;
      const st = (equity[g.b] / equity[g.a] - 1) * 100;
      return { year: y, buyHoldPct: bh, strategyPct: st, regime: bh > 10 ? "상승" : bh < -10 ? "하락" : "횡보" };
    });
  const groups = (["상승", "횡보", "하락"] as const).map((rg) => {
    const xs = rows.filter((r) => r.regime === rg);
    return { regime: rg, years: xs.length, strategyAvgPct: xs.length ? mean(xs.map((r) => r.strategyPct)) : null, buyHoldAvgPct: xs.length ? mean(xs.map((r) => r.buyHoldPct)) : null };
  });
  return { rows, groups };
}
