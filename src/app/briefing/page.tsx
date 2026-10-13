import Link from "next/link";
import { availableBriefingDates, briefingsForDate, latestBriefing, readBriefing } from "@/lib/briefing/store";
import type { MarketBriefing, SessionType } from "@/lib/briefing/types";
import { byCategory, getInstrument } from "@/lib/instruments";
import { formatEt } from "@/lib/time";
import { MarketBriefingView } from "@/components/BriefingView";
import { Empty, Notice, Section } from "@/components/ui";
import { dataHealth } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "일일 투자 브리핑" };

const SESSION_KO: Record<SessionType, string> = { close: "장 마감 후", intraday: "장중", non_trading: "휴장일" };

export default async function BriefingIndex({ searchParams }: { searchParams: Promise<{ date?: string; session?: string }> }) {
  const sp = await searchParams;
  const dates = availableBriefingDates(30);
  const date = sp.date && dates.includes(sp.date) ? sp.date : dates[0];
  const items = date ? briefingsForDate(date) : [];
  const sessions = [...new Set(items.map((i) => i.session))];
  const session = (sp.session && sessions.includes(sp.session as SessionType) ? sp.session : sessions.includes("close") ? "close" : sessions[0]) as SessionType | undefined;
  const market = date && session ? readBriefing<MarketBriefing>("MARKET", date, session) : latestBriefing<MarketBriefing>("MARKET");
  const map = new Map(items.filter((i) => i.session === session).map((i) => [i.scope, i]));
  const health = dataHealth();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">일일 투자 브리핑</h1>
        <p className="text-sm text-muted">
          수집된 주가·거래량·뉴스·일정 데이터로 종목마다 따로 생성한 브리핑입니다. 장중 브리핑과 장 마감 후 브리핑(정규장 데이터 확정 후)은 구분됩니다.
        </p>
      </div>
      {health.briefingFail && (
        <Notice tone="warn" title="최근 브리핑 생성 작업 실패">
          {health.briefingFail.message} · 마지막 정상 생성: {health.briefingOk ? formatEt(health.briefingOk) : "기록 없음"}
        </Notice>
      )}
      {dates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">분석 기준일</span>
          {dates.slice(0, 10).map((d) => (
            <Link key={d} href={`/briefing?date=${d}`} className={`rounded-md border px-2 py-1 text-xs ${d === date ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>
              {d}
            </Link>
          ))}
          {sessions.length > 1 &&
            sessions.map((s) => (
              <Link key={s} href={`/briefing?date=${date}&session=${s}`} className={`rounded-md border px-2 py-1 text-xs ${s === session ? "border-accent text-accent" : "border-line"}`}>
                {SESSION_KO[s]}
              </Link>
            ))}
        </div>
      )}
      {!dates.length && <Empty>아직 생성된 브리핑이 없습니다. 워커를 실행하면 미국 시장 일정에 맞춰 자동 생성됩니다.</Empty>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Section title="오늘의 시장 브리핑">{market ? <MarketBriefingView b={market.content} /> : <Empty>시장 브리핑이 없습니다.</Empty>}</Section>
        <div className="flex flex-col gap-4">
          {byCategory().map((g) => (
            <Section key={g.category} title={g.label}>
              <ul className="flex flex-col divide-y divide-line">
                {g.items.map((i) => {
                  const b = map.get(i.symbol);
                  return (
                    <li key={i.symbol} className="py-2">
                      <Link href={`/briefing/${i.symbol}${date ? `?date=${date}&session=${session}` : ""}`} className="group block">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold group-hover:text-accent">
                            {getInstrument(i.symbol)?.nameKo} 오늘의 브리핑 <span className="text-xs font-normal text-muted">{i.symbol}</span>
                          </span>
                          {b && <span className="text-[10px] text-muted">{SESSION_KO[b.session]}</span>}
                        </div>
                        <p className="truncate text-xs text-ink-2">{b ? b.headline : "이 날짜의 브리핑 없음"}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}
