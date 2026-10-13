"use client";
/** 시장 상태 문구 — 첫 화면은 렌더링 시각(at) 기준, 이후에는 브라우저의 현재 시각 기준으로 다시 계산한다 */
import { useEffect, useState } from "react";
import { marketStatus } from "@/lib/market-calendar";

export default function MarketPhaseText({ at, variant = "label" }: { at: number; variant?: "label" | "line" }) {
  const [now, setNow] = useState(at);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const st = marketStatus(now);
  if (variant === "label") return <>{st.label}</>;
  return <>{`${st.etDate} (ET) · ${st.label}${st.earlyClose ? " · 13:00 ET 조기 폐장" : ""}`}</>;
}
