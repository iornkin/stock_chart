"use client";
/**
 * 카드 안·화면 안의 탭 (선택한 탭 내용만 보여 준다)
 * 서버에서 만든 내용도 그대로 넘길 수 있다. variant="pill" 은 카드 안의 작은 탭.
 */
import { useId, useState, type ReactNode } from "react";

export interface PanelTab {
  key: string;
  label: ReactNode;
  content: ReactNode;
  /** 탭 옆 작은 숫자 */
  count?: number;
}

export default function PanelTabs({ tabs, label, initial, variant = "underline", onChange }: { tabs: PanelTab[]; label: string; initial?: string; variant?: "underline" | "pill"; onChange?: (k: string) => void }) {
  const id = useId();
  const [active, setActive] = useState(initial && tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key);
  const cur = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!cur) return null;
  const select = (k: string) => {
    setActive(k);
    onChange?.(k);
  };
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={label} className={variant === "pill" ? "seg self-start" : "-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1"}>
        {tabs.map((t) => {
          const on = t.key === cur.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${id}-${t.key}`}
              aria-selected={on}
              aria-pressed={variant === "pill" ? on : undefined}
              aria-controls={`${id}-panel`}
              onClick={() => select(t.key)}
              className={variant === "pill" ? "" : `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${on ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {t.label}
              {t.count !== undefined && <span className="num ml-1 text-[11px] text-muted">{t.count}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${cur.key}`}>
        {cur.content}
      </div>
    </div>
  );
}
