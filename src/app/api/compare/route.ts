import { computeCompare } from "@/lib/compare";
import { errorJson, json } from "@/lib/api-utils";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { COMPARE_PERIODS } from "@/lib/performance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = [...new Set((url.searchParams.get("symbols") ?? "").split(",").map((s) => getInstrument(normalizeSymbol(s))?.symbol).filter((s): s is string => !!s))].slice(0, 5);
  if (symbols.length < 2) return errorJson(400, "비교할 지원 종목을 2개 이상 선택하세요");
  const period = url.searchParams.get("period") ?? "1y";
  if (!COMPARE_PERIODS.some((p) => p.key === period)) return errorJson(400, "지원하지 않는 기간입니다");
  return json(await computeCompare(symbols, period));
}
