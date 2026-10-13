"use client";
/** 설정한 주기로 서버 데이터를 다시 읽는다 (정규장·프리/애프터마켓 시간에만) */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/client/prefs";
import { marketStatus } from "@/lib/market-calendar";

export default function AutoRefresh() {
  const router = useRouter();
  const [prefs] = usePrefs();
  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (marketStatus().phase === "closed") return;
      router.refresh();
    }, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, router]);
  return null;
}
