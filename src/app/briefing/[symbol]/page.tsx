import Link from "next/link";
import { notFound } from "next/navigation";
import { briefingHistory, latestBriefing, readBriefing } from "@/lib/briefing/store";
import type { SessionType, SymbolBriefing, MarketBriefing } from "@/lib/briefing/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import BriefingView, { MarketBriefingView } from "@/components/BriefingView";
import { Empty, Section } from "@/components/ui";
import { BriefingRecordStatic } from "@/components/BriefingStaticClient";
import { INSTRUMENTS } from "@/config/instruments";
import { perRequest, readSearchParams } from "@/lib/page-mode";
import { IS_STATIC } from "@/lib/static-mode";

/** 정적 사이트: 시장 브리핑과 지원 종목 브리핑 페이지를 미리 만든다. 서버 모드에서는 내보내지 않는다(요청마다 렌더링). */
export const generateStaticParams = IS_STATIC ? async () => ["MARKET", ...INSTRUMENTS.map((i) => i.symbol)].map((symbol) => ({ symbol })) : undefined;

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ date?: string; session?: string }> };

export async function generateMetadata({ params }: Props) {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} 브리핑` };
}

export default async function SymbolBriefingPage({ params, searchParams }: Props) {
  await perRequest();
  const { symbol: raw } = await params;
  const sp = await readSearchParams(searchParams);
  const isMarket = raw.toUpperCase() === "MARKET";
  const scope = isMarket ? "MARKET" : normalizeSymbol(raw);
  if (!isMarket && !getInstrument(scope)) notFound();
  const rec =
    sp.date && sp.session
      ? readBriefing<SymbolBriefing | MarketBriefing>(scope, sp.date, sp.session as SessionType)
      : latestBriefing<SymbolBriefing | MarketBriefing>(scope);
  const history = briefingHistory(scope, 30);
  const body = rec ? isMarket ? <MarketBriefingView b={rec.content as MarketBriefing} /> : <BriefingView b={rec.content as SymbolBriefing} /> : <Empty>해당 브리핑이 없습니다.</Empty>;
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
        {IS_STATIC ? (
          <BriefingRecordStatic scope={scope} isMarket={isMarket} initialKey={rec ? `${rec.tradeDate}_${rec.session}` : null}>
            {body}
          </BriefingRecordStatic>
        ) : (
          body
        )}
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
