import { describe, expect, it } from "vitest";
import { earlyCloseTime, holidayName, isTradingDay, marketStatus, nextTradingDay, previousTradingDay, sessionTimes } from "@/lib/market-calendar";
import { etToUtc, etDate, etOffsetMinutes } from "@/lib/time";

describe("NYSE 휴장일 규칙", () => {
  it("2026년 휴장일", () => {
    const expected = ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"];
    for (const d of expected) expect(holidayName(d), d).not.toBeNull();
    expect(isTradingDay("2026-10-12")).toBe(true); // 콜럼버스 데이는 개장
    expect(isTradingDay("2026-11-11")).toBe(true); // 재향군인의 날 개장
  });
  it("2025년 임시 휴장과 성금요일", () => {
    expect(holidayName("2025-01-09")).toContain("카터");
    expect(holidayName("2025-04-18")).toContain("성금요일");
  });
  it("토요일 신정은 전년도 12/31 대체 휴장하지 않음 (2022)", () => {
    expect(isTradingDay("2021-12-31")).toBe(true);
    expect(holidayName("2022-01-01")).toBeNull();
  });
  it("조기 폐장", () => {
    expect(earlyCloseTime("2026-11-27")).toBe("13:00");
    expect(earlyCloseTime("2026-12-24")).toBe("13:00");
    expect(earlyCloseTime("2025-07-03")).toBe("13:00");
    expect(earlyCloseTime("2026-07-02")).toBeNull(); // 2026-07-03 이 대체 휴장
    expect(sessionTimes("2026-11-27").close).toBe(etToUtc("2026-11-27", "13:00"));
  });
  it("이전/다음 거래일", () => {
    expect(previousTradingDay("2026-04-06")).toBe("2026-04-02");
    expect(nextTradingDay("2026-12-24")).toBe("2026-12-28");
  });
  it("시장 상태", () => {
    const sat = marketStatus(etToUtc("2026-10-17", "11:00"));
    expect(sat.phase).toBe("closed");
    expect(sat.closedReason).toBe("weekend");
    expect(sat.lastCompletedSession).toBe("2026-10-16");
    const open = marketStatus(etToUtc("2026-10-13", "10:00"));
    expect(open.phase).toBe("regular");
    expect(open.lastCompletedSession).toBe("2026-10-12");
    const post = marketStatus(etToUtc("2026-10-13", "16:30"));
    expect(post.phase).toBe("post");
    expect(post.lastCompletedSession).toBe("2026-10-13");
    const thanksgiving = marketStatus(etToUtc("2026-11-26", "12:00"));
    expect(thanksgiving.closedReason).toBe("holiday");
  });
});

describe("ET 시간 변환 (서머타임)", () => {
  it("EDT/EST 오프셋", () => {
    expect(etOffsetMinutes(Date.UTC(2026, 6, 1))).toBe(-240);
    expect(etOffsetMinutes(Date.UTC(2026, 0, 15))).toBe(-300);
  });
  it("etToUtc 와 etDate 왕복", () => {
    const t = etToUtc("2026-03-09", "09:30"); // DST 시작 다음 날
    expect(new Date(t).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    const w = etToUtc("2026-01-05", "16:00");
    expect(new Date(w).toISOString()).toBe("2026-01-05T21:00:00.000Z");
    expect(etDate(w)).toBe("2026-01-05");
  });
});
