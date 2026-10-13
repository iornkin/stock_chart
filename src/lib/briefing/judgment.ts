/**
 * 종목별 종합 판단 (규칙 기반)
 * 추세·모멘텀·상대강도 세 항목을 −1/0/+1 로 매겨 합산하고, 과열·위험·일정은 별도 주의 사항으로 보여 준다.
 * 과거 가격 데이터의 해석일 뿐 미래 수익 예측이나 매수·매도 권유가 아니다.
 */
import type { SignalState } from "./signals";

export type Stance = "bullish" | "mild_bullish" | "neutral" | "mild_bearish" | "bearish" | "unavailable";

export interface JudgmentFactor {
  key: "trend" | "momentum" | "relative" | "volume";
  label: string;
  score: -1 | 0 | 1 | null;
  verdict: string;
  text: string;
  evidence: string[];
}

export interface Judgment {
  method: "rules";
  stance: Stance;
  label: string;
  score: number;
  maxScore: number;
  summary: string;
  factors: JudgmentFactor[];
  cautions: string[];
  risk: { level: "high" | "normal" | "low"; text: string };
  watch: string[];
  income: string[];
  note: string;
}

export const STANCE_LABEL: Record<Stance, string> = {
  bullish: "상승 우위",
  mild_bullish: "약한 상승 우위",
  neutral: "중립 (방향성 약함)",
  mild_bearish: "약한 하락 우위",
  bearish: "하락 우위",
  unavailable: "판단 보류 (데이터 부족)",
};

export interface JudgmentInput {
  symbol: string;
  cur: SignalState | null;
  /** 같은 20거래일 동안 기준 지수 수익률 (%) */
  bench20: { symbol: string; ret: number } | null;
  leverage?: number;
  coveredCall: boolean;
  levels: { kind: "support" | "resistance"; price: number }[];
  nextEarnings: { date: string; daysAway: number } | null;
  nextExDate: { date: string; amount: number } | null;
  income: { ttmYield: number | null; ttmChangePct: number | null; word: string } | null;
  evidence: { price: string[]; tech: string[]; bench: string[]; volume: string[] };
}

const pct = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildJudgment(i: JudgmentInput): Judgment {
  const note = "사이트가 정한 규칙(추세·모멘텀·상대강도)으로 과거 가격 데이터를 해석한 결과입니다. 미래 수익을 예측하거나 매수·매도를 권유하지 않습니다.";
  const c = i.cur;
  if (!c || c.sma50 === null) {
    return {
      method: "rules",
      stance: "unavailable",
      label: STANCE_LABEL.unavailable,
      score: 0,
      maxScore: 3,
      summary: "판단에 필요한 일봉 데이터(최소 50거래일)가 부족해 종합 판단을 내리지 않았습니다.",
      factors: [],
      cautions: [],
      risk: { level: "normal", text: "데이터 부족" },
      watch: [],
      income: [],
      note,
    };
  }
  const factors: JudgmentFactor[] = [];

  // 1) 중기 추세 구조
  if (c.sma200 !== null) {
    const above = c.close > c.sma200;
    const golden = c.sma50 > c.sma200;
    const score = above && golden ? 1 : !above && !golden ? -1 : 0;
    factors.push({
      key: "trend",
      label: "중기 추세",
      score,
      verdict: score > 0 ? "상승 구조" : score < 0 ? "하락 구조" : "혼조",
      text: `종가가 200일선(${usd(c.sma200)}) ${above ? "위" : "아래"}, 50일선(${usd(c.sma50)})이 200일선 ${golden ? "위" : "아래"}에 있습니다.`,
      evidence: i.evidence.tech,
    });
  } else {
    const above = c.close > c.sma50;
    factors.push({
      key: "trend",
      label: "중기 추세",
      score: above ? 1 : -1,
      verdict: above ? "50일선 위" : "50일선 아래",
      text: `200일 데이터가 부족해 50일선(${usd(c.sma50)}) 기준으로만 봤습니다. 종가는 50일선 ${above ? "위" : "아래"}입니다.`,
      evidence: i.evidence.tech,
    });
  }

  // 2) 단기 모멘텀
  if (c.ret20 !== null && c.macdDiff !== null) {
    const up = c.ret20 > 0 && c.macdDiff > 0;
    const down = c.ret20 < 0 && c.macdDiff < 0;
    factors.push({
      key: "momentum",
      label: "단기 모멘텀",
      score: up ? 1 : down ? -1 : 0,
      verdict: up ? "개선" : down ? "약화" : "엇갈림",
      text: `최근 20거래일 ${pct(c.ret20)}, MACD 선이 시그널 선 ${c.macdDiff > 0 ? "위" : "아래"}에 있습니다.`,
      evidence: [...i.evidence.price, ...i.evidence.tech],
    });
  }

  // 3) 상대강도 (레버리지 ETF 는 기준 지수 대비 강도를 따로 보지 않음)
  if (i.bench20 && c.ret20 !== null) {
    if (i.leverage) {
      const exp = i.bench20.ret * i.leverage;
      factors.push({
        key: "relative",
        label: "기준 지수 배수 대비",
        score: null,
        verdict: "점수 제외",
        text: `최근 20거래일 ${pct(c.ret20)} vs 기준 지수(${i.bench20.symbol}) × ${i.leverage} = ${pct(exp)} (${pct(c.ret20 - exp)}p 차이). 레버리지 ETF 는 방향을 기준 지수가 결정하므로 점수에 넣지 않습니다.`,
        evidence: i.evidence.bench,
      });
    } else {
      const diff = c.ret20 - i.bench20.ret;
      const score = diff >= 3 ? 1 : diff <= -3 ? -1 : 0;
      factors.push({
        key: "relative",
        label: "상대강도 (20일)",
        score,
        verdict: score > 0 ? "기준 지수보다 강함" : score < 0 ? "기준 지수보다 약함" : "비슷함",
        text: `최근 20거래일 ${pct(c.ret20)} vs ${i.bench20.symbol} ${pct(i.bench20.ret)} (${pct(diff)}p).`,
        evidence: [...i.evidence.price, ...i.evidence.bench],
      });
    }
  }

  // 4) 거래량 동반 여부 (점수 제외, 참고)
  if (c.volRatio !== null && c.changePct !== null && Math.abs(c.changePct) >= 0.5) {
    const strong = c.volRatio >= 1.5;
    factors.push({
      key: "volume",
      label: "거래량",
      score: null,
      verdict: strong ? `평균의 ${c.volRatio.toFixed(1)}배 동반` : "평균 수준 이하",
      text: `오늘 ${c.changePct > 0 ? "상승" : "하락"}(${pct(c.changePct, 2)})에 거래량은 20일 평균의 ${c.volRatio.toFixed(2)}배였습니다${strong ? " — 많은 매매가 참여한 움직임입니다" : ""}.`,
      evidence: i.evidence.volume,
    });
  }

  const scored = factors.filter((f) => f.score !== null);
  const score = scored.reduce((a, f) => a + (f.score as number), 0);
  const maxScore = scored.length;
  const stance: Stance = score >= 2 ? "bullish" : score === 1 ? "mild_bullish" : score === 0 ? "neutral" : score === -1 ? "mild_bearish" : "bearish";

  // 주의 사항
  const cautions: string[] = [];
  if (c.rsi !== null && c.rsi >= 70) cautions.push(`RSI ${c.rsi.toFixed(1)} — 단기 과열 구간입니다. 추세가 강해도 단기 되돌림이 나올 수 있습니다.`);
  if (c.rsi !== null && c.rsi <= 30) cautions.push(`RSI ${c.rsi.toFixed(1)} — 단기 과매도 구간입니다. 하락 추세에서는 이 구간이 이어지기도 합니다.`);
  if (i.nextEarnings && i.nextEarnings.daysAway <= 7) cautions.push(`${i.nextEarnings.date} 실적 발표 예정(${i.nextEarnings.daysAway === 0 ? "오늘" : `${i.nextEarnings.daysAway}일 후`}) — 발표 전후 변동성이 커질 수 있습니다.`);
  if (i.leverage) cautions.push(`${i.leverage}배 레버리지 ETF 입니다. 하루 목표 배수는 하루 단위로만 적용되며, 여러 날 보유하면 기준 지수 수익률 × ${i.leverage}와 달라집니다.`);
  if (i.coveredCall) cautions.push("옵션(콜 매도) 전략 상품이라 기준 지수가 크게 오를 때 상승 참여가 제한될 수 있습니다.");

  // 위험 수준 (변동성·고점 대비)
  let level: Judgment["risk"]["level"] = "normal";
  const vr = c.vol20 !== null && c.vol250 ? c.vol20 / c.vol250 : null;
  if ((vr !== null && vr >= 1.3) || (c.fromHigh !== null && c.fromHigh <= -20) || (i.leverage ?? 1) >= 3) level = "high";
  else if (vr !== null && vr <= 0.8 && (c.fromHigh ?? 0) > -10 && !i.leverage) level = "low";
  const riskText = [
    c.vol20 !== null ? `20일 변동성 ${(c.vol20 * 100).toFixed(1)}%${c.vol250 ? ` (1년 평균 ${(c.vol250 * 100).toFixed(1)}%)` : ""}` : null,
    c.fromHigh !== null ? `1년 최고 종가 대비 ${pct(c.fromHigh)}` : null,
    i.leverage ? `${i.leverage}배 레버리지` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // 확인할 가격·일정
  const watch: string[] = [];
  if (c.sma50 !== null) watch.push(`50일선 ${usd(c.sma50)} ${c.close >= c.sma50 ? "위 유지 여부" : "회복 여부"}`);
  if (c.sma200 !== null) watch.push(`200일선 ${usd(c.sma200)} ${c.close >= c.sma200 ? "위 유지 여부" : "회복 여부"}`);
  const sup = i.levels.filter((l) => l.kind === "support" && l.price < c.close).sort((a, b) => b.price - a.price)[0];
  const res = i.levels.filter((l) => l.kind === "resistance" && l.price > c.close).sort((a, b) => a.price - b.price)[0];
  if (sup || res) watch.push(`최근 스윙 기준 ${sup ? `지지 후보 ${usd(sup.price)}` : ""}${sup && res ? " / " : ""}${res ? `저항 후보 ${usd(res.price)}` : ""}`);
  if (i.nextEarnings) watch.push(`실적 발표 ${i.nextEarnings.date}`);
  if (i.nextExDate) watch.push(`배당락일 ${i.nextExDate.date} (주당 $${i.nextExDate.amount.toFixed(4).replace(/0{1,2}$/, "")}, 발표 기준)`);

  // 인컴 상품 관점
  const income: string[] = [];
  if (i.income) {
    if (i.income.ttmYield !== null) income.push(`최근 12개월 실제 지급 ${i.income.word} 기준 수익률(TTM) ${i.income.ttmYield.toFixed(2)}%`);
    if (i.income.ttmChangePct !== null)
      income.push(`최근 12개월 ${i.income.word} 합계는 그 전 12개월보다 ${pct(i.income.ttmChangePct)} ${i.income.ttmChangePct >= 0 ? "많습니다" : "적습니다"}`);
  }

  // 한 문단 요약
  const t = factors.find((f) => f.key === "trend");
  const m = factors.find((f) => f.key === "momentum");
  const r = factors.find((f) => f.key === "relative");
  const parts: string[] = [];
  if (t) parts.push(t.score === 1 ? "중기 추세는 상승 구조" : t.score === -1 ? "중기 추세는 하락 구조" : "중기 추세는 방향이 엇갈리는 상태");
  if (m) parts.push(m.score === 1 ? "단기 모멘텀은 개선되는 흐름" : m.score === -1 ? "단기 모멘텀은 약해지는 흐름" : "단기 모멘텀은 뚜렷하지 않음");
  if (r && r.score !== null) parts.push(r.score === 1 ? "기준 지수보다 강한 흐름" : r.score === -1 ? "기준 지수보다 약한 흐름" : "기준 지수와 비슷한 흐름");
  let summary = `${parts.join(", ")}입니다. 규칙 점수 ${score > 0 ? "+" : ""}${score} / ${maxScore}로 '${STANCE_LABEL[stance]}'으로 분류됩니다.`;
  if (cautions.length && (c.rsi ?? 50) >= 70 && score > 0) summary += " 다만 단기 과열 신호가 함께 나타나 있습니다.";
  if (cautions.length && (c.rsi ?? 50) <= 30 && score < 0) summary += " 다만 단기 과매도 구간이라 되돌림 가능성도 함께 봐야 합니다.";

  return { method: "rules", stance, label: STANCE_LABEL[stance], score, maxScore, summary, factors, cautions, risk: { level, text: riskText }, watch, income, note };
}
