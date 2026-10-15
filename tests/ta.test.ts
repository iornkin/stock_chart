/**
 * 기술적 지표 기준값 테스트 — 기대값은 주석의 손계산(또는 공개된 계산 예시)
 * + 속성 테스트: 미래 데이터가 과거 값을 바꾸지 않음, 누락·NaN·무한대·큰 수에서 NaN 이 나오지 않음
 */
import { describe, expect, it } from "vitest";
import * as ta from "@/lib/ta";
import { mulberry32 } from "@/lib/sim/metrics";

const close = (xs: (number | null)[], ys: (number | null)[], d = 6) => {
  expect(xs.length).toBe(ys.length);
  xs.forEach((x, i) => {
    if (ys[i] === null) expect(x, `#${i}`).toBeNull();
    else expect(x as number, `#${i}`).toBeCloseTo(ys[i] as number, d);
  });
};

// 작은 봉 데이터 (손계산용)
const B = { h: [10, 12, 11, 15], l: [9, 10, 9, 12], c: [9.5, 11, 10, 14], v: [100, 200, 300, 400] };

describe("이동평균", () => {
  it("SMA: 첫 값 n−1 번째, 창 안 누락이면 null", () => {
    close(ta.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
    close(ta.sma([1, 2, NaN, 4, 5, 6], 2), [null, 1.5, null, null, 4.5, 5.5]);
  });
  it("EMA: SMA 로 시작, α = 2/(n+1); 누락 뒤에는 다시 초기화", () => {
    // n=3 → α=0.5: 2, 0.5·4+0.5·2=3, 4, 5
    close(ta.ema([1, 2, 3, 4, 5, 6], 3), [null, null, 2, 3, 4, 5]);
    close(ta.ema([1, 2, 3, NaN, 5, 6, 7, 8], 3), [null, null, 2, null, null, null, 6, 7]);
  });
  it("WMA: 가중치 1..n", () => {
    close(ta.wma([1, 2, 3, 4], 3), [null, null, 14 / 6, 20 / 6]);
  });
  it("VWMA: Σ종가×거래량 ÷ Σ거래량, 거래량 합 0 이면 null", () => {
    close(ta.vwma([10, 20, 30], [1, 2, 0], 2), [null, 50 / 3, 20]);
    close(ta.vwma([10, 20], [0, 0], 2), [null, null]);
  });
});

describe("모멘텀", () => {
  it("RSI(14) — Wilder 공개 예시 (StockCharts 표와 0.1 이내, 반올림 차이)", () => {
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const r = ta.rsi(c, 14);
    expect(r.slice(0, 14).every((x) => x === null)).toBe(true);
    const got = r.slice(14) as number[];
    [70.46, 66.25, 66.48, 69.35, 66.29, 57.92].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 1));
    [70.53, 66.32, 66.55, 69.41, 66.36, 57.97].forEach((v, i) => expect(Math.abs(got[i] - v)).toBeLessThan(0.1));
  });
  it("RSI: 계속 오르면 100, 계속 내리면 0, 변화 없으면 정의되지 않음(null)", () => {
    expect(ta.rsi([1, 2, 3, 4, 5], 3).slice(3)).toEqual([100, 100]);
    expect(ta.rsi([5, 4, 3, 2, 1], 3).slice(3)).toEqual([0, 0]);
    expect(ta.rsi([1, 1, 1, 1, 1], 3).every((x) => x === null)).toBe(true);
  });
  it("MACD: 라인 첫 값 25 번째, 시그널 33 번째, 히스토그램 = 라인 − 시그널", () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
    const m = ta.macd(c, 12, 26, 9);
    expect(m.macd.findIndex((x) => x !== null)).toBe(25);
    expect(m.signal.findIndex((x) => x !== null)).toBe(33);
    const e12 = ta.ema(c, 12);
    const e26 = ta.ema(c, 26);
    expect(m.macd[40] as number).toBeCloseTo((e12[40] as number) - (e26[40] as number), 12);
    expect(m.hist[40] as number).toBeCloseTo((m.macd[40] as number) - (m.signal[40] as number), 12);
  });
  it("스토캐스틱·Williams %R (n=3)", () => {
    // 2번째: 최고 12, 최저 9 → (10−9)/3 = 33.33 / %R = −100×(12−10)/3 = −66.67
    // 3번째: 최고 15, 최저 9 → (14−9)/6 = 83.33 / %R = −16.67
    const s = ta.stochastic(B, 3, 1, 2);
    close(s.k, [null, null, 100 / 3, 250 / 3]);
    close(s.d, [null, null, null, (100 / 3 + 250 / 3) / 2]);
    close(ta.williamsR(B, 3), [null, null, -200 / 3, -100 / 6]);
    // 최고 = 최저 → null
    expect(ta.stochastic({ h: [5, 5, 5], l: [5, 5, 5], c: [5, 5, 5] }, 3, 1, 1).k[2]).toBeNull();
  });
  it("CCI (n=3): TP 9.5, 11, 10, 13.667", () => {
    // 2번째: 평균 10.1667, 평균편차 0.5556 → (10 − 10.1667)/(0.015×0.5556) = −20
    // 3번째: 평균 11.5556, 평균편차 1.4074 → 100
    close(ta.cci(B, 3), [null, null, -20, 100], 4);
    expect(ta.cci({ h: [5, 5, 5], l: [5, 5, 5], c: [5, 5, 5] }, 3)[2]).toBeNull();
  });
  it("ROC·모멘텀", () => {
    close(ta.roc([10, 11, 12, 9], 2), [null, null, 20, (9 / 11 - 1) * 100]);
    close(ta.momentum([10, 11, 12, 9], 2), [null, null, 2, -2]);
  });
  it("TRIX: 첫 값 3(n−1)+1 번째, 일정하게 오르면 양수", () => {
    const c = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
    const t = ta.trix(c, 4, 3);
    expect(t.trix.findIndex((x) => x !== null)).toBe(10);
    expect(t.trix[29] as number).toBeCloseTo(1, 4); // 1% 복리 → EMA³ 도 매 봉 1% 에 수렴 (초기 SMA 시작값 영향만 남음)
  });
  it("Stochastic RSI: 0~100 범위", () => {
    const c = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 4) * 8);
    const s = ta.stochRsi(c, 14, 14, 3, 3);
    const vals = s.k.filter((x): x is number => x !== null);
    expect(vals.length).toBeGreaterThan(20);
    expect(vals.every((x) => x >= 0 && x <= 100)).toBe(true);
  });
});

describe("변동성", () => {
  it("TR·ATR(2): TR 1, 2.5, 2, 5 → ATR 1.75, 1.875, 3.4375", () => {
    close(ta.trueRange(B), [1, 2.5, 2, 5]);
    close(ta.atr(B, 2), [null, 1.75, 1.875, 3.4375]);
  });
  it("볼린저(5, 2): 모집단 표준편차 √2, 밴드폭·%B", () => {
    const b = ta.bollinger([1, 2, 3, 4, 5], 5, 2);
    expect(b.mid[4]).toBe(3);
    expect(b.upper[4] as number).toBeCloseTo(3 + 2 * Math.SQRT2, 12);
    expect(b.lower[4] as number).toBeCloseTo(3 - 2 * Math.SQRT2, 12);
    expect(b.bandwidth[4] as number).toBeCloseTo(((4 * Math.SQRT2) / 3) * 100, 10);
    expect(b.percentB[4] as number).toBeCloseTo((5 - (3 - 2 * Math.SQRT2)) / (4 * Math.SQRT2), 12);
    // 가격이 일정 → 폭 0, %B 정의 안 됨
    const f = ta.bollinger([5, 5, 5], 3, 2);
    expect(f.bandwidth[2]).toBe(0);
    expect(f.percentB[2]).toBeNull();
  });
  it("역사적 변동성: 로그수익률이 일정하면 0, 첫 값 n 번째", () => {
    const c = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
    const hv = ta.historicalVol(c, 20);
    expect(hv.findIndex((x) => x !== null)).toBe(20);
    expect(hv[29] as number).toBeCloseTo(0, 9);
  });
  it("돈치안·켈트너", () => {
    const d = ta.donchian(B, 2);
    close(d.upper, [null, 12, 12, 15]);
    close(d.lower, [null, 9, 9, 9]);
    const k = ta.keltner(B, 2, 2, 2);
    const e = ta.ema(B.c, 2);
    const a = ta.atr(B, 2);
    expect(k.upper[3] as number).toBeCloseTo((e[3] as number) + 2 * (a[3] as number), 12);
  });
});

describe("추세", () => {
  it("ADX: 꾸준히 오르는 봉 → +DI 100, −DI 0, ADX 100; 첫 ADX 2n−1 번째", () => {
    const n = 5;
    const len = 30;
    const b = { h: Array.from({ length: len }, (_, i) => 11 + i), l: Array.from({ length: len }, (_, i) => 9 + i), c: Array.from({ length: len }, (_, i) => 10.5 + i) };
    const r = ta.adx(b, n);
    expect(r.plusDI.findIndex((x) => x !== null)).toBe(n);
    expect(r.adx.findIndex((x) => x !== null)).toBe(2 * n - 1);
    expect(r.minusDI[20]).toBe(0);
    expect(r.adx[20] as number).toBeCloseTo(100, 9);
  });
  it("일목균형표: 선행스팬은 26봉 전 값을 지금 자리에, 후행스팬(표시 전용)은 26봉 뒤 종가", () => {
    const len = 120;
    const b = { h: Array.from({ length: len }, (_, i) => 101 + Math.sin(i / 5) * 3), l: Array.from({ length: len }, (_, i) => 99 + Math.sin(i / 5) * 3), c: Array.from({ length: len }, (_, i) => 100 + Math.sin(i / 5) * 3) };
    const r = ta.ichimoku(b);
    const a90 = ((r.tenkan[64] as number) + (r.kijun[64] as number)) / 2;
    expect(r.spanA[90] as number).toBeCloseTo(a90, 12);
    expect(r.chikou[10]).toBe(b.c[36]);
    expect(r.chikou[len - 1]).toBeNull();
  });
  it("Supertrend: 강한 상승에서는 상승(1)이고 선이 가격 아래", () => {
    const len = 60;
    const b = { h: Array.from({ length: len }, (_, i) => 101 + i * 2), l: Array.from({ length: len }, (_, i) => 99 + i * 2), c: Array.from({ length: len }, (_, i) => 100.5 + i * 2) };
    const s = ta.supertrend(b, 10, 3);
    expect(s.dir[59]).toBe(1);
    expect(s.line[59] as number).toBeLessThan(b.c[59]);
    expect(s.line.findIndex((x) => x !== null)).toBe(9);
  });
});

describe("거래량", () => {
  it("OBV: 0, +200, 그대로, −400", () => {
    close(ta.obv([10, 11, 11, 9], [100, 200, 300, 400]), [0, 200, 200, -200]);
  });
  it("MFI(2): 양 2200 / 음 3000 → 42.31, 양 5466.7 / 음 3000 → 64.57", () => {
    const r = ta.mfi(B, 2);
    expect(r[1]).toBeNull();
    expect(r[2] as number).toBeCloseTo(100 - 100 / (1 + 2200 / 3000), 9);
    expect(r[3] as number).toBeCloseTo(100 - 100 / (1 + ((41 / 3) * 400) / 3000), 9);
  });
  it("CMF(2)·A/D: 배수 0, 0, 0, 1/3", () => {
    close(ta.cmf(B, 2), [null, 0, 0, 400 / 3 / 700]);
    close(ta.adLine(B), [0, 0, 0, 400 / 3]);
    expect(ta.cmf({ ...B, v: [0, 0, 0, 0] }, 2)[3]).toBeNull();
  });
  it("VWAP: 이동 n봉, 세션은 날짜가 바뀌면 다시", () => {
    const tp = B.c.map((_, i) => (B.h[i] + B.l[i] + B.c[i]) / 3);
    expect(ta.rollingVwap(B, 2)[1] as number).toBeCloseTo((tp[0] * 100 + tp[1] * 200) / 300, 12);
    const sv = ta.sessionVwap(B, (i) => (i < 2 ? "d1" : "d2"));
    expect(sv[2] as number).toBeCloseTo(tp[2], 12);
  });
});

describe("데이터 정리", () => {
  it("정렬·중복·비정상 봉", () => {
    const r = ta.cleanBars([
      { t: 3, o: 1, h: 2, l: 1, c: 1.5, v: 10 },
      { t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 10 },
      { t: 1, o: 1, h: 2, l: 1, c: 1.6, v: 11 },
      { t: 2, o: 1, h: 1, l: 2, c: 1.5, v: 10 },
    ]);
    expect(r.unsorted).toBe(true);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toBe(1);
    expect(r.bars.map((b) => b.t)).toEqual([1, 2, 3]);
    expect(r.bars[0].c).toBe(1.6);
    expect(Number.isNaN(r.bars[1].c)).toBe(true);
  });
});

// ───────────── 속성 테스트 ─────────────
function randomBars(seed: number, len: number) {
  const rnd = mulberry32(seed);
  let p = 50 + rnd() * 100;
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < len; i++) {
    p *= 1 + (rnd() - 0.5) * 0.06;
    const hi = p * (1 + rnd() * 0.02);
    const lo = p * (1 - rnd() * 0.02);
    h.push(hi);
    l.push(lo);
    c.push(lo + (hi - lo) * rnd());
    v.push(Math.floor(rnd() * 1e6));
  }
  return { h, l, c, v };
}

type Calc = (b: { h: number[]; l: number[]; c: number[]; v: number[] }) => (number | null)[][];
const ALL: Record<string, Calc> = {
  sma: (b) => [ta.sma(b.c, 10)],
  ema: (b) => [ta.ema(b.c, 10)],
  wma: (b) => [ta.wma(b.c, 10)],
  vwma: (b) => [ta.vwma(b.c, b.v, 10)],
  rsi: (b) => [ta.rsi(b.c, 14)],
  macd: (b) => Object.values(ta.macd(b.c)),
  stoch: (b) => Object.values(ta.stochastic(b)),
  stochRsi: (b) => Object.values(ta.stochRsi(b.c)),
  roc: (b) => [ta.roc(b.c, 12)],
  mom: (b) => [ta.momentum(b.c, 10)],
  cci: (b) => [ta.cci(b, 20)],
  wr: (b) => [ta.williamsR(b, 14)],
  trix: (b) => Object.values(ta.trix(b.c)),
  atr: (b) => [ta.atr(b, 14)],
  adx: (b) => Object.values(ta.adx(b, 14)),
  bb: (b) => Object.values(ta.bollinger(b.c)),
  hv: (b) => [ta.historicalVol(b.c, 20)],
  kc: (b) => Object.values(ta.keltner(b)),
  dc: (b) => Object.values(ta.donchian(b)),
  ichimoku: (b) => {
    const r = ta.ichimoku(b);
    return [r.tenkan, r.kijun, r.spanA, r.spanB]; // 후행스팬은 표시 전용(미래 종가)이라 제외
  },
  st: (b) => Object.values(ta.supertrend(b)),
  obv: (b) => [ta.obv(b.c, b.v)],
  mfi: (b) => [ta.mfi(b, 14)],
  cmf: (b) => [ta.cmf(b, 20)],
  ad: (b) => [ta.adLine(b)],
  vwap: (b) => [ta.rollingVwap(b, 20)],
};

describe("속성: 미래 정보 없음 · 이상값", () => {
  it("뒤쪽 데이터를 바꾸거나 잘라도 그 앞 값은 그대로 (모든 지표, 20개 무작위 시계열)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const b = randomBars(seed, 260);
      const cut = 120 + seed * 5;
      const changed = { h: [...b.h], l: [...b.l], c: [...b.c], v: [...b.v] };
      for (let i = cut + 1; i < 260; i++) {
        changed.c[i] *= 1.5;
        changed.h[i] = Math.max(changed.h[i] * 1.5, changed.c[i]);
        changed.l[i] *= 1.5;
        changed.v[i] *= 3;
      }
      const trunc = { h: b.h.slice(0, cut + 1), l: b.l.slice(0, cut + 1), c: b.c.slice(0, cut + 1), v: b.v.slice(0, cut + 1) };
      for (const [name, f] of Object.entries(ALL)) {
        const a = f(b);
        const x = f(changed);
        const t = f(trunc);
        a.forEach((line, li) => {
          for (let i = 0; i <= cut; i++) {
            expect(x[li][i], `${name} 선${li} #${i}`).toEqual(line[i]);
            expect(t[li][i], `${name} 선${li} #${i} (잘림)`).toEqual(line[i]);
          }
        });
      }
    }
  });
  it("NaN·무한대·0 이하 가격·음수 거래량이 섞여도 결과는 숫자 또는 null (NaN·무한대 없음)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = randomBars(seed + 100, 200);
      const rnd = mulberry32(seed);
      for (let k = 0; k < 15; k++) {
        const i = Math.floor(rnd() * 200);
        const bad = [NaN, Infinity, -Infinity, 0, -5][k % 5];
        if (k % 3 === 0) b.c[i] = bad;
        else if (k % 3 === 1) b.h[i] = bad;
        else b.v[i] = k % 2 ? -1 : NaN;
      }
      for (const [name, f] of Object.entries(ALL)) for (const line of f(b)) for (const x of line) expect(x === null || Number.isFinite(x), name).toBe(true);
    }
  });
  it("아주 큰 가격(1e12)·빈 배열·데이터 부족", () => {
    const big = randomBars(7, 120);
    const k = 1e10;
    const scaled = { h: big.h.map((x) => x * k), l: big.l.map((x) => x * k), c: big.c.map((x) => x * k), v: big.v };
    for (const f of Object.values(ALL)) for (const line of f(scaled)) for (const x of line) expect(x === null || Number.isFinite(x)).toBe(true);
    // 가격 배율이 바뀌어도 비율 지표는 같다
    expect(ta.rsi(scaled.c, 14)[100] as number).toBeCloseTo(ta.rsi(big.c, 14)[100] as number, 6);
    for (const f of Object.values(ALL)) for (const line of f({ h: [], l: [], c: [], v: [] })) expect(line).toEqual([]);
    expect(ta.sma([1, 2], 5)).toEqual([null, null]);
    expect(ta.adx({ h: [1, 2, 3], l: [0.5, 1, 2], c: [1, 1.5, 2.5] }, 14).adx.every((x) => x === null)).toBe(true);
  });
  it("같은 입력 → 같은 결과", () => {
    const b = randomBars(3, 200);
    for (const f of Object.values(ALL)) expect(f(b)).toEqual(f(b));
  });
});
