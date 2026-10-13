import { checkAdmin, errorJson, json } from "@/lib/api-utils";
import { saveSchedule, validateSchedule, type ScheduleConfig } from "@/lib/jobs/schedule";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const denied = checkAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Partial<ScheduleConfig> | null;
  if (!body) return errorJson(400, "잘못된 요청 본문");
  const v = validateSchedule(body);
  if (!v.ok) return errorJson(400, v.error);
  saveSchedule(v.value);
  return json({ ok: true, schedule: v.value });
}
