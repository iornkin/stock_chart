import { readAllDividends } from "@/lib/data/dividends";
import { addDays, etDate } from "@/lib/time";
import CalendarView, { monthRange, parseCalendarQuery, type CalendarDividend } from "@/components/CalendarView";
import CalendarStatic from "@/components/CalendarStatic";
import { perRequest, readSearchParams } from "@/lib/page-mode";
import { IS_STATIC } from "@/lib/static-mode";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "배당·분배금 캘린더" };

const slim = (d: CalendarDividend): CalendarDividend => ({ symbol: d.symbol, exDate: d.exDate, payDate: d.payDate, amount: d.amount });

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string; type?: string }> }) {
  await perRequest();
  const sp = await readSearchParams(searchParams);
  const today = etDate();
  const header = <PageHeader title="배당 캘린더" description="실제 발표된 배당락일·지급일만 표시합니다. 과거 패턴으로 추정한 일정은 넣지 않습니다." />;

  if (IS_STATIC) {
    // 정적 사이트: 약 2년 전부터 1년 뒤까지의 일정을 페이지에 담고 브라우저에서 달·분류를 바꾼다
    const coverage = { from: `${addDays(today, -730).slice(0, 7)}-01`, to: addDays(today, 366) };
    const divs = readAllDividends(coverage.from, coverage.to).map(slim);
    return (
      <div className="flex flex-col">
        {header}
        <CalendarStatic divs={divs} builtToday={today} coverage={coverage} />
      </div>
    );
  }

  const query = parseCalendarQuery(sp, today);
  const { first, last } = monthRange(query.month);
  const divs = readAllDividends(first, last).map(slim);
  return (
    <div className="flex flex-col">
      {header}
      <CalendarView query={query} today={today} divs={divs} />
    </div>
  );
}
