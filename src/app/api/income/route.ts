import { json } from "@/lib/api-utils";
import { buildIncomeMap } from "@/lib/data/series";

export const dynamic = "force-dynamic";

/** 지원 종목별 배당·분배금 요약 (최근 12개월 실제 지급, 발표된 예정 지급) */
export async function GET() {
  return json({ asOf: Date.now(), items: buildIncomeMap() });
}
