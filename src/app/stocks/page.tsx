import Link from "next/link";
import { byCategory } from "@/lib/instruments";
import { getQuotes } from "@/lib/data/quotes";
import { allSymbols } from "@/lib/instruments";
import { fmtPrice } from "@/lib/format";
import { PageHeader, PctBadge, Section } from "@/components/ui";
import { perRequest } from "@/lib/page-mode";

export const metadata = { title: "지원 종목" };

export default async function StocksPage() {
  await perRequest();
  const quotes = await getQuotes(allSymbols(), "list");
  return (
    <div className="flex flex-col">
      <PageHeader title="전체 종목" description={`이 사이트가 다루는 미국 주식·ETF ${allSymbols().length}개입니다. 종목을 누르면 차트·분배금·공시를 봅니다.`} />
      <div className="flex flex-col gap-5">
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
    </div>
  );
}
