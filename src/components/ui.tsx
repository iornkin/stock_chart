/** 공용 UI 조각 (서버·클라이언트 공용, 상태 없음) */
import type { ReactNode } from "react";
import { changeClass, fmtPct, fmtSigned } from "@/lib/format";
import { KIND_DESC, KIND_LABEL, type StatementKind } from "@/lib/briefing/types";

export function Section({ title, right, children, id, description }: { title: ReactNode; right?: ReactNode; children: ReactNode; id?: string; description?: ReactNode }) {
  return (
    <section id={id} className="card p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Change({ value, pct, className = "" }: { value?: number | null; pct?: number | null; className?: string }) {
  const ref = pct ?? value;
  return (
    <span className={`num ${changeClass(ref)} ${className}`}>
      {value !== undefined && value !== null ? `${fmtSigned(value)} ` : ""}
      {pct !== undefined && pct !== null ? `(${fmtPct(pct)})` : ""}
    </span>
  );
}

export function PctBadge({ pct }: { pct: number | null | undefined }) {
  const up = (pct ?? 0) > 0;
  const down = (pct ?? 0) < 0;
  return (
    <span
      className={`num inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${
        up ? "bg-up-soft text-up" : down ? "bg-down-soft text-down" : "bg-surface-2 text-muted"
      }`}
    >
      {fmtPct(pct ?? null)}
    </span>
  );
}

const KIND_STYLE: Record<StatementKind, string> = {
  fact: "bg-surface-3 text-ink",
  calc: "bg-accent-soft text-accent",
  interpretation: "bg-warn-soft text-warn",
  market_view: "bg-surface-2 text-ink-2 border border-line",
  ai: "bg-[color-mix(in_srgb,var(--s7)_15%,transparent)] text-[var(--s7)]",
  notice: "bg-surface-2 text-muted",
};

export function KindBadge({ kind }: { kind: StatementKind }) {
  return (
    <span title={KIND_DESC[kind]} className={`mt-[3px] inline-flex h-[18px] min-w-[30px] shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold ${KIND_STYLE[kind]}`}>
      {KIND_LABEL[kind]}
    </span>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "critical"; title?: ReactNode; children: ReactNode }) {
  const cls =
    tone === "critical"
      ? "border-critical/40 bg-critical-soft"
      : tone === "warn"
        ? "border-warn/40 bg-warn-soft"
        : "border-line bg-surface-2";
  const icon = tone === "critical" ? "⚠" : tone === "warn" ? "!" : "i";
  return (
    <div role={tone === "info" ? "note" : "alert"} className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${cls}`}>
      <span aria-hidden className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone === "critical" ? "bg-critical text-white" : tone === "warn" ? "bg-warn text-white" : "bg-muted text-white"}`}>
        {icon}
      </span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, sub, note }: { label: ReactNode; value: ReactNode; sub?: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5" title={note}>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function SourceLine({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-muted">{children}</p>;
}
