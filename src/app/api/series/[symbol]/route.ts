import { allowedSymbol, errorJson, json } from "@/lib/api-utils";
import { buildSeries } from "@/lib/data/series";
import { encodeSeries } from "@/lib/sim/series";

export const dynamic = "force-dynamic";

/** 백테스트·시뮬레이션용 일봉 종가(분할 조정) + 배당·분배금 기록 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = allowedSymbol(raw);
  if (!symbol) return errorJson(404, "지원하지 않는 종목입니다");
  return json(encodeSeries(buildSeries(symbol)));
}
