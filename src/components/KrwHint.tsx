"use client";
/** 설정에서 원화 환산을 켰을 때 달러 가격 옆에 원화 금액을 보여 준다 (최근 원/달러 환율 기준) */
import { usePrefs } from "@/lib/client/prefs";
import { useFx } from "@/lib/client/user-data";
import { formatEt } from "@/lib/time";

export default function KrwHint({ usd }: { usd: number | null }) {
  const [prefs] = usePrefs();
  const fx = useFx();
  if (!prefs.showKrw || usd === null || !fx.rate) return null;
  return (
    <span className="ml-2 text-sm text-ink-2" title={`환율 ${fx.rate.toFixed(2)}원 (${fx.time ? formatEt(fx.time) : "-"}, ${fx.source})`}>
      ≈ ₩{Math.round(usd * fx.rate).toLocaleString("ko-KR")}
    </span>
  );
}
