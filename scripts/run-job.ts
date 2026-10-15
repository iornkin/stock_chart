/**
 * 작업 수동 실행 CLI
 *   npm run job -- <작업명> [--force] [--date YYYY-MM-DD] [--symbols QQQ,JEPI]
 * 작업명: refresh_quotes | collect_news | collect_reference | collect_eod |
 *         briefing_intraday | briefing_close | briefing_non_trading | cleanup | all | due
 * due: 지금 시각에 실행할 예약 작업만 한 번 실행하고 끝낸다 (GitHub Actions 처럼 정해진 시각에만 실행할 때)
 */
import { isJobName, type JobName } from "@/lib/jobs/jobs";
import { dueJobs, runJob, shouldRun } from "@/lib/jobs/runner";
import { getSchedule } from "@/lib/jobs/schedule";
import { marketStatus } from "@/lib/market-calendar";

/** 워커의 한 주기와 같은 처리: 일정상 실행할 작업 중 아직 성공하지 않은 것만 실행 */
async function runDue(): Promise<boolean> {
  const cfg = getSchedule();
  console.log(`시장 상태: ${marketStatus().label}`);
  let failed = false;
  let count = 0;
  for (const d of dueJobs(Date.now(), cfg)) {
    if (!shouldRun(d, Date.now(), cfg)) continue;
    count++;
    console.log(`예약 작업 실행: ${d.job} (slot ${d.slot})`);
    const r = await runJob(d.job, { slot: d.slot, trigger: "schedule", tradeDate: d.tradeDate, log: (m) => console.log(`[${d.job}] ${m}`) });
    console.log(`→ ${r.status}: ${r.message}`);
    if (r.status === "failed") failed = true;
  }
  if (!count) console.log("지금 실행할 예약 작업이 없습니다");
  return !failed;
}

async function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const force = args.includes("--force");
  const tradeDate = opt("--date");
  const symbols = opt("--symbols")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (name === "due") process.exit((await runDue()) ? 0 : 1);
  const list: JobName[] =
    name === "all"
      ? ["refresh_quotes", "collect_reference", "collect_eod", "collect_news", "briefing_close", "collect_positioning"]
      : name && isJobName(name)
        ? [name]
        : [];
  if (!list.length) {
    console.error("사용법: npm run job -- <작업명|all|due> [--force] [--date YYYY-MM-DD] [--symbols A,B]");
    process.exit(2);
  }
  let failed = false;
  for (const j of list) {
    const r = await runJob(j, { trigger: "cli", force: force || name === "all", tradeDate, symbols });
    if (r.status === "failed") failed = true;
    if (r.details) console.log(JSON.stringify(r.details, null, 2).slice(0, 4000));
  }
  process.exit(failed ? 1 : 0);
}

main();
