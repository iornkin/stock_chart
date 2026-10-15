import { json } from "@/lib/api-utils";
import { get } from "@/lib/db";
import { jobHealth, pendingRequests, recentRuns } from "@/lib/jobs/runner";
import { describeSchedule, getSchedule } from "@/lib/jobs/schedule";
import { JOB_LABELS } from "@/lib/jobs/jobs";
import { providerConfig, providerStats } from "@/lib/views";
import { marketStatus } from "@/lib/market-calendar";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const lock = get<{ owner: string; expires_at: number }>("SELECT owner, expires_at FROM locks WHERE name='worker'");
  const schedule = getSchedule();
  return json({
    market: marketStatus(),
    // 작업자 식별자(호스트 이름·프로세스 번호)는 공개 화면에 내보내지 않는다
    worker: { alive: Boolean(lock && lock.expires_at > Date.now()), owner: lock ? "worker" : null, leaseUntil: lock?.expires_at ?? null },
    schedule,
    scheduleRows: describeSchedule(schedule).map((r) => ({ ...r, label: JOB_LABELS[r.job] })),
    jobs: jobHealth(),
    runs: recentRuns(30),
    pendingRequests: pendingRequests(),
    providers: providerConfig(),
    providerStats: providerStats(Date.now() - 24 * 3600_000),
    llm: { enabled: Boolean(env.anthropicKey), model: env.llmModel, sessions: env.llmSessions },
    adminEnabled: Boolean(env.adminToken),
  });
}
