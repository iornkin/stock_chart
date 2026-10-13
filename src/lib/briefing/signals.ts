/**
 * 일일 변화 분석: 특정 거래일 종가 기준 '신호 상태'를 계산하고, 직전 거래일 상태와 비교해 새로 생긴 변화만 고른다.
 * 같은 규칙으로 두 날짜를 계산하므로 "어제도 그랬던 내용"은 변화로 잡히지 않는다.
 */
import { bollinger, macd, realizedVol, rsi, sma } from "../indicators";
import type { Bar } from "../types";

export interface SignalState {
  date: string;
  close: number;
  changePct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macdDiff: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  /** 이전 252거래일(당일 제외) 최고·최저 종가 */
  priorHigh: number | null;
  priorLow: number | null;
  /** 최근 252거래일(당일 포함) 최고 종가 대비 하락률 (%) */
  fromHigh: number | null;
  /** 직전 20거래일 일간 등락률 표준편차 (%) */
  dailyStd20: number | null;
  vol20: number | null;
  vol250: number | null;
  volRatio: number | null;
  ret5: number | null;
  ret20: number | null;
  streak: number;
}

export type ChangeTag = "price" | "volume" | "technical" | "news" | "dividend" | "event" | "relative" | "risk";

export interface ChangeItem {
  /** 칩·제목용 짧은 문구 */
  short: string;
  text: string;
  kind: "fact" | "calc" | "interpretation";
  importance: 1 | 2 | 3;
  tag: ChangeTag;
  direction: "up" | "down" | "neutral";
  evidence: string[];
}

const lastOf = (s: (number | null)[]) => (s.length ? s[s.length - 1] : null);

/** daily[0..idx] 로 idx 날짜의 상태를 계산 */
export function signalStateAt(daily: { date: string; bar: Bar }[], idx: number): SignalState | null {
  if (idx < 1 || idx >= daily.length) return null;
  const hist = daily.slice(0, idx + 1);
  const closes = hist.map((d) => d.bar.c);
  const close = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const m = closes.length >= 35 ? macd(closes) : null;
  const md = m ? lastOf(m.macd) : null;
  const ms = m ? lastOf(m.signal) : null;
  const bb = closes.length >= 20 ? bollinger(closes, 20, 2) : null;
  const prior = closes.slice(Math.max(0, closes.length - 253), -1);
  const window = closes.slice(-252);
  const rets = closes.slice(-21).map((c, i, a) => (i === 0 ? null : (c / a[i - 1] - 1) * 100)).filter((x): x is number => x !== null);
  const priorRets = rets.slice(0, -1);
  const mean = priorRets.reduce((a, b) => a + b, 0) / (priorRets.length || 1);
  const std = priorRets.length >= 10 ? Math.sqrt(priorRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (priorRets.length - 1)) : null;
  const vols = hist.slice(-21, -1).map((d) => d.bar.v);
  const avgVol = vols.length >= 10 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  let streak = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    const c = closes[i] - closes[i - 1];
    if (c === 0) break;
    if (streak === 0) streak = c > 0 ? 1 : -1;
    else if ((streak > 0) === c > 0) streak += Math.sign(streak);
    else break;
  }
  return {
    date: hist[hist.length - 1].date,
    close,
    changePct: prev ? (close / prev - 1) * 100 : null,
    sma20: closes.length >= 20 ? lastOf(sma(closes, 20)) : null,
    sma50: closes.length >= 50 ? lastOf(sma(closes, 50)) : null,
    sma200: closes.length >= 200 ? lastOf(sma(closes, 200)) : null,
    rsi: closes.length >= 15 ? lastOf(rsi(closes, 14)) : null,
    macdDiff: md !== null && ms !== null ? md - ms : null,
    bbUpper: bb ? lastOf(bb.upper) : null,
    bbLower: bb ? lastOf(bb.lower) : null,
    priorHigh: prior.length >= 200 ? Math.max(...prior) : null,
    priorLow: prior.length >= 200 ? Math.min(...prior) : null,
    fromHigh: window.length >= 60 ? (close / Math.max(...window) - 1) * 100 : null,
    dailyStd20: std,
    vol20: realizedVol(closes, 20),
    vol250: closes.length > 60 ? realizedVol(closes, Math.min(250, closes.length - 1)) : null,
    volRatio: avgVol && hist[hist.length - 1].bar.v > 0 ? hist[hist.length - 1].bar.v / avgVol : null,
    ret5: closes.length > 5 ? (close / closes[closes.length - 6] - 1) * 100 : null,
    ret20: closes.length > 20 ? (close / closes[closes.length - 21] - 1) * 100 : null,
    streak,
  };
}

const pct = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * 가격·기술적 신호의 '새로운' 변화 (전일 상태 → 오늘 상태)
 * ev: 근거 ID (가격 P, 거래량 V, 지표 T)
 */
export function priceSignalChanges(prev: SignalState | null, cur: SignalState, ev: { price: string[]; volume: string[]; tech: string[] }): ChangeItem[] {
  const out: ChangeItem[] = [];
  const push = (c: ChangeItem) => out.push(c);
  // 평소 변동폭 대비 큰 움직임
  if (cur.changePct !== null && cur.dailyStd20 && Math.abs(cur.changePct) >= 1) {
    const z = Math.abs(cur.changePct) / cur.dailyStd20;
    if (z >= 2) {
      push({
        short: `평소의 ${z.toFixed(1)}배 ${cur.changePct > 0 ? "상승" : "하락"}`,
        text: `하루 등락률 ${pct(cur.changePct, 2)}는 최근 20거래일 일간 변동폭(표준편차 ${cur.dailyStd20.toFixed(2)}%)의 ${z.toFixed(1)}배로, 평소보다 큰 움직임입니다.`,
        kind: "calc",
        importance: z >= 3 ? 3 : 2,
        tag: "price",
        direction: cur.changePct > 0 ? "up" : "down",
        evidence: ev.price,
      });
    }
  }
  // 52주 신고가·신저가 (종가 기준)
  if (cur.priorHigh !== null && cur.close > cur.priorHigh) {
    push({ short: "52주 최고 종가", text: `종가 ${usd(cur.close)}가 직전 52주 최고 종가(${usd(cur.priorHigh)})를 넘어섰습니다.`, kind: "calc", importance: 3, tag: "price", direction: "up", evidence: ev.price });
  } else if (cur.priorLow !== null && cur.close < cur.priorLow) {
    push({ short: "52주 최저 종가", text: `종가 ${usd(cur.close)}가 직전 52주 최저 종가(${usd(cur.priorLow)})보다 낮아졌습니다.`, kind: "calc", importance: 3, tag: "price", direction: "down", evidence: ev.price });
  }
  // 거래량 급증
  if (cur.volRatio !== null && cur.volRatio >= 2 && (prev?.volRatio ?? 0) < 2) {
    push({
      short: `거래량 ${cur.volRatio.toFixed(1)}배`,
      text: `거래량이 직전 20거래일 평균의 ${cur.volRatio.toFixed(1)}배로 늘었습니다. 거래량은 매매 참여가 많았다는 뜻이며 방향을 알려 주지는 않습니다.`,
      kind: "calc",
      importance: cur.volRatio >= 3 ? 3 : 2,
      tag: "volume",
      direction: "neutral",
      evidence: ev.volume,
    });
  }
  if (!prev) return out;
  // 이동평균선 돌파·이탈
  for (const [key, label, imp] of [
    ["sma200", "200일선", 3],
    ["sma50", "50일선", 2],
    ["sma20", "20일선", 1],
  ] as const) {
    const a = prev[key];
    const b = cur[key];
    if (a === null || b === null) continue;
    if (prev.close <= a && cur.close > b) {
      push({ short: `${label} 회복`, text: `종가가 ${label}(${usd(b)}) 위로 올라섰습니다. 전일에는 ${label} 아래였습니다.`, kind: "calc", importance: imp, tag: "technical", direction: "up", evidence: ev.tech });
    } else if (prev.close >= a && cur.close < b) {
      push({ short: `${label} 이탈`, text: `종가가 ${label}(${usd(b)}) 아래로 내려갔습니다. 전일에는 ${label} 위였습니다.`, kind: "calc", importance: imp, tag: "technical", direction: "down", evidence: ev.tech });
    }
  }
  // RSI 구간 변화
  if (prev.rsi !== null && cur.rsi !== null) {
    if (prev.rsi < 70 && cur.rsi >= 70) push({ short: "RSI 과매수권 진입", text: `RSI(14)가 ${prev.rsi.toFixed(1)}에서 ${cur.rsi.toFixed(1)}로 올라 흔히 '과매수'로 분류되는 70 이상 구간에 들어섰습니다. 강한 추세에서는 이 구간이 길게 이어지기도 합니다.`, kind: "interpretation", importance: 2, tag: "technical", direction: "up", evidence: ev.tech });
    else if (prev.rsi >= 70 && cur.rsi < 70) push({ short: "RSI 과매수권 이탈", text: `RSI(14)가 ${cur.rsi.toFixed(1)}로 내려와 70 이상 구간을 벗어났습니다.`, kind: "interpretation", importance: 1, tag: "technical", direction: "down", evidence: ev.tech });
    else if (prev.rsi > 30 && cur.rsi <= 30) push({ short: "RSI 과매도권 진입", text: `RSI(14)가 ${prev.rsi.toFixed(1)}에서 ${cur.rsi.toFixed(1)}로 내려 흔히 '과매도'로 분류되는 30 이하 구간에 들어섰습니다. 하락 추세에서는 이 구간이 이어지기도 합니다.`, kind: "interpretation", importance: 2, tag: "technical", direction: "down", evidence: ev.tech });
    else if (prev.rsi <= 30 && cur.rsi > 30) push({ short: "RSI 과매도권 이탈", text: `RSI(14)가 ${cur.rsi.toFixed(1)}로 올라 30 이하 구간을 벗어났습니다.`, kind: "interpretation", importance: 1, tag: "technical", direction: "up", evidence: ev.tech });
  }
  // MACD 교차
  if (prev.macdDiff !== null && cur.macdDiff !== null) {
    if (prev.macdDiff <= 0 && cur.macdDiff > 0) push({ short: "MACD 상향 교차", text: "MACD 선이 시그널 선을 아래에서 위로 교차했습니다(단기 모멘텀 개선 신호로 흔히 해석).", kind: "interpretation", importance: 2, tag: "technical", direction: "up", evidence: ev.tech });
    else if (prev.macdDiff >= 0 && cur.macdDiff < 0) push({ short: "MACD 하향 교차", text: "MACD 선이 시그널 선을 위에서 아래로 교차했습니다(단기 모멘텀 약화 신호로 흔히 해석).", kind: "interpretation", importance: 2, tag: "technical", direction: "down", evidence: ev.tech });
  }
  // 볼린저 밴드 이탈
  if (cur.bbUpper !== null && prev.bbUpper !== null && cur.close > cur.bbUpper && prev.close <= prev.bbUpper) {
    push({ short: "볼린저 상단 돌파", text: "종가가 볼린저 밴드(20,2) 상단을 넘어섰습니다(최근 변동성 대비 큰 상승).", kind: "interpretation", importance: 1, tag: "technical", direction: "up", evidence: ev.tech });
  } else if (cur.bbLower !== null && prev.bbLower !== null && cur.close < cur.bbLower && prev.close >= prev.bbLower) {
    push({ short: "볼린저 하단 이탈", text: "종가가 볼린저 밴드(20,2) 하단 아래로 내려갔습니다(최근 변동성 대비 큰 하락).", kind: "interpretation", importance: 1, tag: "technical", direction: "down", evidence: ev.tech });
  }
  // 고점 대비 하락 구간 진입·회복
  if (prev.fromHigh !== null && cur.fromHigh !== null) {
    for (const [th, imp, label] of [
      [-20, 3, "흔히 약세장 기준으로 쓰이는 −20%"],
      [-10, 2, "흔히 조정 구간 기준으로 쓰이는 −10%"],
    ] as const) {
      if (prev.fromHigh > th && cur.fromHigh <= th) {
        push({ short: `고점 대비 ${th}% 진입`, text: `종가가 최근 1년 최고 종가 대비 ${pct(cur.fromHigh)}로, ${label} 아래로 내려갔습니다.`, kind: "calc", importance: imp, tag: "risk", direction: "down", evidence: ev.price });
        break;
      }
      if (prev.fromHigh <= th && cur.fromHigh > th) {
        push({ short: `고점 대비 ${th}% 위 회복`, text: `종가가 최근 1년 최고 종가 대비 ${pct(cur.fromHigh)}로, ${th}% 선 위로 회복했습니다.`, kind: "calc", importance: 2, tag: "risk", direction: "up", evidence: ev.price });
        break;
      }
    }
  }
  // 연속 상승·하락 (5일째 되는 날 한 번만)
  if (Math.abs(cur.streak) === 5 || (Math.abs(cur.streak) > 5 && Math.abs(cur.streak) % 5 === 0)) {
    push({ short: `${Math.abs(cur.streak)}일 연속 ${cur.streak > 0 ? "상승" : "하락"}`, text: `${Math.abs(cur.streak)}거래일 연속 ${cur.streak > 0 ? "상승" : "하락"}했습니다(최근 5거래일 ${cur.ret5 !== null ? pct(cur.ret5) : "-"}).`, kind: "calc", importance: 1, tag: "price", direction: cur.streak > 0 ? "up" : "down", evidence: ev.price });
  } else if (Math.abs(prev.streak) >= 5 && Math.sign(prev.streak) !== Math.sign(cur.streak)) {
    push({ short: `${Math.abs(prev.streak)}일 연속 ${prev.streak > 0 ? "상승" : "하락"} 멈춤`, text: `${Math.abs(prev.streak)}거래일 이어지던 연속 ${prev.streak > 0 ? "상승" : "하락"}이 멈췄습니다.`, kind: "calc", importance: 1, tag: "price", direction: cur.streak > 0 ? "up" : "down", evidence: ev.price });
  }
  return out;
}

export function sortChanges(items: ChangeItem[]): ChangeItem[] {
  return [...items].sort((a, b) => b.importance - a.importance);
}

/** 전일 대비 비교표 행 */
export interface CompareRow {
  label: string;
  prev: string;
  cur: string;
  direction: "up" | "down" | "neutral";
}

export function compareRows(prev: SignalState, cur: SignalState): CompareRow[] {
  const rows: CompareRow[] = [];
  const dir = (a: number | null, b: number | null): CompareRow["direction"] => (a === null || b === null || a === b ? "neutral" : b > a ? "up" : "down");
  const rel = (s: SignalState, k: "sma20" | "sma50" | "sma200") => (s[k] !== null ? (s.close / (s[k] as number) - 1) * 100 : null);
  const f = (v: number | null, fn: (x: number) => string) => (v === null ? "-" : fn(v));
  rows.push({ label: "종가", prev: usd(prev.close), cur: usd(cur.close), direction: dir(prev.close, cur.close) });
  rows.push({ label: "RSI(14)", prev: f(prev.rsi, (x) => x.toFixed(1)), cur: f(cur.rsi, (x) => x.toFixed(1)), direction: dir(prev.rsi, cur.rsi) });
  for (const [k, l] of [
    ["sma20", "20일선 대비"],
    ["sma50", "50일선 대비"],
    ["sma200", "200일선 대비"],
  ] as const) {
    const a = rel(prev, k);
    const b = rel(cur, k);
    if (a === null && b === null) continue;
    rows.push({ label: l, prev: f(a, (x) => pct(x)), cur: f(b, (x) => pct(x)), direction: dir(a, b) });
  }
  rows.push({ label: "MACD − 시그널", prev: f(prev.macdDiff, (x) => x.toFixed(3)), cur: f(cur.macdDiff, (x) => x.toFixed(3)), direction: dir(prev.macdDiff, cur.macdDiff) });
  rows.push({ label: "1년 최고 종가 대비", prev: f(prev.fromHigh, (x) => pct(x)), cur: f(cur.fromHigh, (x) => pct(x)), direction: dir(prev.fromHigh, cur.fromHigh) });
  rows.push({ label: "20일 실현 변동성(연환산)", prev: f(prev.vol20, (x) => `${(x * 100).toFixed(1)}%`), cur: f(cur.vol20, (x) => `${(x * 100).toFixed(1)}%`), direction: dir(prev.vol20, cur.vol20) });
  rows.push({ label: "거래량 (20일 평균 대비)", prev: f(prev.volRatio, (x) => `${x.toFixed(2)}배`), cur: f(cur.volRatio, (x) => `${x.toFixed(2)}배`), direction: dir(prev.volRatio, cur.volRatio) });
  return rows;
}
