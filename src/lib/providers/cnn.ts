/**
 * CNN Business 공포·탐욕 지수 (Fear & Greed Index)
 * - CNN 시장 페이지가 쓰는 JSON (production.dataviz.cnn.io). 공식 API 가 아니며 브라우저 User-Agent 가 없으면 418 로 거절한다.
 * - CNN 이 7개 지표를 같은 비중으로 합쳐 0~100 으로 만든 지수다. 이 사이트는 다시 계산하지 않고 CNN 값을 그대로 쓴다.
 * - 일별 기록은 UTC 0시 시각의 점(그날의 마지막 값)이고, 맨 끝의 시각이 붙은 점은 지금 값이다.
 *   장 마감 뒤에도 일부 구성 지표가 늦게 갱신되어 그날 값이 바뀔 수 있어 매번 전체 기록을 다시 받아 덮어쓴다.
 */
import { env } from "../env";
import { BROWSER_UA, ProviderError, requestJson } from "../http";

const P = "cnn";
const DAY = 86400_000;

export const FG_RATINGS = ["extreme fear", "fear", "neutral", "greed", "extreme greed"] as const;
export type FgRating = (typeof FG_RATINGS)[number];

/** 구성 지표 — src 의 첫 키가 점수·판정을 가진 항목, 나머지는 함께 보여 줄 원값(이동평균 등) */
export const FG_COMPONENTS = [
  { key: "momentum", src: ["market_momentum_sp500", "market_momentum_sp125"], label: "시장 모멘텀", what: "S&P 500 과 125일 이동평균", unit: "pt" },
  { key: "strength", src: ["stock_price_strength"], label: "주가 강도", what: "NYSE 52주 신고가·신저가 종목 차이 (CNN 산출값)", unit: "raw" },
  { key: "breadth", src: ["stock_price_breadth"], label: "시장 폭", what: "McClellan 거래량 합산 지수 (상승·하락 종목 거래량)", unit: "raw" },
  { key: "put_call", src: ["put_call_options"], label: "풋·콜 옵션", what: "풋/콜 비율 5일 평균", unit: "ratio" },
  { key: "volatility", src: ["market_volatility_vix", "market_volatility_vix_50"], label: "시장 변동성", what: "VIX 와 50일 이동평균", unit: "pt" },
  { key: "junk_bond", src: ["junk_bond_demand"], label: "정크본드 수요", what: "투기등급 − 투자등급 채권 수익률 차", unit: "pp" },
  { key: "safe_haven", src: ["safe_haven_demand"], label: "안전자산 수요", what: "최근 20거래일 주식 수익률 − 국채 수익률", unit: "pp" },
] as const;
export type FgComponentKey = (typeof FG_COMPONENTS)[number]["key"];

export interface FgPoint {
  /** UTC 날짜 (CNN 일별 기록의 날짜) */
  date: string;
  score: number;
  rating: FgRating | null;
}

export interface FgComponent {
  key: FgComponentKey;
  score: number | null;
  rating: FgRating | null;
  /** CNN 이 이 지표를 마지막으로 갱신한 시각 (ms) */
  at: number | null;
  /** src 순서대로 가장 최근 원값 */
  values: (number | null)[];
}

export interface FearGreed {
  score: number;
  rating: FgRating | null;
  at: number;
  /** CNN 이 함께 주는 비교 값 */
  previous: { close: number | null; week: number | null; month: number | null; year: number | null };
  history: FgPoint[];
  components: FgComponent[];
  /** 범위 밖·숫자 아님으로 버린 일별 점 수 */
  invalidPoints: number;
}

export function normalizeRating(v: unknown): FgRating | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (FG_RATINGS as readonly string[]).includes(s) ? (s as FgRating) : null;
}

const validScore = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const scoreOrNull = (v: unknown) => (validScore(v) ? v : null);
const finiteOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const dataOf = (v: unknown): Obj[] => (isObj(v) && Array.isArray(v.data) ? (v.data as unknown[]).filter(isObj) : []);

export function parseFearGreed(json: unknown): FearGreed {
  if (!isObj(json) || !isObj(json.fear_and_greed)) throw new ProviderError(P, "응답에 fear_and_greed 항목이 없습니다 (형식 변경 가능성)");
  const fg = json.fear_and_greed;
  if (!validScore(fg.score)) throw new ProviderError(P, `지수 값이 0~100 범위의 숫자가 아닙니다: ${String(fg.score)}`);
  const at = parseTime(fg.timestamp);
  if (at === null) throw new ProviderError(P, "지수 기준 시각이 없습니다");

  // 일별 기록: UTC 0시 점만 (끝의 '지금 값' 점은 시각이 붙어 있어 제외). 같은 날짜가 두 번이면 뒤의 것.
  const raw = dataOf(json.fear_and_greed_historical);
  const byDate = new Map<string, FgPoint>();
  let invalid = 0;
  let daily = 0;
  for (const d of raw) {
    const x = finiteOrNull(d.x);
    if (x === null) {
      invalid++;
      continue;
    }
    if (x % DAY !== 0) continue;
    daily++;
    if (!validScore(d.y)) {
      invalid++;
      continue;
    }
    const date = new Date(x).toISOString().slice(0, 10);
    byDate.set(date, { date, score: d.y, rating: normalizeRating(d.rating) });
  }
  if (daily && invalid / daily > 0.05) throw new ProviderError(P, `일별 기록 ${daily}개 중 ${invalid}개가 잘못된 값 — 형식 변경 가능성`);

  const components: FgComponent[] = FG_COMPONENTS.map((c) => {
    const head = json[c.src[0]];
    const values = c.src.map((k) => {
      const pts = dataOf(json[k]);
      for (let i = pts.length - 1; i >= 0; i--) {
        const y = finiteOrNull(pts[i].y);
        if (y !== null) return y;
      }
      return null;
    });
    return {
      key: c.key,
      score: isObj(head) ? scoreOrNull(head.score) : null,
      rating: isObj(head) ? normalizeRating(head.rating) : null,
      at: isObj(head) ? parseTime(head.timestamp) : null,
      values,
    };
  });

  return {
    score: fg.score,
    rating: normalizeRating(fg.rating),
    at,
    previous: { close: scoreOrNull(fg.previous_close), week: scoreOrNull(fg.previous_1_week), month: scoreOrNull(fg.previous_1_month), year: scoreOrNull(fg.previous_1_year) },
    history: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    components,
    invalidPoints: invalid,
  };
}

/** startDate 를 주면 그날부터의 기록 (약 2년 전까지 확인됨, 너무 이르면 CNN 이 500 을 준다), 없으면 최근 약 1년 */
export async function fetchFearGreed(startDate?: string): Promise<FearGreed> {
  const url = `${env.cnnBase}/index/fearandgreed/graphdata${startDate ? `/${startDate}` : ""}`;
  const json = await requestJson(P, url, { headers: { "User-Agent": BROWSER_UA, Referer: "https://www.cnn.com/" }, retries: startDate ? 0 : 2 });
  return parseFearGreed(json);
}
