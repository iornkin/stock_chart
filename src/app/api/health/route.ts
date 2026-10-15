import { json } from "@/lib/api-utils";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return json({ ok: true, time: Date.now() });
  } catch {
    // 내부 오류 내용(파일 경로 등)은 밖으로 내보내지 않는다
    return json({ ok: false, error: "DB 를 열 수 없습니다" }, { status: 500 });
  }
}
