import type { NewsItem } from "@/lib/types";
import { formatEt } from "@/lib/time";
import RelTime from "./RelTime";
import NewsThumb from "./NewsThumb";
import { Empty } from "./ui";

/** 뉴스 목록 — 대표 이미지(제공처 제공 시), 제목, 요약, 게시 시각(ET), 출처, 원문 링크, 연관 이유 */
export default function NewsList({ items, empty = "뉴스가 없습니다.", showReason = false, compact = false }: { items: NewsItem[]; empty?: string; showReason?: boolean; compact?: boolean }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className={`flex flex-col ${compact ? "gap-1" : "gap-3"}`}>
      {items.map((n) => (
        <li key={n.id} className={`flex gap-3 ${compact ? "py-2" : "rounded-xl border border-line p-3 transition-colors hover:border-line-strong"}`}>
          <NewsThumb src={n.image} label={n.publisher ?? n.provider} className={compact ? "h-14 w-20" : "h-[72px] w-24 sm:h-20 sm:w-32"} />
          <div className="min-w-0 flex-1">
            <a href={n.url} target="_blank" rel="noopener noreferrer" className={`line-clamp-2 font-semibold leading-snug hover:text-accent ${compact ? "text-sm" : "text-[15px]"}`}>
              {n.aiTitleKo ?? n.title}
            </a>
            <p className="mt-1 text-xs text-muted">
              {n.publisher ?? n.provider} · <span className="num">{formatEt(n.publishedAt)}</span> <RelTime ms={n.publishedAt} paren />
            </p>
            {!compact && (n.aiSummaryKo || n.summary) && (
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-2">
                {n.aiSummaryKo ?? n.summary}
                {n.aiSummaryKo && <span className="ml-1 text-[10px] text-muted">(AI 요약)</span>}
              </p>
            )}
            {!compact && (showReason || n.aiTitleKo || (n.duplicates && n.duplicates.length > 0)) && (
              <details className="mt-1 text-[11px] text-muted">
                <summary className="inline-block hover:text-accent">관련 이유·출처{n.duplicates?.length ? ` · 같은 내용 ${n.duplicates.length}건` : ""}</summary>
                <div className="mt-1 flex flex-col gap-0.5">
                  {showReason && n.reason && <span>관련 이유: {n.reason}</span>}
                  {n.aiTitleKo && <span>원제: {n.title}</span>}
                  <span>수집 {n.provider}</span>
                  {(n.duplicates ?? []).map((d) => (
                    <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                      {d.publisher ?? "출처 미상"} — {d.title}
                    </a>
                  ))}
                </div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
