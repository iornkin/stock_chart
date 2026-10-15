import { json } from "@/lib/api-utils";
import { buildEtfHistoryMap } from "@/lib/data/etf-history";

export const dynamic = "force-dynamic";

/** ETF 구성 기록 (이 사이트가 갱신할 때마다 쌓은 기록) + 실제 지급 기록으로 본 분배 주기 */
export async function GET() {
  return json({ asOf: Date.now(), items: buildEtfHistoryMap() });
}
