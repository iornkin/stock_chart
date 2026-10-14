import { json } from "@/lib/api-utils";
import { buildExposureMap } from "@/lib/data/exposure";

export const dynamic = "force-dynamic";

/** 지원 종목별 상위 편입 종목·섹터·총보수 (내 자산 노출 분석용) */
export async function GET() {
  return json({ asOf: Date.now(), items: buildExposureMap() });
}
