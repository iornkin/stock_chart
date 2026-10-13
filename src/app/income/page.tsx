import { INSTRUMENTS } from "@/config/instruments";
import { readDividends } from "@/lib/data/dividends";
import { readQuotes } from "@/lib/data/quotes";
import { FREQUENCY_KO, isRegular, summarizeDividends } from "@/lib/dividend-analytics";
import { distributionWord } from "@/lib/instruments";
import { addDays, etDate } from "@/lib/time";
import { perRequest } from "@/lib/page-mode";
import IncomePlanner, { type IncomeAsset } from "@/components/IncomePlanner";
import Link from "next/link";
import { CATEGORY_LABELS } from "@/config/instruments";
import { Section } from "@/components/ui";
import { fmtPct } from "@/lib/format";

export const metadata = { title: "배당·분배금" };

export default async function IncomePage() {
  await perRequest();
  const today = etDate();
  const quotes = readQuotes(INSTRUMENTS.map((i) => i.symbol));
  const assets: IncomeAsset[] = [];
  const table: { symbol: string; name: string; category: string; word: string; freq: string; latest: { exDate: string; payDate: string | null; amount: number } | null; ttm: number; ttmCount: number; ttmYield: number | null; annualized: number | null; annualizedYield: number | null; next: { exDate: string; payDate: string | null; amount: number } | null }[] = [];
  for (const inst of INSTRUMENTS) {
    const divs = readDividends(inst.symbol);
    if (!divs.length) continue;
    const q = quotes.get(inst.symbol);
    const sum = summarizeDividends(divs, today, q?.price ?? null);
    table.push({
      symbol: inst.symbol,
      name: inst.nameKo,
      category: CATEGORY_LABELS[inst.category],
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">배당·분배금</h1>
        <p className="mt-1 text-sm text-ink-2">일반 기업이 이익에서 주는 <b>배당금</b>과 ETF 가 보유 자산의 배당·옵션 프리미엄·이자 등에서 나눠 주는 <b>분배금</b>을 구분해, 실제 지급 기록으로만 계산합니다.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Link href="/calendar" className="btn btn-sm">배당락·지급 캘린더</Link>
          <Link href="/portfolio" className="btn btn-sm">내 자산의 분배금</Link>
          <Link href="/stress" className="btn btn-sm">분배금 감소 스트레스 테스트</Link>
          <Link href="/backtest" className="btn btn-sm">재투자 여부 백테스트</Link>
        </div>
      </div>

      <Section title="종목별 지급 요약" description={`${today} 기준 · 최근 12개월 = 배당락일이 최근 365일 안인 정기 지급 합계 (특별·자본이득 분배 제외) · 종목을 누르면 지급 내역·증감 추이·재투자 비교를 볼 수 있습니다`}>
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th>종목</th>
                <th>구분</th>
                <th>지급 빈도</th>
                <th className="r">최근 지급액</th>
                <th className="r">최근 12개월 실제 지급</th>
                <th className="r">최근 12개월 수익률</th>
                <th className="r">최근 지급액 연환산 (가정)</th>
                <th>다음 발표된 지급</th>
              </tr>
            </thead>
            <tbody>
              {table.map((t) => (
                <tr key={t.symbol}>
                  <td>
                    <Link href={`/stock/${t.symbol}?tab=dividends`} className="font-semibold hover:text-accent">{t.symbol}</Link>
                    <span className="block text-[11px] text-muted">{t.name} · {t.category}</span>
                  </td>
                  <td className="text-xs">{t.word}</td>
                  <td className="text-xs">{t.freq}</td>
                  <td className="r">{t.latest ? <>${t.latest.amount.toFixed(4)}<span className="block text-[11px] text-muted">배당락 {t.latest.exDate}</span></> : "-"}</td>
                  <td className="r">{t.ttmCount ? <>${t.ttm.toFixed(4)}<span className="block text-[11px] text-muted">{t.ttmCount}회</span></> : "-"}</td>
                  <td className="r">{fmtPct(t.ttmYield, 2, false)}</td>
                  <td className="r text-ink-2">{t.annualized !== null ? <>${t.annualized.toFixed(4)}<span className="block text-[11px]">{fmtPct(t.annualizedYield, 2, false)}</span></> : <span className="text-xs text-muted">주기 불규칙 — 계산 안 함</span>}</td>
                  <td className="text-xs">{t.next ? `배당락 ${t.next.exDate} · 지급 ${t.next.payDate ?? "미제공"} · $${t.next.amount.toFixed(4)}` : <span className="text-muted">발표된 일정 없음</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 list-disc pl-5 text-xs leading-relaxed text-ink-2">
          <li><b>최근 12개월 실제 지급</b>은 실제로 지급된 기록의 합계입니다. <b>최근 지급액 연환산</b>은 마지막 1회 지급액이 앞으로도 같다고 가정해 연간 횟수를 곱한 참고값이며 확정된 연간 수입이 아닙니다.</li>
          <li>분배금은 매번 달라질 수 있습니다. 특히 옵션 인컴 ETF(JEPI·JEPQ·QYLD 등)는 시장 변동성에 따라 크게 바뀝니다.</li>
          <li>분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다. 분배금을 지급하면 그만큼 가격(NAV)이 내려가고, 커버드콜 전략은 상승장에서 가격 상승 참여가 제한됩니다. 가격 변화와 분배금을 합친 총수익률로 비교하세요.</li>
          <li>발표되지 않은 미래 지급은 표시하지 않으며, 예정 지급도 실제로 받기 전까지 확정 현금수입으로 계산하지 않습니다.</li>
        </ul>
      </Section>

      <IncomePlanner assets={assets} asOf={today} />
    </div>
  );
}
