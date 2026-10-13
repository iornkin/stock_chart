import { describe, expect, it } from "vitest";
import { bollinger, ema, macd, maxDrawdown, realizedVol, rollingVwap, rsi, sessionVwap, sma, supportResistance } from "@/lib/indicators";

describe("이동평균", () => {
  it("SMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("EMA: 첫 값은 SMA 시드, 이후 지수 가중", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBeCloseTo(2);
    expect(e[3]).toBeCloseTo(3); // 4*0.5 + 2*0.5
    expect(e[4]).toBeCloseTo(4);
  });
});

describe("RSI (Wilder)", () => {
  it("계속 오르면 100", () => {
    const r = rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14);
    expect(r[29]).toBe(100);
    expect(r[13]).toBeNull();
  });
  it("알려진 예제와 일치 (Wilder 1978 유형 데이터)", () => {
    // 상승 7회 +1, 하락 7회 −1 반복 → 첫 RSI 50
    const closes = [10];
    for (let i = 0; i < 14; i++) closes.push(closes[closes.length - 1] + (i % 2 === 0 ? 1 : -1));
    expect(rsi(closes, 14)[14]).toBeCloseTo(50);
  });
});

describe("MACD / 볼린저", () => {
  it("일정한 가격이면 MACD 0, 밴드 폭 0", () => {
    const c = Array(60).fill(50);
    const m = macd(c);
    expect(m.macd[59]).toBeCloseTo(0);
    expect(m.signal[59]).toBeCloseTo(0);
    const b = bollinger(c, 20, 2);
    expect(b.upper[59]).toBeCloseTo(50);
    expect(b.lower[59]).toBeCloseTo(50);
  });
  it("상승 추세면 MACD > 0", () => {
    const c = Array.from({ length: 80 }, (_, i) => 100 * 1.01 ** i);
    expect(macd(c).macd[79]).toBeGreaterThan(0);
  });
});

describe("VWAP", () => {
  it("세션이 바뀌면 초기화", () => {
    const bars = [
      { t: 1, h: 11, l: 9, c: 10, v: 100 },
      { t: 2, h: 13, l: 11, c: 12, v: 100 },
      { t: 3, h: 21, l: 19, c: 20, v: 50 },
    ];
    const v = sessionVwap(bars, (t) => (t < 3 ? "a" : "b"));
    expect(v[1]).toBeCloseTo(11);
    expect(v[2]).toBeCloseTo(20);
  });
  it("이동 VWAP", () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, h: 10, l: 10, c: 10, v: 1 + i }));
    expect(rollingVwap(bars, 3)[4]).toBeCloseTo(10);
  });
});

describe("변동성·낙폭·지지/저항", () => {
  it("최대 낙폭", () => {
    expect(maxDrawdown([100, 120, 90, 130, 117])?.mdd).toBeCloseTo(-0.25);
  });
  it("실현 변동성은 일정 수익률이면 0", () => {
    const c = Array.from({ length: 30 }, (_, i) => 100 * 1.001 ** i);
    expect(realizedVol(c, 20)).toBeCloseTo(0, 6);
  });
  it("지지·저항 후보는 현재가 아래/위로 구분", () => {
    const bars = Array.from({ length: 120 }, (_, i) => {
      const c = 100 + 10 * Math.sin(i / 6);
      return { h: c + 1, l: c - 1, c };
    });
    const lv = supportResistance(bars);
    const last = bars[bars.length - 1].c;
    for (const l of lv) {
      if (l.kind === "support") expect(l.price).toBeLessThan(last);
      else expect(l.price).toBeGreaterThan(last);
    }
    expect(lv.length).toBeGreaterThan(0);
  });
});
