"use client";
/** 내 자산·백테스트·시뮬레이터 화면에서 함께 쓰는 입력·표시 조각 */
import Link from "next/link";
import { useId, useMemo, type ReactNode } from "react";
import { CATEGORY_LABELS, CATEGORY_ORDER, INSTRUMENTS } from "@/config/instruments";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { fmtPct, isNum } from "@/lib/format";
import { usePrefs } from "@/lib/client/prefs";

// ─────────────────────────────── 숫자 표시 ───────────────────────────────

export function usd(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "-";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? "−" : ""}$${s}`;
}

export function krw(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  return `${v < 0 ? "−" : ""}₩${Math.round(Math.abs(v)).toLocaleString("ko-KR")}`;
}

export function signedKrw(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  const r = Math.round(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}₩${Math.abs(r).toLocaleString("ko-KR")}`;
}

export function signedUsd(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(v: number | null | undefined, digits = 2): string {
  return fmtPct(v ?? null, digits);
}

export function tone(v: number | null | undefined): string {
  if (!isNum(v) || Math.abs(v) < 1e-9) return "text-muted";
  return v > 0 ? "text-up" : "text-down";
}

export function parseNum(s: string): number {
  const v = Number(String(s).replace(/[,\s$₩%]/g, ""));
  return Number.isFinite(v) ? v : NaN;
}

/** USD 금액 + (설정에서 켠 경우) 현재 환율 원화 환산 */
export function Money({ v, fx, signed = false, className = "" }: { v: number | null | undefined; fx?: number | null; signed?: boolean; className?: string }) {
  const [prefs] = usePrefs();
  return (
    <span className={className}>
      <span className="num">{signed ? signedUsd(v) : usd(v)}</span>
      {prefs.showKrw && fx && isNum(v) && <span className="num block text-[11px] font-normal text-muted">≈ {krw(v * fx)}</span>}
    </span>
  );
}

// ─────────────────────────────── 입력 ───────────────────────────────

export function Field({ label, children, hint, className = "" }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug">{hint}</span>}
    </label>
  );
}

export function Seg<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** 지원 종목만 고를 수 있는 티커 입력 (목록에 없는 티커는 안내) */
export function SymbolField({ value, onChange, label = "티커", id, exclude = [] }: { value: string; onChange: (v: string) => void; label?: string; id?: string; exclude?: string[] }) {
  const auto = useId();
  const listId = `${auto}-symbols`;
  const v = value.trim();
  const norm = v ? normalizeSymbol(v) : "";
  const inst = norm ? getInstrument(norm) : undefined;
  const unsupported = v.length > 0 && !inst;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onBlur={() => inst && inst.symbol !== value && onChange(inst.symbol)}
        aria-label={label}
        aria-invalid={unsupported}
        placeholder="예: SCHD"
        className="input w-full uppercase"
        autoComplete="off"
      />
      <datalist id={listId}>
        {INSTRUMENTS.filter((i) => !exclude.includes(i.symbol)).map((i) => (
          <option key={i.symbol} value={i.symbol}>
            {i.nameKo}
          </option>
        ))}
      </datalist>
      {unsupported && <span className="text-[11px] text-critical">{v}: 지원하지 않는 종목입니다. 지원 목록(미국 주식·ETF {INSTRUMENTS.length}개)에서 고르세요.</span>}
      {inst && <span className="truncate text-[11px] text-muted">{inst.nameKo}{inst.leverage ? ` · ${inst.leverage}배 레버리지` : ""}</span>}
    </div>
  );
}

/** 지원 종목 선택 상자 (분류별) */
export function SymbolSelect({ value, onChange, label, includeNone, extra }: { value: string; onChange: (v: string) => void; label: string; includeNone?: string; extra?: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="input">
      {includeNone !== undefined && <option value="">{includeNone}</option>}
      {extra?.map((e) => (
        <option key={e.v} value={e.v}>
          {e.l}
        </option>
      ))}
      {CATEGORY_ORDER.map((c) => (
        <optgroup key={c} label={CATEGORY_LABELS[c]}>
          {INSTRUMENTS.filter((i) => i.category === c).map((i) => (
            <option key={i.symbol} value={i.symbol}>
              {i.symbol} · {i.nameKo}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─────────────────────────────── 포트폴리오 비중 편집 ───────────────────────────────

export interface WeightRow {
  symbol: string;
  weight: string;
}

export const PRESETS: { name: string; items: { symbol: string; weight: number }[] }[] = [
  { name: "SCHD 50% + DIVO 50%", items: [{ symbol: "SCHD", weight: 50 }, { symbol: "DIVO", weight: 50 }] },
  { name: "QQQ 50% + SCHD 50%", items: [{ symbol: "QQQ", weight: 50 }, { symbol: "SCHD", weight: 50 }] },
  { name: "JEPI 50% + JEPQ 50%", items: [{ symbol: "JEPI", weight: 50 }, { symbol: "JEPQ", weight: 50 }] },
  { name: "VOO 50% + JEPI 50%", items: [{ symbol: "VOO", weight: 50 }, { symbol: "JEPI", weight: 50 }] },
  { name: "QQQ 40% + SCHD 30% + DIVO 30%", items: [{ symbol: "QQQ", weight: 40 }, { symbol: "SCHD", weight: 30 }, { symbol: "DIVO", weight: 30 }] },
];

export function rowsFrom(items: { symbol: string; weight: number }[]): WeightRow[] {
  return items.map((i) => ({ symbol: i.symbol, weight: String(Math.round(i.weight * 10000) / 10000) }));
}

export function rowsToItems(rows: WeightRow[]): { symbol: string; weight: number }[] {
  return rows.filter((r) => r.symbol.trim()).map((r) => ({ symbol: normalizeSymbol(r.symbol), weight: parseNum(r.weight) }));
}

export function rowsProblem(rows: WeightRow[]): string | null {
  const items = rowsToItems(rows);
  if (!items.length) return "종목을 하나 이상 넣으세요.";
  for (const i of items) {
    if (!getInstrument(i.symbol)) return `${i.symbol}: 지원하지 않는 종목입니다.`;
    if (!(i.weight > 0)) return `${i.symbol}: 비중을 0보다 크게 입력하세요.`;
  }
  if (new Set(items.map((i) => i.symbol)).size !== items.length) return "같은 종목이 두 번 들어 있습니다.";
  return null;
}

export function HoldingsEditor({ rows, onChange, label }: { rows: WeightRow[]; onChange: (r: WeightRow[]) => void; label: string }) {
  const sum = useMemo(() => rowsToItems(rows).reduce((a, i) => a + (Number.isFinite(i.weight) ? i.weight : 0), 0), [rows]);
  const ok = Math.abs(sum - 100) < 0.01;
  const problem = rowsProblem(rows);
  const set = (i: number, patch: Partial<WeightRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-start gap-2">
          <SymbolField value={r.symbol} onChange={(v) => set(i, { symbol: v })} label={`${label} 종목 ${i + 1}`} />
          <div className="relative">
            <input value={r.weight} onChange={(e) => set(i, { weight: e.target.value })} inputMode="decimal" aria-label={`${label} 비중 ${i + 1}`} className="input w-full pr-6 text-right" />
            <span className="pointer-events-none absolute right-2 top-2 text-sm text-muted">%</span>
          </div>
          <button type="button" className="btn btn-sm mt-1" onClick={() => onChange(rows.filter((_, k) => k !== i))} aria-label={`${label} ${r.symbol || i + 1} 삭제`}>
            삭제
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, { symbol: "", weight: "" }])} disabled={rows.length >= 10}>
          + 종목 추가
        </button>
        <span className={`num text-sm font-semibold ${ok ? "text-good" : "text-critical"}`} aria-live="polite">
          비중 합계 {Math.round(sum * 100) / 100}% {ok ? "✓" : "(100%가 아님)"}
        </span>
      </div>
      {problem && rows.length > 0 && <p className="text-xs text-critical">{problem}</p>}
    </div>
  );
}

// ─────────────────────────────── 안내 ───────────────────────────────

export function Disclaimer({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{children}</p>;
}

export function KV({ label, value, sub, valueClass = "" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-0.5 text-[15px] font-semibold ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

/** 이 화면의 데이터가 어디에 저장되는지 */
export function LocalOnlyNote({ what }: { what: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted">
      {what}은(는) 이 브라우저에만 저장되며 서버로 보내지 않습니다. 브라우저 데이터(사이트 데이터)를 지우면 함께 사라지니 <Link className="link" href="/settings#data">설정 → 데이터 관리</Link>에서 백업해 두세요.
    </p>
  );
}

export function categoryOf(symbol: string): string {
  const i = getInstrument(symbol);
  return i ? CATEGORY_LABELS[i.category] : "기타";
}
