import CompareClient from "@/components/CompareClient";
import { Section } from "@/components/ui";
import { isSupported, normalizeSymbol } from "@/lib/instruments";
import { readSearchParams } from "@/lib/page-mode";

export const metadata = { title: "종목 비교" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ symbols?: string }> }) {
  const sp = await readSearchParams(searchParams);
  const initial = (sp.symbols ?? "QQQ,VOO").split(",").map(normalizeSymbol).filter(isSupported).slice(0, 5);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">종목 비교 · 과거 성과 분석</h1>
        <p className="text-sm text-muted">가격대가 다른 종목도 같은 시작값(100)으로 정규화해 비교합니다. 가격 수익률과 분배금 포함 총수익률을 구분합니다.</p>
      </div>
      <Section title="비교 차트와 성과">
        <CompareClient initial={initial.length >= 2 ? initial : ["QQQ", "VOO"]} />
      </Section>
    </div>
  );
}
