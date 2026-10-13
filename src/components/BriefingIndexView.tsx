/** 일일 브리핑 목록 본문 (서버·브라우저 공용 표시 컴포넌트) */
import Link from "next/link";
import type { BriefingListItem } from "@/lib/briefing/store";
import type { MarketBriefing, SessionType } from "@/lib/briefing/types";
import { byCategory, getInstrument } from "@/lib/instruments";
import { MarketBriefingView } from "./BriefingView";
import { Empty, Section } from "./ui";
import PanelTabs from "./PanelTabs";

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
  const q = (sym: string) => `/briefing/${sym}${date ? `?date=${date}&session=${session}` : ""}`;
  if (!dates.length) return <Empty>아직 생성된 브리핑이 없습니다. 워커를 실행하면 미국 시장 일정에 맞춰 자동 생성됩니다.</Empty>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-xs text-muted">분석 기준일</span>
        <div className="flex flex-wrap gap-1">
          {dates.slice(0, 7).map((d) => (
            <Link key={d} href={`/briefing?date=${d}`} aria-current={d === date ? "page" : undefined} className={`num rounded-md px-2 py-1 text-xs ${d === date ? "bg-accent text-white" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
              {d.slice(5).replace("-", "/")}
            </Link>
          ))}
        </div>
        {sessions.length > 1 && (
          <div className="seg">
            {sessions.map((s) => (
              <Link key={s} href={`/briefing?date=${date}&session=${s}`} aria-current={s === session ? "page" : undefined}>
                {SESSION_KO[s]}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Section title="시장 브리핑" right={market ? <Link href={q("MARKET")} className="link text-xs">전체 보기 ›</Link> : undefined}>
          {market ? <MarketBriefingView b={market} compact /> : <Empty>시장 브리핑이 없습니다.</Empty>}
        </Section>
        <Section title="종목별 브리핑" description={`${date ?? "-"} ${session ? SESSION_KO[session] : ""} · 종목을 누르면 전체 내용을 봅니다`}>
          <PanelTabs
            label="종목 분류"
            variant="pill"
            tabs={byCategory().map((g) => ({
              key: g.category,
              label: g.label.replace(/ ETF$/, ""),
              content: (
                <ul className="flex flex-col divide-y divide-line">
                  {g.items.map((i) => {
                    const b = map.get(i.symbol);
                    return (
                      <li key={i.symbol}>
                        <Link href={q(i.symbol)} className="group flex items-baseline gap-3 py-2">
                          <span className="w-16 shrink-0 whitespace-nowrap font-semibold group-hover:text-accent">{i.symbol}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-ink-2">{b ? b.headline : "이 날짜의 브리핑 없음"}</span>
                            <span className="block truncate text-[11px] text-muted">{getInstrument(i.symbol)?.nameKo}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ),
            }))}
          />
        </Section>
      </div>
    </>
  );
}
