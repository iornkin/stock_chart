/**
 * 작업 실행기와 스케줄 판정
 * - 각 작업 실행은 job_runs 에 (작업, 슬롯) 단위로 기록된다.
 * - 같은 슬롯에서 성공한 작업은 다시 실행하지 않는다. 실패하면 retryDelay 후 maxAttempts 까지 재시도한다.
 */
import { all, get, run } from "../db";
import { marketStatus, sessionTimes, isTradingDay } from "../market-calendar";
import { etDate, etParts, etToUtc } from "../time";
import { JOBS, JOB_LABELS, type JobName, type JobResult } from "./jobs";
import { getSchedule, type ScheduleConfig } from "./schedule";
import { redactSecrets } from "../redact";

export interface RunOptions {
  slot?: string;
  trigger?: "schedule" | "manual" | "cli";
  tradeDate?: string;
  symbols?: string[];
  force?: boolean;
  log?: (msg: string) => void;
}

export async function runJob(job: JobName, opts: RunOptions = {}): Promise<JobResult & { runId: number }> {
  const started = Date.now();
  const slot = opts.slot ?? `manual:${started}`;
  const baseLog = opts.log ?? ((m: string) => console.log(`[${job}] ${m}`));
  // 공개 저장소의 Actions 로그에도 남으므로 비밀 값은 가린다
  const log = (m: string) => baseLog(redactSecrets(m));
  const ins = run(
    "INSERT INTO job_runs(job, slot, started_at, status, trigger) VALUES(?,?,?,?,?)",
    job,
    slot,
    started,
    "running",
    opts.trigger ?? "manual",
  );
  const runId = Number(ins.lastInsertRowid);
  let result: JobResult;
  try {
    result = await JOBS[job]({ now: started, tradeDate: opts.tradeDate, symbols: opts.symbols, force: opts.force, log });
  } catch (e) {
    result = { status: "failed", message: (e as Error).message ?? String(e) };
  }
  result = { ...result, message: redactSecrets(result.message), details: result.details ? JSON.parse(redactSecrets(JSON.stringify(result.details))) : undefined };
  run(
    "UPDATE job_runs SET finished_at=?, status=?, message=?, details=? WHERE id=?",
    Date.now(),
    result.status,
    result.message,
    result.details ? JSON.stringify(result.details) : null,
    runId,
  );
  log(`${result.status}: ${result.message} (${((Date.now() - started) / 1000).toFixed(1)}초)`);
  return { ...result, runId };
}

function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export interface DueJob {
  job: JobName;
  slot: string;
  tradeDate?: string;
}

/** 현재 시각에 실행해야 할 작업 목록 */
export function dueJobs(now = Date.now(), cfg: ScheduleConfig = getSchedule()): DueJob[] {
  const st = marketStatus(now);
  const today = st.etDate;
  const p = etParts(now);
  const minutes = p.hour * 60 + p.minute;
  const out: DueJob[] = [];
  const trading = isTradingDay(today);

  // 시세
  if (trading) {
    const s = sessionTimes(today);
    if (now >= s.preOpen && now <= s.postClose) {
      out.push({ job: "refresh_quotes", slot: `${today}#${Math.floor(minutes / cfg.quotesIntervalMin)}` });
    }
  } else if (minutes >= hm("10:00")) {
    out.push({ job: "refresh_quotes", slot: `${today}#closed` });
  }
  // 뉴스
  if (minutes >= hm(cfg.newsStart) && minutes <= hm(cfg.newsEnd)) {
    out.push({ job: "collect_news", slot: `${today}#${Math.floor((minutes - hm(cfg.newsStart)) / cfg.newsIntervalMin)}` });
  }
  // 참조 데이터
  if (minutes >= hm(cfg.referenceTime)) out.push({ job: "collect_reference", slot: today });
  // 장 마감 데이터 (마지막 완료 거래일 기준 — 늦게 시작해도 따라잡음)
  const lastSession = st.lastCompletedSession;
  const lastClose = sessionTimes(lastSession).close;
  if (now >= lastClose + cfg.eodDelayMin * 60_000) out.push({ job: "collect_eod", slot: lastSession, tradeDate: lastSession });
  // 장중 브리핑
  if (cfg.intradayBriefingEnabled && trading && st.phase === "regular" && now >= etToUtc(today, cfg.intradayBriefingTime)) {
    out.push({ job: "briefing_intraday", slot: today, tradeDate: today });
  }
  // 장 마감 후 브리핑 (마지막 완료 거래일 브리핑이 없으면 생성)
  if (now >= lastClose + cfg.closeBriefingDelayMin * 60_000 && now - lastClose < 4 * 86400_000) {
    out.push({ job: "briefing_close", slot: lastSession, tradeDate: lastSession });
  }
  // 휴장일 브리핑
  if (!trading && minutes >= hm(cfg.nonTradingBriefingTime)) {
    out.push({ job: "briefing_non_trading", slot: today, tradeDate: lastSession });
  }
  if (minutes >= hm(cfg.cleanupTime)) out.push({ job: "cleanup", slot: today });
  return out;
}

/** 슬롯 기준으로 이미 처리되었거나 재시도 대기 중인지 확인 */
export function shouldRun(d: DueJob, now: number, cfg: ScheduleConfig): boolean {
  const runs = all<{ status: string; started_at: number; finished_at: number | null }>(
    "SELECT status, started_at, finished_at FROM job_runs WHERE job=? AND slot=? ORDER BY started_at DESC",
    d.job,
    d.slot,
  );
  if (runs.some((r) => r.status === "success" || r.status === "skipped")) return false;
  // 실행 중(최대 2시간)인 작업은 중복 실행하지 않음
  if (runs.some((r) => r.status === "running" && now - r.started_at < 2 * 3600_000)) return false;
  const attempts = runs.filter((r) => r.status === "failed" || r.status === "partial").length;
  if (attempts >= cfg.maxAttempts) return false;
  const lastRun = runs[0];
  if (lastRun && now - (lastRun.finished_at ?? lastRun.started_at) < cfg.retryDelayMin * 60_000) return false;
  // 부분 성공은 1회만 재시도
  if (runs.some((r) => r.status === "partial") && attempts >= 2) return false;
  return true;
}

export interface JobRunRow {
  id: number;
  job: string;
  slot: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  message: string | null;
  details: string | null;
  trigger: string | null;
}

export function recentRuns(limit = 50): JobRunRow[] {
  return all<JobRunRow>("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?", limit);
}

export interface JobHealth {
  job: JobName;
  label: string;
  lastRun: JobRunRow | null;
  lastSuccess: JobRunRow | null;
}

export function jobHealth(): JobHealth[] {
  return (Object.keys(JOBS) as JobName[]).map((job) => ({
    job,
    label: JOB_LABELS[job],
    lastRun: get<JobRunRow>("SELECT * FROM job_runs WHERE job=? ORDER BY started_at DESC LIMIT 1", job) ?? null,
    lastSuccess: get<JobRunRow>("SELECT * FROM job_runs WHERE job=? AND status IN ('success','partial') ORDER BY started_at DESC LIMIT 1", job) ?? null,
  }));
}

export function lastSuccessAt(job: JobName): number | null {
  return get<{ t: number | null }>("SELECT max(finished_at) AS t FROM job_runs WHERE job=? AND status IN ('success','partial')", job)?.t ?? null;
}

export function lastFailure(job: JobName): JobRunRow | null {
  const r = get<JobRunRow>("SELECT * FROM job_runs WHERE job=? ORDER BY started_at DESC LIMIT 1", job);
  return r && r.status === "failed" ? r : null;
}

/** 관리자 요청 작업 큐 */
export function enqueueJob(job: JobName, options: Record<string, unknown> = {}) {
  run("INSERT INTO job_requests(job, requested_at, options) VALUES(?,?,?)", job, Date.now(), JSON.stringify(options));
}

export function takeRequests(): { id: number; job: JobName; options: Record<string, unknown> }[] {
  const rows = all<{ id: number; job: string; options: string | null }>("SELECT id, job, options FROM job_requests WHERE picked_at IS NULL ORDER BY id");
  for (const r of rows) run("UPDATE job_requests SET picked_at=? WHERE id=?", Date.now(), r.id);
  return rows.filter((r) => r.job in JOBS).map((r) => ({ id: r.id, job: r.job as JobName, options: r.options ? JSON.parse(r.options) : {} }));
}

export function pendingRequests(): number {
  return get<{ n: number }>("SELECT count(*) AS n FROM job_requests WHERE picked_at IS NULL")?.n ?? 0;
}

export { etDate };
