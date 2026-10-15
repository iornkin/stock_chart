import { latestBriefing, readBriefing } from "@/lib/briefing/store";
import { errorJson, json } from "@/lib/api-utils";
import { decodeParam, getInstrument, normalizeSymbol } from "@/lib/instruments";
import type { SessionType } from "@/lib/briefing/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const sym = normalizeSymbol(decodeParam(raw));
  const scope = sym === "MARKET" ? "MARKET" : (getInstrument(sym)?.symbol ?? null);
  if (!scope) return errorJson(404, "지원하지 않는 종목입니다");
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const session = url.searchParams.get("session") as SessionType | null;
  const rec = date && session ? readBriefing(scope, date, session) : latestBriefing(scope);
  if (!rec) return errorJson(404, "생성된 브리핑이 없습니다");
  return json(rec);
}
