/** 일일 브리핑 목록 본문 (서버·브라우저 공용 표시 컴포넌트) */
import Link from "next/link";
import type { BriefingListItem } from "@/lib/briefing/store";
import type { MarketBriefing, SessionType } from "@/lib/briefing/types";
import { byCategory, getInstrument } from "@/lib/instruments";
import { MarketBriefingView } from "./BriefingView";
import { Empty, Section } from "./ui";

export const SESSION_KO: Record<SessionType, string> = { close: "장 마감 후", intraday: "장중", non_trading: "휴장일" };

/** 한 거래일의 브리핑 묶음 (정적 사이트에서는 data/briefing/day/{date}.json) */
export interface BriefingDay {
  date: string;
  items: BriefingListItem[];
  markets: Partial<Record<SessionType, MarketBriefing>>;
}

/** 요청한 세션이 없으면 장 마감 후 → 첫 번째 세션 순으로 고른다 */
export function pickSession(items: BriefingListItem[], wanted?: string | null): SessionType | undefined {
  const sessions = [...new Set(items.map((i) => i.session))];
  if (wanted && sessions.includes(wanted as SessionType)) return wanted as SessionType;
  return sessions.includes("close") ? "close" : sessions[0];
}

export interface BriefingIndexProps {
  dates: string[];
  date: string | undefined;
  session: SessionType | undefined;
  items: BriefingListItem[];
  market: MarketBriefing | null;
}

export default function BriefingIndexView({ dates, date, session, items, market }: BriefingIndexProps) {
  const sessions = [...new Set(items.map((i) => i.session))];
  const map = new Map(items.filter((i) => i.session === session).map((i) => [i.scope, i]));
  return (
    <>
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
        <Section title="오늘의 시장 브리핑">{market ? <MarketBriefingView b={market} /> : <Empty>시장 브리핑이 없습니다.</Empty>}</Section>
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
    </>
  );
}
