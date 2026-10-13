"use client";
/**
 * 지원 종목 검색 (설정 파일에 등록된 종목만 검색 — 무제한 검색 사이트가 아님)
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { INSTRUMENTS, CATEGORY_LABELS } from "@/config/instruments";

export default function SymbolSearch({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return INSTRUMENTS.filter((i) => i.core).slice(0, 8);
    return INSTRUMENTS.filter(
      (i) =>
        i.symbol.includes(s) ||
        (i.formerSymbols ?? []).some((f) => f.includes(s)) ||
        i.name.toUpperCase().includes(s) ||
        i.nameKo.includes(q.trim()),
    )
      .sort((a, b) => (a.symbol.startsWith(s) ? 0 : 1) - (b.symbol.startsWith(s) ? 0 : 1))
      .slice(0, 10);
  }, [q]);

  const go = (sym: string) => {
    setOpen(false);
    setQ("");
    onDone?.();
    router.push(`/stock/${sym}`);
  };

  return (
    <div className="relative w-full">
      <label htmlFor="symbol-search" className="sr-only">
        지원 종목 검색
      </label>
      <input
        id="symbol-search"
        ref={inputRef}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) go(results[active].symbol);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="티커·종목명 검색 (지원 종목 한정)"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="symbol-search-list"
        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {open && (
        <ul id="symbol-search-list" role="listbox" className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">지원 종목 중 일치하는 종목이 없습니다</li>}
          {results.map((r, i) => (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r.symbol);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${i === active ? "bg-surface-2" : ""}`}
            >
              <span>
                <span className="font-semibold">{r.symbol}</span> <span className="text-ink-2">{r.nameKo}</span>
              </span>
              <span className="text-xs text-muted">{CATEGORY_LABELS[r.category]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
