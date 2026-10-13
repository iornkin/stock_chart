import { availableBriefingDates, briefingsForDate, latestBriefing, readBriefing } from "@/lib/briefing/store";
import type { MarketBriefing } from "@/lib/briefing/types";
import { formatEt } from "@/lib/time";
import BriefingIndexView, { pickSession, type BriefingIndexProps } from "@/components/BriefingIndexView";
import { BriefingIndexStatic } from "@/components/BriefingStaticClient";
import { Notice, PageHeader } from "@/components/ui";
import { dataHealth } from "@/lib/views";
import { perRequest, readSearchParams } from "@/lib/page-mode";
import { IS_STATIC } from "@/lib/static-mode";

export const metadata = { title: "일일 투자 브리핑" };

export default async function BriefingIndex({ searchParams }: { searchParams: Promise<{ date?: string; session?: string }> }) {
  await perRequest();
  const sp = await readSearchParams(searchParams);
  const dates = availableBriefingDates(30);
  const date = sp.date && dates.includes(sp.date) ? sp.date : dates[0];
  const items = date ? briefingsForDate(date) : [];
  const session = pickSession(items, sp.session);
  const market = date && session ? readBriefing<MarketBriefing>("MARKET", date, session) : latestBriefing<MarketBriefing>("MARKET");
  const health = dataHealth();
  const props: BriefingIndexProps = { dates, date, session, items, market: market?.content ?? null };

  return (
    <div className="flex flex-col">
      <PageHeader title="일일 브리핑" description="수집한 주가·거래량·뉴스·일정으로 종목마다 만든 요약입니다. 장중과 장 마감 후(정규장 데이터 확정 후)를 구분합니다." />
      <div className="flex flex-col gap-5">
        {health.briefingFail && (
          <Notice tone="warn" title="최근 브리핑 생성 작업 실패">
            {health.briefingFail.message} · 마지막 정상 생성: {health.briefingOk ? formatEt(health.briefingOk) : "기록 없음"}
          </Notice>
        )}
        {IS_STATIC ? <BriefingIndexStatic initial={props} /> : <BriefingIndexView {...props} />}
      </div>
    </div>
  );
}
