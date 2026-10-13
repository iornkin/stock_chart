import Link from "next/link";
import { byCategory } from "@/lib/instruments";
import { getQuotes } from "@/lib/data/quotes";
import { allSymbols } from "@/lib/instruments";
import { fmtPrice } from "@/lib/format";
import { PctBadge, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "지원 종목" };

export default async function StocksPage() {
  const quotes = await getQuotes(allSymbols(), "list");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">지원 종목</h1>
        <p className="text-sm text-muted">이 사이트는 설정 파일(src/config/instruments.ts)에 등록된 미국 주식·ETF 만 다룹니다. 종목 추가·제거는 설정 파일에서 할 수 있습니다.</p>
      </div>
      {byCategory().map((g) => (
        <Section key={g.category} title={g.label}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.items.map((i) => {
              const q = quotes.get(i.symbol);
              return (
                <li key={i.symbol}>
                  <Link href={`/stock/${i.symbol}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-accent">
                    <span className="min-w-0">
                      <span className="font-semibold">{i.symbol}</span>
                      {i.core && <span className="ml-1 text-[10px] text-accent">핵심</span>}
                      <span className="block truncate text-xs text-muted">{i.nameKo}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm">{q?.price != null ? `$${fmtPrice(q.price)}` : "-"}</span>
                      <PctBadge pct={q?.changePct} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </div>
  );
}
