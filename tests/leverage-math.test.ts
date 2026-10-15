/** 레버리지 ETF: 일일 배수 재설정의 횡보·추세 효과와 회복 필요 수익률 */
import { describe, expect, it } from "vitest";
import { recoveryNeededPct, regimeGaps } from "@/lib/leverage";

function sim(dailyRets: number[], L: number) {
  const base = [100];
  const lev = [100];
  for (const r of dailyRets) {
    base.push(base[base.length - 1] * (1 + r));
    lev.push(lev[lev.length - 1] * (1 + L * r));
  }
  return { base, lev };
}

describe("레버리지 수학", () => {
  it("회복 필요 수익률: −50% → +100%, −80% → +400%, −100% 는 회복 불가", () => {
    expect(recoveryNeededPct(-50)).toBeCloseTo(100, 10);
    expect(recoveryNeededPct(-80)).toBeCloseTo(400, 8);
    expect(recoveryNeededPct(-100)).toBeNull();
  });
  it("횡보(±2% 번갈아): 기준은 거의 제자리인데 3배는 손실 → 차이 음수", () => {
    const r = Array.from({ length: 400 }, (_, i) => (i % 2 ? -0.02 : 0.02));
    const { base, lev } = sim(r, 3);
    const rows = regimeGaps(base, lev, 3);
    const side = rows.find((x) => x.regime === "횡보")!;
    expect(side.windows).toBeGreaterThan(5);
    expect(side.avgGap as number).toBeLessThan(-1);
  });
  it("꾸준한 상승(매일 +0.3%): 3배 복리가 기준 × 3 보다 큼 → 차이 양수", () => {
    const { base, lev } = sim(new Array(400).fill(0.003), 3);
    const up = regimeGaps(base, lev, 3).find((x) => x.regime === "상승 추세")!;
    expect(up.windows).toBeGreaterThan(5);
    expect(up.avgGap as number).toBeGreaterThan(0);
    // 단순 배수 계산과의 차이를 직접 확인: 63일 기준 수익률 × 3 vs 실제
    const b = (1.003 ** 63 - 1) * 100;
    const a = (1.009 ** 63 - 1) * 100;
    expect(up.avgGap as number).toBeCloseTo(a - 3 * b, 6);
  });
});
