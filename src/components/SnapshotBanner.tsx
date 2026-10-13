"use client";
/** 정적 사이트 안내: 페이지가 만들어진 시각과 경과 시간을 보여 주고, 실시간 데이터가 아님을 알린다 */
import { useEffect, useState } from "react";
import { formatEt, relativeTime } from "@/lib/time";
import { REPO_URL } from "@/lib/static-mode";

const OLD_MS = 6 * 3600_000;

export default function SnapshotBanner({ builtAt }: { builtAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const old = now !== null && now - builtAt > OLD_MS;
  return (
    <div role="note" className={`border-b border-line px-4 py-1.5 text-[11px] leading-relaxed ${old ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>
      <strong className="font-semibold">정적 스냅샷</strong> · 페이지 생성 {formatEt(builtAt)} ET{now !== null ? ` (${relativeTime(builtAt, now)})` : ""} · 실시간 시세가 아니며 GitHub Actions 예약 실행 때만 갱신됩니다. 항목별 수집 시각을 함께 확인하세요.
      {old && " 마지막 갱신 후 6시간 이상 지났습니다(주말·휴장일이거나 자동 실행이 실패했을 수 있습니다)."}
      {REPO_URL && (
        <>
          {" "}
          <a href={`${REPO_URL}/actions`} target="_blank" rel="noopener noreferrer" className="link">
            실행 기록
          </a>
        </>
      )}
    </div>
  );
}
