import Link from "next/link";
import { readAllDividends } from "@/lib/data/dividends";
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category } from "@/config/instruments";
import { getInstrument } from "@/lib/instruments";
import { holidayName } from "@/lib/market-calendar";
import { etDate, pad2 } from "@/lib/time";
import { fmtDividend } from "@/lib/format";
import { Empty, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "배당·분배금 캘린더" };

interface Ev {
  symbol: string;
  type: "ex" | "pay";
  amount: number;
  date: string;
  other: string | null;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string; type?: string }> }) {
  const sp = await searchParams;
  const today = etDate();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const category = CATEGORY_ORDER.includes(sp.category as Category) ? (sp.category as Category) : null;
  const type = sp.type === "ex" || sp.type === "pay" ? sp.type : "all";
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${pad2(lastDay)}`;
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;

  const divs = readAllDividends(first, last).filter((d) => {
    const i = getInstrument(d.symbol);
    return i && (!category || i.category === category);
  });
  const events: Ev[] = [];
  for (const d of divs) {
    if (type !== "pay" && d.exDate >= first && d.exDate <= last) events.push({ symbol: d.symbol, type: "ex", amount: d.amount, date: d.exDate, other: d.payDate });
    if (type !== "ex" && d.payDate && d.payDate >= first && d.payDate <= last) events.push({ symbol: d.symbol, type: "pay", amount: d.amount, date: d.payDate, other: d.exDate });
  }
  const byDate = new Map<string, Ev[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const startWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (string | null)[] = [...Array(startWd).fill(null), ...Array.from({ length: lastDay }, (_, i) => `${month}-${pad2(i + 1)}`)];
  while (cells.length % 7) cells.push(null);

  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { month, category, type, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "type" && v === "all")) p.set(k, v);
    return `/calendar?${p}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">배당·분배금 캘린더</h1>
        <p className="text-sm text-muted">실제 수집된 배당락일·지급일만 표시합니다. 미래 일정은 발표된 경우에만 나타나며, 과거 패턴으로 추정한 일정은 표시하지 않습니다.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={q({ month: prevMonth })} className="rounded-md border border-line px-2 py-1">← 이전 달</Link>
        <span className="num font-semibold">{y}년 {m}월</span>
        <Link href={q({ month: nextMonth })} className="rounded-md border border-line px-2 py-1">다음 달 →</Link>
        <Link href={q({ month: today.slice(0, 7) })} className="rounded-md border border-line px-2 py-1 text-xs">이번 달</Link>
        <span className="mx-2 h-4 w-px bg-line" />
        {(["all", "ex", "pay"] as const).map((t) => (
          <Link key={t} href={q({ type: t })} className={`rounded-md border px-2 py-1 text-xs ${type === t ? "border-accent text-accent" : "border-line"}`}>
            {t === "all" ? "전체" : t === "ex" ? "배당락일" : "지급일"}
          </Link>
        ))}
        <span className="mx-2 h-4 w-px bg-line" />
        <Link href={q({ category: null })} className={`rounded-md border px-2 py-1 text-xs ${!category ? "border-accent text-accent" : "border-line"}`}>전체 분류</Link>
        {CATEGORY_ORDER.map((c) => (
          <Link key={c} href={q({ category: c })} className={`rounded-md border px-2 py-1 text-xs ${category === c ? "border-accent text-accent" : "border-line"}`}>
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      <Section title={`${y}년 ${m}월`} description="락 = 배당락일(이날 이전에 보유해야 지급 대상), 지급 = 지급일. 날짜는 미국 동부 기준">
        <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div key={d} className="bg-surface-2 px-2 py-1 text-center text-xs font-semibold text-ink-2">{d}</div>
          ))}
          {cells.map((d, i) => {
            const evs = d ? byDate.get(d) ?? [] : [];
            const hol = d ? holidayName(d) : null;
            return (
              <div key={i} className={`min-h-24 bg-surface p-1.5 ${d === today ? "ring-2 ring-inset ring-accent" : ""}`}>
                {d && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="num text-muted">{Number(d.slice(8))}</span>
                      {hol && <span className="truncate text-[10px] text-critical" title={hol}>휴장</span>}
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {evs.slice(0, 6).map((e, k) => (
                        <li key={k}>
                          <Link href={`/stock/${e.symbol}?tab=dividends`} title={`${e.symbol} ${e.type === "ex" ? "배당락" : "지급"} ${fmtDividend(e.amount)}`} className={`block truncate rounded px-1 text-[11px] ${e.type === "ex" ? "bg-accent-soft text-accent" : "bg-surface-3 text-ink"}`}>
                            {e.type === "ex" ? "락" : "지급"} {e.symbol} {fmtDividend(e.amount)}
                          </Link>
                        </li>
                      ))}
                      {evs.length > 6 && <li className="text-[10px] text-muted">외 {evs.length - 6}건</li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">목록 보기</h3>
          {events.length ? (
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>구분</th>
                    <th>종목</th>
                    <th className="r">주당 금액</th>
                    <th>{type === "pay" ? "배당락일" : "관련 날짜"}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...events].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)).map((e, i) => (
                    <tr key={i} className={e.date > today ? "" : "text-ink-2"}>
                      <td className="num">{e.date}</td>
                      <td>{e.type === "ex" ? "배당락일" : "지급일"}</td>
                      <td>
                        <Link href={`/stock/${e.symbol}?tab=dividends`} className="font-semibold hover:text-accent">{e.symbol}</Link>{" "}
                        <span className="text-xs text-muted">{getInstrument(e.symbol)?.nameKo}</span>
                      </td>
                      <td className="r">{fmtDividend(e.amount)}</td>
                      <td className="num text-xs">{e.type === "ex" ? `지급일 ${e.other ?? "미제공"}` : `배당락일 ${e.other}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>이 달에 수집된 배당락·지급 일정이 없습니다.</Empty>
          )}
        </div>
      </Section>
    </div>
  );
}
