"use client";
/** 미국 동부 시간 시계와 시장 개장 상태 (휴장일·조기 폐장 반영) */
import { useEffect, useState } from "react";
import { marketStatus } from "@/lib/market-calendar";
import { etParts, pad2 } from "@/lib/time";

export default function MarketClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="text-xs text-muted">ET 시각 확인 중…</span>;
  const st = marketStatus(now);
  const p = etParts(now);
  const color =
    st.phase === "regular" ? "bg-good" : st.phase === "pre" || st.phase === "post" ? "bg-warn" : "bg-muted";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-2" title={`다음 정규장: ${st.nextSessionDate}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="font-medium text-ink">{st.label}</span>
      <span className="num">
        {p.month}/{p.day} {pad2(p.hour)}:{pad2(p.minute)} ET
      </span>
    </span>
  );
}
