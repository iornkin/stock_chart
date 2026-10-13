import CompareClient from "@/components/CompareClient";
import { PageHeader } from "@/components/ui";
import { isSupported, normalizeSymbol } from "@/lib/instruments";
import { readSearchParams } from "@/lib/page-mode";

export const metadata = { title: "종목 비교" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ symbols?: string }> }) {
  const sp = await readSearchParams(searchParams);
  const initial = (sp.symbols ?? "QQQ,VOO").split(",").map(normalizeSymbol).filter(isSupported).slice(0, 5);
  return (
    <div className="flex flex-col">
      <PageHeader title="종목 비교" description="같은 시작값(100)으로 맞춰 비교합니다. 가격 수익률과 분배금을 포함한 총수익률을 구분합니다." />
      <section className="card p-4 sm:p-6">
        <CompareClient initial={initial.length >= 2 ? initial : ["QQQ", "VOO"]} />
      </section>
    </div>
  );
}
