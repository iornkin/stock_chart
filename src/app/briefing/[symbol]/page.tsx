import Link from "next/link";
import { notFound } from "next/navigation";
import { briefingHistory, latestBriefing, readBriefing } from "@/lib/briefing/store";
import type { SessionType, SymbolBriefing, MarketBriefing } from "@/lib/briefing/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import BriefingView, { MarketBriefingView } from "@/components/BriefingView";
import { Empty, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ date?: string; session?: string }> };

export async function generateMetadata({ params }: Props) {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} 브리핑` };
}

export default async function SymbolBriefingPage({ params, searchParams }: Props) {
  const { symbol: raw } = await params;
  const sp = await searchParams;
  const isMarket = raw.toUpperCase() === "MARKET";
  const scope = isMarket ? "MARKET" : normalizeSymbol(raw);
  if (!isMarket && !getInstrument(scope)) notFound();
  const rec =
    sp.date && sp.session
      ? readBriefing<SymbolBriefing | MarketBriefing>(scope, sp.date, sp.session as SessionType)
      : latestBriefing<SymbolBriefing | MarketBriefing>(scope);
  const history = briefingHistory(scope, 30);
  return (
    <div className="flex flex-col gap-5">
      <nav className="text-xs text-muted">
        <Link href="/briefing" className="hover:text-accent">일일 브리핑</Link> / {scope}
        {!isMarket && (
          <>
            {" "}· <Link href={`/stock/${scope}`} className="link">종목 상세 페이지</Link>
          </>
        )}
      </nav>
      <Section title={isMarket ? "시장 브리핑" : `${getInstrument(scope)?.nameKo} (${scope}) 브리핑`}>
        {rec ? isMarket ? <MarketBriefingView b={rec.content as MarketBriefing} /> : <BriefingView b={rec.content as SymbolBriefing} /> : <Empty>해당 브리핑이 없습니다.</Empty>}
      </Section>
      {history.length > 0 && (
        <Section title="브리핑 기록">
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/briefing/${scope}?date=${h.tradeDate}&session=${h.session}`} className="block rounded-md border border-line px-2 py-1.5 hover:border-accent">
                  <span className="num font-semibold">{h.tradeDate}</span>{" "}
                  <span className="text-xs text-muted">{h.session === "close" ? "장 마감 후" : h.session === "intraday" ? "장중" : "휴장일"}</span>
                  <span className="block truncate text-xs text-ink-2">{h.headline}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
