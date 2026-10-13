import Link from "next/link";
import type { QuoteView } from "@/lib/data/quotes";
import { fmtPrice, fmtCompact } from "@/lib/format";
import { formatEt } from "@/lib/time";
import Sparkline from "./Sparkline";
import type { BriefingDigest } from "@/lib/briefing/digest";
import ChangeChips from "./ChangeChips";
import { Change } from "./ui";

export default function QuoteCard({
  symbol,
  nameKo,
  quote,
  spark,
  sparkLabel,
  digest,
}: {
  symbol: string;
  nameKo: string;
  quote: QuoteView | undefined;
  spark: number[];
  sparkLabel: string;
  digest?: BriefingDigest;
}) {
  return (
    <Link href={`/stock/${symbol}`} className="card group flex flex-col gap-2 p-3.5 transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold group-hover:text-accent">{symbol}</div>
          <div className="truncate text-xs text-muted" title={quote?.name ?? nameKo}>
            {nameKo}
          </div>
        </div>
        <Sparkline values={spark} width={84} height={30} label={`${symbol} ${sparkLabel}`} direction={quote?.changePct} />
      </div>
      {quote && quote.price !== null ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="num text-lg font-semibold">${fmtPrice(quote.price)}</span>
            <Change value={quote.change} pct={quote.changePct} className="text-sm" />
          </div>
          <div className="flex justify-between text-[11px] text-muted">
            <span className="num">거래량 {fmtCompact(quote.volume)}</span>
            <span className={quote.freshness === "stale" ? "text-warn" : ""}>{formatEt(quote.fetchedAt)}</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-muted">시세 데이터 없음 (수집 대기 또는 제공처 오류)</div>
      )}
      {digest && (
        <div className="border-t border-line pt-2">
          <ChangeChips d={digest} max={1} minImportance={2} />
        </div>
      )}
    </Link>
  );
}
