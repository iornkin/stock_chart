/**
 * CNN 공포·탐욕 지수 파서·구간·저장 검증
 * ⚠ 이 파일의 숫자는 모두 테스트 전용으로 직접 만든 고정 자료이며 실제 CNN 값이 아니다.
 */
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { normalizeRating, parseFearGreed } from "@/lib/providers/cnn";
import { FG_ZONES, fgRating, fgZone } from "@/lib/positioning";
import { ProviderError } from "@/lib/http";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "usi-fg-")), "t.db");

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const comp = (score: number | null, ys: number[]) => ({ timestamp: day("2026-10-14") + 20 * 3600_000, score, rating: score === null ? null : "fear", data: ys.map((y, i) => ({ x: day("2026-10-13") + i * 86400_000, y, rating: "neutral" })) });

/** CNN 응답 형식을 흉내 낸 고정 테스트 자료 */
function payload(over: Record<string, unknown> = {}, hist?: unknown[]) {
  return {
    fear_and_greed: { score: 30, rating: "fear", timestamp: "2026-10-15T11:00:00+00:00", previous_close: 32, previous_1_week: 40, previous_1_month: 28, previous_1_year: 27 },
    fear_and_greed_historical: {
      timestamp: Date.parse("2026-10-15T11:00:00Z"),
      score: 30,
      rating: "fear",
      data: hist ?? [
        { x: day("2026-10-12"), y: 40, rating: "fear" },
        { x: day("2026-10-13"), y: 31, rating: "Fear" },
        { x: day("2026-10-13"), y: 32, rating: "fear" }, // 같은 날짜 두 번 → 뒤의 값
        { x: day("2026-10-14"), y: 30, rating: "fear" },
        { x: day("2026-10-15"), y: 30, rating: "fear" }, // 진행 중인 날 (저장할 때 기준일 뒤면 제외)
        { x: Date.parse("2026-10-15T11:00:00Z"), y: 30, rating: "fear" }, // 지금 시각 점 → 일별 기록 아님
      ],
    },
    market_momentum_sp500: comp(60, [1000, 1100]),
    market_momentum_sp125: comp(60, [1050]),
    stock_price_strength: comp(10, [-2]),
    stock_price_breadth: comp(20, [100]),
    put_call_options: comp(40, [0.9]),
    market_volatility_vix: comp(25, [20, 22]),
    market_volatility_vix_50: comp(25, [18]),
    junk_bond_demand: comp(70, [1.5]),
    // safe_haven_demand 없음 → 점수·값 없음으로 남아야 함
    ...over,
  };
}

describe("CNN 공포·탐욕 응답 파서", () => {
  it("지금 값·판정·비교 값, 일별 기록은 UTC 0시 점만 (지금 시각 점 제외), 같은 날짜는 뒤의 값, 날짜순", () => {
    const fg = parseFearGreed(payload());
    expect(fg.score).toBe(30);
    expect(fg.rating).toBe("fear");
    expect(fg.at).toBe(Date.parse("2026-10-15T11:00:00Z"));
    expect(fg.previous).toEqual({ close: 32, week: 40, month: 28, year: 27 });
    expect(fg.history.map((p) => p.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(fg.history[1]).toEqual({ date: "2026-10-13", score: 32, rating: "fear" });
    expect(fg.invalidPoints).toBe(0);
  });

  it("구성 지표: CNN 점수·판정·갱신 시각과 마지막 원값, 없는 지표는 null (다른 값으로 채우지 않음)", () => {
    const fg = parseFearGreed(payload());
    const m = fg.components.find((c) => c.key === "momentum")!;
    expect(m).toMatchObject({ score: 60, rating: "fear", values: [1100, 1050] });
    expect(m.at).toBe(day("2026-10-14") + 20 * 3600_000);
    expect(fg.components.find((c) => c.key === "volatility")!.values).toEqual([22, 18]);
    expect(fg.components.find((c) => c.key === "safe_haven")).toEqual({ key: "safe_haven", score: null, rating: null, at: null, values: [null] });
    expect(fg.components).toHaveLength(7);
  });

  it("지수 값이 없거나 0~100 밖이면 오류 (형식 변경을 값으로 착각하지 않음)", () => {
    expect(() => parseFearGreed({})).toThrow(ProviderError);
    expect(() => parseFearGreed({ ...payload(), fear_and_greed: { score: 130, timestamp: "2026-10-15T11:00:00Z" } })).toThrow(/0~100/);
    expect(() => parseFearGreed({ ...payload(), fear_and_greed: { score: "30", timestamp: "2026-10-15T11:00:00Z" } })).toThrow(/0~100/);
    expect(() => parseFearGreed({ ...payload(), fear_and_greed: { score: 30, timestamp: "언제" } })).toThrow(/기준 시각/);
  });

  it("일별 기록의 잘못된 점: 5% 이하면 빼고 개수를 남기고, 넘으면 오류", () => {
    const good = Array.from({ length: 40 }, (_, i) => ({ x: day("2026-01-01") + i * 86400_000, y: 50, rating: "neutral" }));
    const few = parseFearGreed(payload({}, [...good.slice(0, 39), { x: good[39].x, y: 140, rating: "greed" }]));
    expect(few.history).toHaveLength(39);
    expect(few.invalidPoints).toBe(1);
    const many = good.map((p, i) => (i % 5 === 0 ? { ...p, y: -3 } : p));
    expect(() => parseFearGreed(payload({}, many))).toThrow(/잘못된 값/);
  });

  it("판정 이름 정리: 대소문자·공백 무시, 모르는 값은 null", () => {
    expect(normalizeRating(" Extreme Fear ")).toBe("extreme fear");
    expect(normalizeRating("GREED")).toBe("greed");
    expect(normalizeRating("panic")).toBeNull();
    expect(normalizeRating(3)).toBeNull();
  });
});

describe("공포·탐욕 구간", () => {
  it("0~25 극단적 공포, 25~45 공포, 45~55 중립, 55~75 탐욕, 75~100 극단적 탐욕 (경계값은 위 구간)", () => {
    expect(FG_ZONES.map((z) => [z.from, z.to])).toEqual([[0, 25], [25, 45], [45, 55], [55, 75], [75, 100]]);
    const cases: [number, string][] = [[0, "extreme fear"], [24.9, "extreme fear"], [25, "fear"], [44.99, "fear"], [45, "neutral"], [54.99, "neutral"], [55, "greed"], [74.99, "greed"], [75, "extreme greed"], [100, "extreme greed"]];
    for (const [s, r] of cases) expect(fgZone(s), String(s)).toBe(r);
    for (const bad of [-1, 101, NaN, null, undefined]) expect(fgZone(bad as number)).toBeNull();
  });

  it("CNN 판정이 있으면 그것을 쓰고, 없을 때만 점수 구간", () => {
    expect(fgRating(30, "neutral")).toBe("neutral");
    expect(fgRating(30, null)).toBe("fear");
    expect(fgRating(null, null)).toBeNull();
  });
});

describe("공포·탐욕 저장·조회 (임시 DB)", async () => {
  const pos = await import("@/lib/data/positioning");

  it("수집 기준일 뒤(진행 중인 날)는 저장하지 않고, 같은 날짜는 덮어써 늦게 바뀐 값을 반영", () => {
    expect(pos.readFearGreedNow()).toBeNull();
    expect(pos.readMarketSentiment().fearGreed).toBeNull();
    const fg = parseFearGreed(payload());
    expect(pos.saveFearGreed(fg, "2026-10-14", 1)).toBe(3);
    const d1 = pos.readMarketSentiment().fearGreed!;
    expect(d1.history.map((p) => p.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(d1.now.score).toBe(30);
    expect(d1.info.source).toContain("CNN");
    // 다음 날 다시 받았더니 10-14 값이 바뀜 → 행은 늘지 않고 값만 바뀜
    const later = parseFearGreed(payload({ fear_and_greed: { score: 35, rating: "fear", timestamp: "2026-10-16T11:00:00+00:00", previous_close: 30 } }, [
      { x: day("2026-10-14"), y: 29, rating: "fear" },
      { x: day("2026-10-15"), y: 35, rating: "fear" },
    ]));
    pos.saveFearGreed(later, "2026-10-15", 2);
    const d2 = pos.readMarketSentiment().fearGreed!;
    expect(d2.history.map((p) => [p.date, p.score])).toEqual([["2026-10-12", 40], ["2026-10-13", 32], ["2026-10-14", 29], ["2026-10-15", 35]]);
    expect(pos.readFearGreedNow()?.now.score).toBe(35);
    expect(pos.readFearGreedNow()?.now.previous.week).toBeNull(); // 응답에 없던 비교 값은 비워 둠
  });
});
