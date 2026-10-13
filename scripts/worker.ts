/**
 * 스케줄러 워커 — 미국 시장 시간·휴장일에 맞춰 데이터 수집과 브리핑 생성을 자동 실행한다.
 * 실행: npm run worker   (웹 서버와 같은 DATABASE_PATH 를 사용해야 함)
 */
import os from "node:os";
import { acquireLock, releaseLock } from "@/lib/db";
import { dueJobs, runJob, shouldRun, takeRequests } from "@/lib/jobs/runner";
import { getSchedule } from "@/lib/jobs/schedule";
import { marketStatus } from "@/lib/market-calendar";
import { formatEt } from "@/lib/time";

const OWNER = `${os.hostname()}:${process.pid}`;
const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 30_000);
let stopping = false;

function log(msg: string) {
  console.log(`${formatEt(Date.now(), true)} | ${msg}`);
}

async function tick() {
  if (!acquireLock("worker", OWNER, 10 * 60_000)) {
    log("다른 워커가 실행 중입니다 — 대기");
    return;
  }
  // 1) 관리자 수동 요청
  for (const r of takeRequests()) {
    log(`수동 요청 실행: ${r.job}`);
    await runJob(r.job, {
      trigger: "manual",
      force: Boolean(r.options.force),
      tradeDate: typeof r.options.tradeDate === "string" ? r.options.tradeDate : undefined,
      log: (m) => log(`[${r.job}] ${m}`),
    });
  }
  // 2) 일정에 따른 작업
  const cfg = getSchedule();
  const now = Date.now();
  for (const d of dueJobs(now, cfg)) {
    if (stopping) break;
    if (!shouldRun(d, Date.now(), cfg)) continue;
    log(`예약 작업 실행: ${d.job} (slot ${d.slot})`);
    await runJob(d.job, { slot: d.slot, trigger: "schedule", tradeDate: d.tradeDate, log: (m) => log(`[${d.job}] ${m}`) });
    acquireLock("worker", OWNER, 10 * 60_000);
  }
}

async function main() {
  log(`워커 시작 (${OWNER}) — 시장 상태: ${marketStatus().label}`);
  const loop = async () => {
    while (!stopping) {
      try {
        await tick();
      } catch (e) {
        log(`틱 오류: ${(e as Error).stack ?? e}`);
      }
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  };
  const shutdown = () => {
    stopping = true;
    releaseLock("worker", OWNER);
    log("워커 종료");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await loop();
}

main();
