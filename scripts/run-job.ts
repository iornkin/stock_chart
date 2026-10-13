/**
 * 작업 수동 실행 CLI
 *   npm run job -- <작업명> [--force] [--date YYYY-MM-DD] [--symbols QQQ,JEPI]
 * 작업명: refresh_quotes | collect_news | collect_reference | collect_eod |
 *         briefing_intraday | briefing_close | briefing_non_trading | cleanup | all
 */
import { isJobName, type JobName } from "@/lib/jobs/jobs";
import { runJob } from "@/lib/jobs/runner";

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
  const list: JobName[] =
    name === "all"
      ? ["refresh_quotes", "collect_reference", "collect_eod", "collect_news", "briefing_close"]
      : name && isJobName(name)
        ? [name]
        : [];
  if (!list.length) {
    console.error("사용법: npm run job -- <작업명|all> [--force] [--date YYYY-MM-DD] [--symbols A,B]");
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
