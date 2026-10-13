import { describe, expect, it } from "vitest";
import { describeCron } from "@/lib/cron-describe";

describe("describeCron (GitHub Actions 예약 시각 표시)", () => {
  it("UTC 시각을 한국 시간으로 바꾸고 날짜가 넘어가면 요일도 옮긴다", () => {
    const d = describeCron("45 13,15,17,19 * * 1-5");
    expect(d.utc).toBe("월–금 13:45·15:45·17:45·19:45");
    expect(d.kst).toBe("월–금 22:45, 화–토 00:45·02:45·04:45");
  });
  it("주말 일정", () => {
    expect(describeCron("30 15 * * 0,6").kst).toBe("일·월 00:30");
  });
  it("해석할 수 없는 형식은 원문을 그대로 보여 준다", () => {
    expect(describeCron("*/15 * * * *")).toEqual({ cron: "*/15 * * * *", utc: "*/15 * * * *", kst: "-" });
  });
});
