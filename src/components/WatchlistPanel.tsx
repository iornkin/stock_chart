"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/client/prefs";
import { fetchDigests, fetchQuotes } from "@/lib/client/data-api";
import type { BriefingDigest } from "@/lib/briefing/digest";
import { fmtPrice } from "@/lib/format";
import { getInstrument } from "@/lib/instruments";
import ChangeChips from "./ChangeChips";
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

/** 대시보드: 관심 종목의 시세와 최신 브리핑에서 새로 생긴 변화 */
export default function WatchlistPanel() {
  const [list, , hydrated] = useWatchlist();
  const { data, error, loading } = useQuotes(hydrated ? list : []);
  const [digests, setDigests] = useState<Record<string, BriefingDigest>>({});
  const key = hydrated ? list.join(",") : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetchDigests(key.split(","))
      .then((d) => alive && setDigests(d))
      .catch(() => alive && setDigests({}));
    return () => {
      alive = false;
    };
  }, [key]);
  const changed = list.filter((s) => (digests[s]?.maxImportance ?? 0) >= 2).length;
  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">관심 종목</h2>
          {hydrated && list.length > 0 && <p className="mt-0.5 text-xs text-muted">{changed ? `${list.length}개 중 ${changed}개에 새 변화` : "새로 생긴 중요한 변화 없음"}</p>}
        </div>
        <Link href="/watchlist" className="text-xs link">
          관리
        </Link>
      </div>
      {!hydrated ? (
        <div className="skeleton h-24" />
      ) : list.length === 0 ? (
        <Empty>관심 종목이 없습니다. 종목 상세 페이지의 ☆ 버튼으로 추가하세요.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((s) => {
            const q = data[s];
            const d = digests[s];
            return (
              <li key={s} className="flex flex-col gap-1.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/stock/${s}?tab=briefing`} className="min-w-0 hover:text-accent">
                    <span className="font-semibold">{s}</span> <span className="text-xs text-muted">{getInstrument(s)?.nameKo}</span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    {q ? (
                      <>
                        <span className="num text-sm">${fmtPrice(q.price)}</span>
                        <PctBadge pct={q.changePct} />
                      </>
                    ) : loading ? (
                      <span className="skeleton inline-block h-4 w-16" />
                    ) : (
                      <span className="text-xs text-muted">데이터 없음</span>
                    )}
                  </span>
                </div>
                {d && <ChangeChips d={d} max={2} minImportance={2} />}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-critical">시세 조회 실패: {error}</p>}
    </section>
  );
}
