"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/client/prefs";
import { fetchQuotes } from "@/lib/client/data-api";
import { fmtPrice } from "@/lib/format";
import { getInstrument } from "@/lib/instruments";
import { PctBadge, Empty } from "./ui";

interface Q {
  symbol: string;
  price: number | null;
  changePct: number | null;
  fetchedAt: number;
}

export function useQuotes(symbols: string[]) {
  const [data, setData] = useState<Record<string, Q>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setLoading(true);
    fetchQuotes<Q>(key.split(","))
      .then((j) => {
        if (!alive) return;
        setData(Object.fromEntries(j.quotes.map((q) => [q.symbol, q])));
        setError(null);
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);
  return { data, error, loading };
}

export default function WatchlistPanel() {
  const [list, , hydrated] = useWatchlist();
  const { data, error, loading } = useQuotes(hydrated ? list : []);
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">관심 종목</h2>
        <Link href="/watchlist" className="text-xs link">관리</Link>
      </div>
      {!hydrated ? (
        <div className="skeleton h-24" />
      ) : list.length === 0 ? (
        <Empty>관심 종목이 없습니다. 종목 상세 페이지의 ☆ 버튼으로 추가하세요.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {list.map((s) => {
            const q = data[s];
            return (
              <li key={s} className="flex items-center justify-between py-1.5">
                <Link href={`/stock/${s}`} className="hover:text-accent">
                  <span className="font-semibold">{s}</span> <span className="text-xs text-muted">{getInstrument(s)?.nameKo}</span>
                </Link>
                <span className="flex items-center gap-2">
                  {q ? (
                    <>
                      <span className="num text-xs">${fmtPrice(q.price)}</span>
                      <PctBadge pct={q.changePct} />
                    </>
                  ) : loading ? (
                    <span className="skeleton inline-block h-4 w-16" />
                  ) : (
                    <span className="text-xs text-muted">데이터 없음</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-critical">시세 조회 실패: {error}</p>}
    </section>
  );
}
