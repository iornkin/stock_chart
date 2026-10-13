import { getBars, INTERVALS } from "@/lib/data/bars";
import { readDividends } from "@/lib/data/dividends";
import { allowedSymbol, errorJson, json } from "@/lib/api-utils";
import type { Interval } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = allowedSymbol(raw);
  if (!symbol) return errorJson(404, "지원하지 않는 종목입니다");
  const interval = (new URL(req.url).searchParams.get("interval") ?? "1d") as Interval;
  if (!INTERVALS.includes(interval)) return errorJson(400, "지원하지 않는 봉 간격입니다");
  const res = await getBars(symbol, interval);
  if (!res.bars.length) {
    return json({ symbol, interval, bars: [], meta: res.meta, error: res.meta.error ?? "가격 데이터가 없습니다" }, { status: 502 });
  }
  const divs = interval === "1d" || interval === "1wk" || interval === "1mo" ? readDividends(symbol).map((d) => ({ exDate: d.exDate, amount: d.amount, kind: d.kind })) : [];
  return json({
    symbol,
    interval,
    bars: res.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
    meta: res.meta,
    instrument: res.instrumentMeta,
    dividends: divs,
  });
}
