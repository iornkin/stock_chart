"use client";
import { useWatchlist } from "@/lib/client/prefs";

export default function WatchButton({ symbol }: { symbol: string }) {
  const [list, toggle, hydrated] = useWatchlist();
  const on = hydrated && list.includes(symbol);
  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-warn bg-warn-soft text-warn" : "border-line text-ink-2 hover:border-accent"}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {on ? "관심 종목에 추가됨" : "관심 종목 추가"}
    </button>
  );
}
