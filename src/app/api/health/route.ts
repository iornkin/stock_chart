import { json } from "@/lib/api-utils";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return json({ ok: true, time: Date.now() });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
