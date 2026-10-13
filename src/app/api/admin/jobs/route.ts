import { checkAdmin, errorJson, json } from "@/lib/api-utils";
import { isJobName } from "@/lib/jobs/jobs";
import { enqueueJob } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

/** 관리자: 작업 실행 요청 (워커가 30초 이내에 실행) */
export async function POST(req: Request) {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { job?: string; force?: boolean; tradeDate?: string };
  if (!body.job || !isJobName(body.job)) return errorJson(400, "알 수 없는 작업입니다");
  if (body.tradeDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.tradeDate)) return errorJson(400, "날짜 형식은 YYYY-MM-DD");
  enqueueJob(body.job, { force: Boolean(body.force), tradeDate: body.tradeDate });
  return json({ ok: true, message: "작업 요청을 등록했습니다. 워커가 실행 중이면 30초 이내에 시작됩니다." });
}
