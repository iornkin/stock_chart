"use client";
/** 탭 (URL ?tab= 와 동기화). 모든 패널은 서버에서 렌더링되며 선택된 패널만 표시한다. */
import { useEffect, useState, type ReactNode } from "react";

export default function Tabs({ tabs, panels, initial }: { tabs: { key: string; label: string }[]; panels: Record<string, ReactNode>; initial?: string }) {
  const [active, setActive] = useState(initial && tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  useEffect(() => {
    const onPop = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && tabs.some((x) => x.key === t)) setActive(t);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [tabs]);
  const select = (k: string) => {
    setActive(k);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", k);
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div>
      <div role="tablist" aria-label="종목 정보" className="sticky top-14 z-20 -mx-1 flex gap-1 overflow-x-auto border-b border-line bg-bg/95 px-1 backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => select(t.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${active === t.key ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} hidden={active !== t.key} className="pt-4">
          {panels[t.key]}
        </div>
      ))}
    </div>
  );
}
