import { getQuotes, delayLabel } from "@/lib/data/quotes";
import { allowedSymbol, errorJson, json } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const symbols = [...new Set(raw.map(allowedSymbol).filter((s): s is string => Boolean(s)))].slice(0, 80);
  if (!symbols.length) return errorJson(400, "지원 종목 심볼을 지정하세요");
  const purpose = url.searchParams.get("purpose") === "detail" ? "detail" : "list";
  const map = await getQuotes(symbols, purpose);
  return json({
    quotes: [...map.values()].map((q) => ({ ...q, delay: delayLabel(q) })),
    missing: symbols.filter((s) => !map.has(s)),
    serverTime: Date.now(),
  });
}
