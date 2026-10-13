import { INSTRUMENTS } from "@/config/instruments";
import { readDividends } from "@/lib/data/dividends";
import { readQuotes } from "@/lib/data/quotes";
import { FREQUENCY_KO, isRegular, summarizeDividends } from "@/lib/dividend-analytics";
import { distributionWord } from "@/lib/instruments";
import { addDays, etDate } from "@/lib/time";
import { perRequest } from "@/lib/page-mode";
import IncomePlanner, { type IncomeAsset } from "@/components/IncomePlanner";

export const metadata = { title: "배당 현금흐름" };

export default async function IncomePage() {
  await perRequest();
  const today = etDate();
  const quotes = readQuotes(INSTRUMENTS.map((i) => i.symbol));
  const assets: IncomeAsset[] = [];
  for (const inst of INSTRUMENTS) {
    const divs = readDividends(inst.symbol);
    if (!divs.length) continue;
    const q = quotes.get(inst.symbol);
    const sum = summarizeDividends(divs, today, q?.price ?? null);
    assets.push({
      symbol: inst.symbol,
      name: inst.nameKo,
      category: inst.category,
      word: distributionWord(inst),
      price: q?.price ?? null,
      priceAsOf: q?.fetchedAt ?? null,
      frequency: FREQUENCY_KO[sum.frequency.label],
      past12: divs.filter((d) => d.exDate <= today && d.exDate > addDays(today, -365)).map((d) => ({ exDate: d.exDate, payDate: d.payDate, amount: d.amount, special: !isRegular(d) })),
      upcoming: sum.upcoming.map((d) => ({ exDate: d.exDate, payDate: d.payDate, amount: d.amount, special: !isRegular(d) })),
    });
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">배당·분배금 현금흐름</h1>
        <p className="mt-1 text-sm text-ink-2">보유 종목과 수량을 넣으면 최근 12개월 실제 지급 기록으로 월별 현금흐름을 계산하고, 발표된 예정 지급을 따로 보여 줍니다. 입력값은 이 브라우저에만 저장됩니다.</p>
      </div>
      <IncomePlanner assets={assets} asOf={today} />
    </div>
  );
}
