"use client";
/** 머리글의 알림 아이콘 — 읽지 않은 알림 + 다시 볼 날이 지난 투자 기록 수 (이 브라우저에 저장된 기록) */
import Link from "next/link";
import { etToday, useAlerts, useJournal } from "@/lib/client/user-data";

export default function AlertBell() {
  const a = useAlerts();
  const j = useJournal();
  const today = etToday();
  const st = a.value.inbox;
  const unread = a.loaded ? a.value.log.filter((e) => !e.read).length : 0;
  const due = j.loaded && !st?.muted.includes("journal") ? j.value.filter((e) => e.reviewDate && e.reviewDate <= today && !e.reviews.some((r) => r.date >= (e.reviewDate as string)) && !st?.done[`journal:${e.id}:${e.reviewDate}`] && !((st?.snooze[`journal:${e.id}:${e.reviewDate}`] ?? 0) > Date.now())).length : 0;
  const n = unread + due;
  return (
    <Link href="/alerts" className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={n ? `알림 ${unread}개 읽지 않음${due ? ` · 다시 볼 투자 기록 ${due}건` : ""}` : "알림·확인함"}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0" />
      </svg>
      {n > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-critical px-1 text-center text-[10px] font-bold leading-[18px] text-white">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
