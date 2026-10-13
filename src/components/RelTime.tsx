"use client";
/** 상대 시간(예: 5분 전)은 보는 시점 기준으로 브라우저에서 계산한다 — 정적 페이지에 빌드 시점 값이 굳지 않도록 */
import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/time";

export default function RelTime({ ms, paren = false }: { ms: number | null | undefined; paren?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!ms) return paren ? null : <>-</>;
  if (now === null) return null;
  const s = relativeTime(ms, now);
  return <>{paren ? `(${s})` : s}</>;
}
