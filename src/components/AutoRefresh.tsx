"use client";
/**
 * 설정한 주기로 화면 데이터를 다시 읽는다.
 * - 서버 모드: 정규장·프리/애프터마켓 시간에만 서버 데이터를 다시 렌더링
 * - 정적 모드: 새 스냅샷이 배포되었는지(data/build.json) 확인하고, 바뀌었으면 페이지를 다시 불러온다
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/client/prefs";
import { marketStatus } from "@/lib/market-calendar";
import { IS_STATIC, staticDataUrl } from "@/lib/static-mode";

export default function AutoRefresh() {
  const router = useRouter();
  const [prefs] = usePrefs();
  useEffect(() => {
    if (!prefs.autoRefreshSec) return;
    if (IS_STATIC) {
      let seen: number | null = null;
      const check = () =>
        fetch(staticDataUrl("build.json"), { cache: "no-cache" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { builtAt?: number } | null) => {
            if (!j?.builtAt) return;
            if (seen !== null && j.builtAt !== seen) window.location.reload();
            seen = j.builtAt;
          })
          .catch(() => undefined);
      check();
      // 정적 사이트는 몇 시간에 한 번 갱신되므로 최소 5분 간격으로만 확인
      const t = setInterval(() => document.visibilityState === "visible" && check(), Math.max(prefs.autoRefreshSec, 300) * 1000);
      return () => clearInterval(t);
    }
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (marketStatus().phase === "closed") return;
      router.refresh();
    }, prefs.autoRefreshSec * 1000);
    return () => clearInterval(t);
  }, [prefs.autoRefreshSec, router]);
  return null;
}
