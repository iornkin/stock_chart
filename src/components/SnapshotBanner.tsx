"use client";
/** 정적 사이트 안내 (헤더의 작은 표시): 페이지가 만들어진 시각 — 실시간 데이터가 아님 */
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
  const title = `정적 스냅샷: 페이지 생성 ${formatEt(builtAt)} ET. 실시간 시세가 아니며 GitHub Actions 예약 실행 때만 갱신됩니다.${old ? " 마지막 갱신 후 6시간 이상 지났습니다(주말·휴장일이거나 자동 실행이 실패했을 수 있습니다)." : ""}`;
  const body = (
    <>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${old ? "bg-warn" : "bg-muted"}`} />
      <span>
        스냅샷 · {now !== null ? relativeTime(builtAt, now) : formatEt(builtAt)} 기준{old ? " · 오래됨" : ""}
      </span>
    </>
  );
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${old ? "border-warn/40 bg-warn-soft text-warn" : "border-line text-ink-2"}`;
  return REPO_URL ? (
    <a href={`${REPO_URL}/actions`} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className={cls}>
      {body}
    </a>
  ) : (
    <span role="note" title={title} aria-label={title} className={cls}>
      {body}
    </span>
  );
}
