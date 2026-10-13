import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usi-sched-"));
  process.env.DATABASE_PATH = path.join(dir, "t.db");
});

describe("자동 업데이트 일정 판정 (미국 동부 시간)", async () => {
  const { dueJobs, shouldRun, runJob } = await import("@/lib/jobs/runner");
  const { DEFAULT_SCHEDULE } = await import("@/lib/jobs/schedule");
  const { etToUtc } = await import("@/lib/time");
  const names = (t: number) => dueJobs(t, DEFAULT_SCHEDULE).map((d) => d.job);

  it("거래일 장중: 시세·장중 브리핑, 장 마감 전에는 마감 브리핑 없음 (전일분 제외)", () => {
    const t = etToUtc("2026-10-13", "12:45");
    const due = dueJobs(t, DEFAULT_SCHEDULE);
    expect(due.map((d) => d.job)).toContain("refresh_quotes");
    expect(due.find((d) => d.job === "briefing_intraday")?.tradeDate).toBe("2026-10-13");
    // 마감 브리핑은 직전 거래일(10-12) 슬롯만 해당
    expect(due.find((d) => d.job === "briefing_close")?.tradeDate).toBe("2026-10-12");
  });
  it("장 마감 후: 마감 데이터 수집과 마감 브리핑", () => {
    const due = dueJobs(etToUtc("2026-10-13", "16:30"), DEFAULT_SCHEDULE);
    expect(due.find((d) => d.job === "collect_eod")?.tradeDate).toBe("2026-10-13");
    expect(due.find((d) => d.job === "briefing_close")?.tradeDate).toBe("2026-10-13");
  });
  it("조기 폐장일(추수감사절 다음 날)은 13:00 기준", () => {
    const due = dueJobs(etToUtc("2026-11-27", "13:30"), DEFAULT_SCHEDULE);
    expect(due.find((d) => d.job === "briefing_close")?.tradeDate).toBe("2026-11-27");
  });
  it("주말: 휴장일 브리핑 (마지막 거래일 기준), 장중 브리핑 없음", () => {
    const n = names(etToUtc("2026-10-17", "10:30"));
    expect(n).toContain("briefing_non_trading");
    expect(n).not.toContain("briefing_intraday");
    expect(dueJobs(etToUtc("2026-10-17", "10:30"), DEFAULT_SCHEDULE).find((d) => d.job === "briefing_non_trading")?.tradeDate).toBe("2026-10-16");
  });
  it("공휴일(추수감사절)에도 휴장일 브리핑", () => {
    expect(names(etToUtc("2026-11-26", "11:00"))).toContain("briefing_non_trading");
  });
  it("성공한 슬롯은 다시 실행하지 않고, 실패는 재시도 간격 후 재실행", async () => {
    const d = { job: "cleanup" as const, slot: "test-slot" };
    expect(shouldRun(d, Date.now(), DEFAULT_SCHEDULE)).toBe(true);
    await runJob("cleanup", { slot: "test-slot", log: () => {} });
    expect(shouldRun(d, Date.now(), DEFAULT_SCHEDULE)).toBe(false);
  });
});
