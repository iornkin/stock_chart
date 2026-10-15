/**
 * 차트에서 고를 수 있는 기술적 지표 목록 (이름·설명·파라미터·패널·필요한 데이터)
 * 계산은 모두 ta.ts 의 같은 함수를 쓴다 → 차트와 전략 백테스트의 값이 같다.
 * 지표는 과거 데이터로 계산한 값일 뿐이며 미래 가격을 알려 주지 않는다.
 */
import * as ta from "./ta";

export type IndGroup = "추세" | "모멘텀" | "변동성" | "거래량";

export interface IndParam {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step?: number;
}

export interface IndLine {
  key: string;
  label: string;
  values: ta.Series;
  style?: "solid" | "dashed" | "dotted" | "hist";
  /** 표시 전용 (미래 데이터를 과거 위치에 그림 → 백테스트에 쓰지 않음) */
  displayOnly?: boolean;
}

export interface IndicatorDef {
  key: string;
  name: string;
  group: IndGroup;
  /** price = 가격 위에 겹침, own = 별도 패널 */
  pane: "price" | "own";
  /** 계산에 필요한 데이터 */
  needs: "close" | "hlc" | "hlcv";
  params: IndParam[];
  /** 기준선 (예: RSI 70·30) */
  levels?: number[];
  /** 값 표시 형식 */
  fmt?: "price" | "osc" | "pct" | "volume";
  /** 한 줄 설명 */
  desc: string;
  /** 계산식과 초기화 */
  formula: string;
  compute(b: ta.Bars & { v: number[] }, p: Record<string, number>, opts?: { sessionKey?: (i: number) => string }): IndLine[];
}

const P = (key: string, label: string, def: number, min: number, max: number, step = 1): IndParam => ({ key, label, def, min, max, step });

export const INDICATORS: IndicatorDef[] = [
  // ── 추세 ──
  { key: "sma", name: "SMA 단순이동평균", group: "추세", pane: "price", needs: "close", params: [P("n", "기간", 20, 2, 400)], fmt: "price", desc: "최근 n개 종가의 평균.", formula: "SMA = Σ종가 ÷ n. 첫 값은 n번째 봉.", compute: (b, p) => [{ key: "sma", label: `SMA${p.n}`, values: ta.sma(b.c, p.n) }] },
  { key: "ema", name: "EMA 지수이동평균", group: "추세", pane: "price", needs: "close", params: [P("n", "기간", 20, 2, 400)], fmt: "price", desc: "최근 가격에 더 큰 비중을 두는 이동평균.", formula: "α = 2/(n+1), 처음 n개 SMA 로 시작해 EMA = α·종가 + (1−α)·직전 EMA.", compute: (b, p) => [{ key: "ema", label: `EMA${p.n}`, values: ta.ema(b.c, p.n), style: "dashed" }] },
  { key: "wma", name: "WMA 가중이동평균", group: "추세", pane: "price", needs: "close", params: [P("n", "기간", 20, 2, 400)], fmt: "price", desc: "최근 봉일수록 가중치가 큰(1..n) 이동평균.", formula: "WMA = Σ(가중치 k × 종가) ÷ (n(n+1)/2), 최근 봉 가중치 n.", compute: (b, p) => [{ key: "wma", label: `WMA${p.n}`, values: ta.wma(b.c, p.n), style: "dotted" }] },
  { key: "vwma", name: "VWMA 거래량 가중 이동평균", group: "추세", pane: "price", needs: "hlcv", params: [P("n", "기간", 20, 2, 400)], fmt: "price", desc: "거래량이 많은 봉의 가격에 더 큰 비중.", formula: "VWMA = Σ(종가 × 거래량) ÷ Σ거래량 (n봉). 거래량 합이 0 이면 계산 안 함.", compute: (b, p) => [{ key: "vwma", label: `VWMA${p.n}`, values: ta.vwma(b.c, b.v, p.n) }] },
  {
    key: "ichimoku",
    name: "일목균형표",
    group: "추세",
    pane: "price",
    needs: "hlc",
    params: [P("conv", "전환선", 9, 2, 100), P("base", "기준선", 26, 2, 200), P("spanB", "선행스팬B", 52, 2, 300), P("shift", "이동", 26, 1, 100)],
    fmt: "price",
    desc: "전환·기준선과 구름(선행스팬). 후행스팬은 26봉 뒤 종가를 과거 위치에 그린 표시 전용 선입니다.",
    formula: "중간값 = (n봉 최고 + n봉 최저) ÷ 2. 선행A = (전환+기준)/2, 선행B = 52봉 중간값, 둘 다 26봉 앞으로 이동(마지막 26봉 뒤의 미래 구간은 그리지 않음).",
    compute: (b, p) => {
      const r = ta.ichimoku(b, p.conv, p.base, p.spanB, p.shift);
      return [
        { key: "tenkan", label: "전환선", values: r.tenkan },
        { key: "kijun", label: "기준선", values: r.kijun },
        { key: "spanA", label: "선행A", values: r.spanA, style: "dotted" },
        { key: "spanB", label: "선행B", values: r.spanB, style: "dotted" },
        { key: "chikou", label: "후행(표시 전용)", values: r.chikou, style: "dashed", displayOnly: true },
      ];
    },
  },
  {
    key: "supertrend",
    name: "Supertrend",
    group: "추세",
    pane: "price",
    needs: "hlc",
    params: [P("n", "ATR 기간", 10, 2, 100), P("m", "배수", 3, 0.5, 10, 0.5)],
    fmt: "price",
    desc: "ATR 로 만든 추세 추종선. 가격 아래면 상승 추세, 위면 하락 추세.",
    formula: "기본 밴드 = (고+저)/2 ± 배수×ATR, 최종 밴드는 직전 밴드보다 불리해지지 않게 유지, 종가가 밴드를 넘으면 방향 전환.",
    compute: (b, p) => [{ key: "st", label: `ST(${p.n},${p.m})`, values: ta.supertrend(b, p.n, p.m).line }],
  },
  {
    key: "adx",
    name: "ADX 추세 강도",
    group: "추세",
    pane: "own",
    needs: "hlc",
    params: [P("n", "기간", 14, 2, 100)],
    levels: [20, 25],
    fmt: "osc",
    desc: "추세의 방향이 아니라 '강도'. 보통 25 이상이면 추세가 뚜렷하다고 봅니다.",
    formula: "+DM·−DM·TR 을 Wilder 평활 → +DI·−DI = 100×DM÷TR, DX = 100×|+DI−−DI|÷(+DI+−DI), ADX = DX 의 Wilder 평활. 첫 ADX 는 2n−1 번째 봉.",
    compute: (b, p) => {
      const r = ta.adx(b, p.n);
      return [
        { key: "adx", label: `ADX${p.n}`, values: r.adx },
        { key: "pdi", label: "+DI", values: r.plusDI, style: "dotted" },
        { key: "mdi", label: "−DI", values: r.minusDI, style: "dotted" },
      ];
    },
  },
  // ── 모멘텀 ──
  { key: "rsi", name: "RSI", group: "모멘텀", pane: "own", needs: "close", params: [P("n", "기간", 14, 2, 100)], levels: [70, 30], fmt: "osc", desc: "최근 상승폭과 하락폭의 비율(0~100). 70 이상 과열, 30 이하 침체로 흔히 봅니다.", formula: "Wilder 평활 평균 상승 ÷ 평균 하락 = RS, RSI = 100 − 100/(1+RS). 첫 값 n번째 봉. 가격 변화가 전혀 없으면 계산 안 함.", compute: (b, p) => [{ key: "rsi", label: `RSI${p.n}`, values: ta.rsi(b.c, p.n) }] },
  {
    key: "macd",
    name: "MACD",
    group: "모멘텀",
    pane: "own",
    needs: "close",
    params: [P("fast", "단기", 12, 2, 100), P("slow", "장기", 26, 3, 200), P("sig", "시그널", 9, 2, 100)],
    levels: [0],
    fmt: "osc",
    desc: "단기·장기 EMA 의 차이와 그 평균(시그널). 히스토그램 = MACD − 시그널.",
    formula: "MACD = EMA(단기) − EMA(장기), 시그널 = MACD 의 EMA (MACD 첫 값부터 다시 초기화).",
    compute: (b, p) => {
      const m = ta.macd(b.c, p.fast, p.slow, p.sig);
      return [
        { key: "hist", label: "히스토그램", values: m.hist, style: "hist" },
        { key: "macd", label: "MACD", values: m.macd },
        { key: "signal", label: "시그널", values: m.signal, style: "dashed" },
      ];
    },
  },
  {
    key: "stoch",
    name: "스토캐스틱",
    group: "모멘텀",
    pane: "own",
    needs: "hlc",
    params: [P("n", "기간", 14, 2, 100), P("k", "%K 평활", 3, 1, 20), P("d", "%D", 3, 1, 20)],
    levels: [80, 20],
    fmt: "osc",
    desc: "n봉 범위 안에서 종가의 위치(0~100).",
    formula: "원값 = 100 × (종가 − n봉 최저) ÷ (최고 − 최저), %K = 원값의 SMA, %D = %K 의 SMA. 최고 = 최저면 계산 안 함.",
    compute: (b, p) => {
      const s = ta.stochastic(b, p.n, p.k, p.d);
      return [
        { key: "k", label: "%K", values: s.k },
        { key: "d", label: "%D", values: s.d, style: "dashed" },
      ];
    },
  },
  {
    key: "stochrsi",
    name: "스토캐스틱 RSI",
    group: "모멘텀",
    pane: "own",
    needs: "close",
    params: [P("rsi", "RSI 기간", 14, 2, 100), P("n", "기간", 14, 2, 100), P("k", "%K", 3, 1, 20), P("d", "%D", 3, 1, 20)],
    levels: [80, 20],
    fmt: "osc",
    desc: "RSI 를 다시 스토캐스틱으로 0~100 정규화한 값. 매우 민감합니다.",
    formula: "원값 = 100 × (RSI − n봉 RSI 최저) ÷ (최고 − 최저), %K·%D 는 SMA.",
    compute: (b, p) => {
      const s = ta.stochRsi(b.c, p.rsi, p.n, p.k, p.d);
      return [
        { key: "k", label: "%K", values: s.k },
        { key: "d", label: "%D", values: s.d, style: "dashed" },
      ];
    },
  },
  { key: "roc", name: "ROC 변화율", group: "모멘텀", pane: "own", needs: "close", params: [P("n", "기간", 12, 1, 250)], levels: [0], fmt: "pct", desc: "n봉 전 대비 종가 변화율(%).", formula: "ROC = 100 × (종가 ÷ n봉 전 종가 − 1).", compute: (b, p) => [{ key: "roc", label: `ROC${p.n}`, values: ta.roc(b.c, p.n) }] },
  { key: "mom", name: "모멘텀", group: "모멘텀", pane: "own", needs: "close", params: [P("n", "기간", 10, 1, 250)], levels: [0], fmt: "price", desc: "n봉 전 대비 가격 차이(달러).", formula: "모멘텀 = 종가 − n봉 전 종가.", compute: (b, p) => [{ key: "mom", label: `MOM${p.n}`, values: ta.momentum(b.c, p.n) }] },
  { key: "cci", name: "CCI", group: "모멘텀", pane: "own", needs: "hlc", params: [P("n", "기간", 20, 2, 200)], levels: [100, -100], fmt: "osc", desc: "평균 가격에서 얼마나 벗어났는지(평균 편차 기준).", formula: "TP = (고+저+종)/3, CCI = (TP − SMA(TP)) ÷ (0.015 × 평균 절대 편차).", compute: (b, p) => [{ key: "cci", label: `CCI${p.n}`, values: ta.cci(b, p.n) }] },
  { key: "willr", name: "Williams %R", group: "모멘텀", pane: "own", needs: "hlc", params: [P("n", "기간", 14, 2, 200)], levels: [-20, -80], fmt: "osc", desc: "n봉 최고가에서 종가가 얼마나 떨어져 있는지(−100~0).", formula: "%R = −100 × (n봉 최고 − 종가) ÷ (최고 − 최저).", compute: (b, p) => [{ key: "wr", label: `%R${p.n}`, values: ta.williamsR(b, p.n) }] },
  {
    key: "trix",
    name: "TRIX",
    group: "모멘텀",
    pane: "own",
    needs: "close",
    params: [P("n", "기간", 15, 2, 100), P("sig", "시그널", 9, 2, 50)],
    levels: [0],
    fmt: "pct",
    desc: "세 번 평활한 EMA 의 하루 변화율(%) — 짧은 흔들림을 걸러 냅니다.",
    formula: "TRIX = 100 × (EMA³ ÷ 직전 EMA³ − 1), 시그널 = TRIX 의 EMA.",
    compute: (b, p) => {
      const t = ta.trix(b.c, p.n, p.sig);
      return [
        { key: "trix", label: `TRIX${p.n}`, values: t.trix },
        { key: "sig", label: "시그널", values: t.signal, style: "dashed" },
      ];
    },
  },
  // ── 변동성 ──
  { key: "atr", name: "ATR 평균 실제 범위", group: "변동성", pane: "own", needs: "hlc", params: [P("n", "기간", 14, 2, 200)], fmt: "price", desc: "하루 움직임 폭의 평균(달러). 갭까지 포함합니다.", formula: "TR = max(고−저, |고−전일 종가|, |저−전일 종가|), ATR = TR 의 Wilder 평활. 첫 값 n번째 봉.", compute: (b, p) => [{ key: "atr", label: `ATR${p.n}`, values: ta.atr(b, p.n) }] },
  {
    key: "bb",
    name: "볼린저 밴드",
    group: "변동성",
    pane: "price",
    needs: "close",
    params: [P("n", "기간", 20, 2, 200), P("k", "표준편차 배수", 2, 0.5, 5, 0.1)],
    fmt: "price",
    desc: "이동평균 ± 표준편차 배수. 변동성이 커지면 밴드가 넓어집니다.",
    formula: "중간 = SMA(n), 상·하단 = 중간 ± k × 모집단 표준편차(n으로 나눔).",
    compute: (b, p) => {
      const r = ta.bollinger(b.c, p.n, p.k);
      return [
        { key: "u", label: "BB 상단", values: r.upper, style: "dotted" },
        { key: "m", label: "BB 중간", values: r.mid, style: "dashed" },
        { key: "l", label: "BB 하단", values: r.lower, style: "dotted" },
      ];
    },
  },
  {
    key: "bbw",
    name: "볼린저 밴드폭·%B",
    group: "변동성",
    pane: "own",
    needs: "close",
    params: [P("n", "기간", 20, 2, 200), P("k", "표준편차 배수", 2, 0.5, 5, 0.1)],
    fmt: "osc",
    desc: "밴드폭(%) = 밴드 넓이 ÷ 중간선, %B = 밴드 안에서 종가의 위치(0=하단, 1=상단).",
    formula: "밴드폭 = (상단 − 하단) ÷ 중간 × 100, %B = (종가 − 하단) ÷ (상단 − 하단).",
    compute: (b, p) => {
      const r = ta.bollinger(b.c, p.n, p.k);
      return [
        { key: "bw", label: "밴드폭(%)", values: r.bandwidth },
        { key: "pb", label: "%B×100", values: r.percentB.map((v) => (v === null ? null : v * 100)), style: "dashed" },
      ];
    },
  },
  { key: "hv", name: "역사적 변동성", group: "변동성", pane: "own", needs: "close", params: [P("n", "기간", 20, 2, 250)], fmt: "pct", desc: "최근 n봉 로그수익률의 연환산 표준편차(%) — 일봉 기준.", formula: "HV = 표본 표준편차(ln(종가/전일 종가)) × √252 × 100.", compute: (b, p) => [{ key: "hv", label: `HV${p.n}`, values: ta.historicalVol(b.c, p.n) }] },
  {
    key: "kc",
    name: "켈트너 채널",
    group: "변동성",
    pane: "price",
    needs: "hlc",
    params: [P("n", "EMA 기간", 20, 2, 200), P("atr", "ATR 기간", 10, 2, 100), P("m", "배수", 2, 0.5, 5, 0.1)],
    fmt: "price",
    desc: "EMA ± ATR 배수.",
    formula: "중간 = EMA(n), 상·하단 = 중간 ± 배수 × ATR.",
    compute: (b, p) => {
      const r = ta.keltner(b, p.n, p.atr, p.m);
      return [
        { key: "u", label: "KC 상단", values: r.upper, style: "dotted" },
        { key: "m", label: "KC 중간", values: r.mid, style: "dashed" },
        { key: "l", label: "KC 하단", values: r.lower, style: "dotted" },
      ];
    },
  },
  {
    key: "dc",
    name: "돈치안 채널",
    group: "변동성",
    pane: "price",
    needs: "hlc",
    params: [P("n", "기간", 20, 2, 300)],
    fmt: "price",
    desc: "n봉 최고가·최저가 채널.",
    formula: "상단 = n봉 최고가, 하단 = n봉 최저가 (현재 봉 포함), 중간 = 평균.",
    compute: (b, p) => {
      const r = ta.donchian(b, p.n);
      return [
        { key: "u", label: "DC 상단", values: r.upper, style: "dotted" },
        { key: "l", label: "DC 하단", values: r.lower, style: "dotted" },
      ];
    },
  },
  // ── 거래량 ──
  { key: "obv", name: "OBV", group: "거래량", pane: "own", needs: "hlcv", params: [], fmt: "volume", desc: "오른 날 거래량은 더하고 내린 날은 빼서 누적.", formula: "OBV = 직전 OBV ± 거래량 (보합이면 그대로), 차트 첫 봉에서 0.", compute: (b) => [{ key: "obv", label: "OBV", values: ta.obv(b.c, b.v) }] },
  { key: "mfi", name: "MFI 자금 흐름 지수", group: "거래량", pane: "own", needs: "hlcv", params: [P("n", "기간", 14, 2, 100)], levels: [80, 20], fmt: "osc", desc: "거래량을 반영한 RSI 와 비슷한 지표(0~100).", formula: "자금 흐름 = TP × 거래량, MFI = 100 − 100/(1 + n봉 양의 흐름 합 ÷ 음의 흐름 합).", compute: (b, p) => [{ key: "mfi", label: `MFI${p.n}`, values: ta.mfi(b, p.n) }] },
  { key: "cmf", name: "Chaikin Money Flow", group: "거래량", pane: "own", needs: "hlcv", params: [P("n", "기간", 20, 2, 100)], levels: [0], fmt: "osc", desc: "종가가 봉의 위쪽에서 끝난 날의 거래량 비중(−1~1).", formula: "배수 = ((종−저) − (고−종)) ÷ (고−저), CMF = Σ(배수×거래량) ÷ Σ거래량.", compute: (b, p) => [{ key: "cmf", label: `CMF${p.n}`, values: ta.cmf(b, p.n) }] },
  { key: "ad", name: "A/D 누적/분산선", group: "거래량", pane: "own", needs: "hlcv", params: [], fmt: "volume", desc: "CMF 의 배수 × 거래량을 계속 더한 선.", formula: "A/D = Σ(배수 × 거래량), 차트 첫 봉부터 누적.", compute: (b) => [{ key: "ad", label: "A/D", values: ta.adLine(b) }] },
  {
    key: "vwap",
    name: "VWAP",
    group: "거래량",
    pane: "price",
    needs: "hlcv",
    params: [P("n", "기간(일봉 이상)", 20, 2, 200)],
    fmt: "price",
    desc: "거래량 가중 평균 가격. 분봉은 거래일마다 새로 시작, 일봉 이상은 최근 n봉 이동 VWAP.",
    formula: "VWAP = Σ(TP × 거래량) ÷ Σ거래량, TP = (고+저+종)/3.",
    compute: (b, p, o) => [{ key: "vwap", label: o?.sessionKey ? "VWAP(세션)" : `VWAP(${p.n}봉)`, values: o?.sessionKey ? ta.sessionVwap(b, o.sessionKey) : ta.rollingVwap(b, p.n) }],
  },
];

export const INDICATOR_BY_KEY = new Map(INDICATORS.map((d) => [d.key, d]));

/** 파라미터를 정의 범위 안으로 (모르는 키는 버림) */
export function cleanParams(def: IndicatorDef, p: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of def.params) {
    const v = Number(p?.[x.key]);
    out[x.key] = Number.isFinite(v) ? Math.min(x.max, Math.max(x.min, v)) : x.def;
  }
  return out;
}

export function defaultParams(def: IndicatorDef): Record<string, number> {
  return Object.fromEntries(def.params.map((x) => [x.key, x.def]));
}
