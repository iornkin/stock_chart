import type { NewsItem } from "@/lib/types";
import { formatEt } from "@/lib/time";
import RelTime from "./RelTime";
import { Empty } from "./ui";

/** 뉴스 목록 — 제목, 요약, 게시 시각(ET), 출처, 원문 링크, 연관 이유 */
export default function NewsList({ items, empty = "뉴스가 없습니다.", showReason = false }: { items: NewsItem[]; empty?: string; showReason?: boolean }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((n) => (
        <li key={n.id} className="py-2.5">
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:text-accent">
            {n.aiTitleKo ?? n.title}
          </a>
          {n.aiTitleKo && <p className="text-xs text-muted">{n.title}</p>}
          {(n.aiSummaryKo || n.summary) && (
            <p className="mt-1 line-clamp-3 text-sm text-ink-2">
              {n.aiSummaryKo ?? n.summary}
              {n.aiSummaryKo && <span className="ml-1 text-[10px] text-muted">(AI 요약 · 제목·제공처 요약문 기반)</span>}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
            <span>{n.publisher ?? n.provider}</span>
            <span className="num" title={formatEt(n.publishedAt)}>게시 {formatEt(n.publishedAt)} <RelTime ms={n.publishedAt} paren /></span>
            <span>via {n.provider}</span>
            {showReason && n.reason && <span>· 관련 이유: {n.reason}</span>}
            {n.duplicates && n.duplicates.length > 0 && (
              <details className="w-full">
                <summary className="text-accent">같은 내용 기사 {n.duplicates.length}건</summary>
                <ul className="mt-1 pl-3">
                  {n.duplicates.map((d) => (
                    <li key={d.url}>
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                        {d.publisher ?? "출처 미상"} — {d.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
