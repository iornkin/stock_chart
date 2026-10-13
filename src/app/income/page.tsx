import { INSTRUMENTS } from "@/config/instruments";
import { readDividends } from "@/lib/data/dividends";
import { readQuotes } from "@/lib/data/quotes";
import { FREQUENCY_KO, isRegular, summarizeDividends } from "@/lib/dividend-analytics";
import { distributionWord } from "@/lib/instruments";
import { addDays, etDate } from "@/lib/time";
import { perRequest } from "@/lib/page-mode";
import IncomePlanner, { type IncomeAsset } from "@/components/IncomePlanner";
import { CATEGORY_LABELS } from "@/config/instruments";
import { Fold, PageHeader, Section } from "@/components/ui";
import PanelTabs from "@/components/PanelTabs";
import IncomeTable, { type IncomeRow } from "@/components/IncomeTable";

export const metadata = { title: "배당·분배금" };

export default async function IncomePage() {
  await perRequest();
  const today = etDate();
  const quotes = readQuotes(INSTRUMENTS.map((i) => i.symbol));
  const assets: IncomeAsset[] = [];
  const table: IncomeRow[] = [];
  for (const inst of INSTRUMENTS) {
    const divs = readDividends(inst.symbol);
    if (!divs.length) continue;
    const q = quotes.get(inst.symbol);
    const sum = summarizeDividends(divs, today, q?.price ?? null);
    table.push({
      symbol: inst.symbol,
      name: inst.nameKo,
      category: inst.category,
      categoryLabel: CATEGORY_LABELS[inst.category],
      word: distributionWord(inst),
      freq: FREQUENCY_KO[sum.frequency.label],
      latest: sum.latest ? { exDate: sum.latest.exDate, payDate: sum.latest.payDate, amount: sum.latest.amount } : null,
      ttm: sum.ttmSum,
      ttmCount: sum.ttmCount,
      ttmYield: sum.ttmYield,
      annualized: sum.annualizedLatest,
      annualizedYield: sum.annualizedLatestYield,
      next: sum.upcoming[0] ? { exDate: sum.upcoming[0].exDate, payDate: sum.upcoming[0].payDate, amount: sum.upcoming[0].amount } : null,
    });
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
    <div className="flex flex-col">
      <PageHeader title="배당·분배금" description={`일반 기업의 배당금과 ETF 의 분배금을 구분해 실제 지급 기록으로만 계산합니다 · ${today} 기준`} />
      <PanelTabs
        label="배당·분배금"
        variant="pill"
        tabs={[
          {
            key: "table",
            label: "종목별 요약",
            content: (
              <div className="flex flex-col gap-4">
                <Section title="최근 12개월 실제 지급" description="배당락일이 최근 365일 안인 정기 지급 합계 (특별분배 제외) · 종목을 누르면 자세한 기록">
                  <IncomeTable rows={table} />
                </Section>
                <Fold summary="표 읽는 법">
                  <ul className="list-disc pl-5 text-xs leading-relaxed">
                    <li>최근 12개월 실제 지급은 실제로 지급된 기록의 합계입니다. 연환산(가정)은 마지막 1회 지급액이 계속된다고 보고 연간 횟수를 곱한 참고값이며 확정 수입이 아닙니다.</li>
                    <li>분배금은 매번 달라질 수 있습니다. 옵션 인컴 ETF(JEPI·JEPQ·QYLD 등)는 시장 변동성에 따라 크게 바뀝니다.</li>
                    <li>분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다. 분배만큼 가격이 내려가거나 상승 참여가 제한될 수 있으니 가격 변화까지 합친 총수익률로 비교하세요.</li>
                    <li>발표되지 않은 미래 지급은 표시하지 않습니다.</li>
                  </ul>
                </Fold>
              </div>
            ),
          },
          { key: "planner", label: "보유 종목 현금흐름", content: <IncomePlanner assets={assets} asOf={today} /> },
        ]}
      />
    </div>
  );
}
