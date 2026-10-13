"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { INSTRUMENTS, CATEGORY_LABELS, CATEGORY_ORDER } from "@/config/instruments";
import { setPrefs, useWatchlist } from "@/lib/client/prefs";
import { fmtCompact, fmtPrice } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { Empty, PctBadge } from "./ui";

interface Q {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  avgVolume3m: number | null;
  fetchedAt: number;
  freshness: string;
}
interface B {
  scope: string;
  headline: string | null;
  tradeDate: string;
  session: string;
}

export default function WatchlistClient() {
  const [list, toggle, hydrated] = useWatchlist();
  const [quotes, setQuotes] = useState<Record<string, Q>>({});
  const [briefs, setBriefs] = useState<Record<string, B>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = list.join(",");

  useEffect(() => {
    if (!hydrated || !key) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/quotes?symbols=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { quotes: Q[] }) => alive && setQuotes(Object.fromEntries(j.quotes.map((q) => [q.symbol, q]))))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    Promise.all(
      key.split(",").map((s) =>
        fetch(`/api/briefing/${s}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((rs) => {
      if (!alive) return;
      const out: Record<string, B> = {};
      for (const r of rs) if (r) out[r.scope] = r;
      setBriefs(out);
    });
    return () => {
      alive = false;
    };
  }, [key, hydrated]);

  const move = (i: number, d: number) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPrefs({ watchlist: next });
  };

  if (!hydrated) return <div className="skeleton h-40" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">종목 추가</span>
          <select
            value=""
            onChange={(e) => e.target.value && toggle(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1"
          >
            <option value="">지원 종목 선택…</option>
            {CATEGORY_ORDER.map((c) => (
              <optgroup key={c} label={CATEGORY_LABELS[c]}>
                {INSTRUMENTS.filter((i) => i.category === c && !list.includes(i.symbol)).map((i) => (
                  <option key={i.symbol} value={i.symbol}>
                    {i.symbol} · {i.nameKo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-critical">시세 조회 실패: {error}</p>}
      {list.length === 0 ? (
        <Empty>관심 종목이 없습니다.</Empty>
      ) : (
        <div className="card overflow-x-auto p-2">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th className="r">현재가</th>
                <th className="r">등락</th>
                <th className="r">거래량 / 3개월 평균</th>
                <th>최신 브리핑</th>
                <th>갱신</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s, i) => {
                const q = quotes[s];
                const b = briefs[s];
                return (
                  <tr key={s}>
                    <td>
                      <Link href={`/stock/${s}`} className="font-semibold hover:text-accent">{s}</Link>
                      <span className="block text-xs text-muted">{INSTRUMENTS.find((x) => x.symbol === s)?.nameKo}</span>
                    </td>
                    <td className="r">{q ? `$${fmtPrice(q.price)}` : loading ? "…" : "-"}</td>
                    <td className="r">{q ? <PctBadge pct={q.changePct} /> : "-"}</td>
                    <td className="r">{q ? `${fmtCompact(q.volume)} / ${fmtCompact(q.avgVolume3m)}` : "-"}</td>
                    <td className="max-w-xs">
                      {b ? (
                        <Link href={`/stock/${s}?tab=briefing`} className="block truncate text-xs hover:text-accent">
                          {b.tradeDate} · {b.headline}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">없음</span>
                      )}
                    </td>
                    <td className={`text-xs ${q?.freshness === "stale" ? "text-warn" : "text-muted"}`}>{q ? formatEt(q.fetchedAt) : "-"}</td>
                    <td className="whitespace-nowrap text-xs">
                      <button type="button" onClick={() => move(i, -1)} aria-label={`${s} 위로`} className="px-1">↑</button>
                      <button type="button" onClick={() => move(i, 1)} aria-label={`${s} 아래로`} className="px-1">↓</button>
                      <button type="button" onClick={() => toggle(s)} className="ml-1 text-critical">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
