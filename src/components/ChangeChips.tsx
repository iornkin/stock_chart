/** 브리핑 요약의 종합 판단과 새 변화를 짧은 칩으로 표시 */
import type { BriefingDigest } from "@/lib/briefing/digest";

const tone = (d: "up" | "down" | "neutral") => (d === "up" ? "bg-up-soft text-up" : d === "down" ? "bg-down-soft text-down" : "bg-surface-3 text-ink-2");

export default function ChangeChips({ d, max = 3, showStance = true, minImportance = 1 }: { d: BriefingDigest; max?: number; showStance?: boolean; minImportance?: number }) {
  // 기사 수('새 관련 기사 N건')는 칩에서 빼고 가격·지표·배당 변화만 보여 준다
  const items = d.changes.filter((c) => c.importance >= minImportance && c.tag !== "news").slice(0, max);
  const stanceTone = d.score === null ? "neutral" : d.score > 0 ? "up" : d.score < 0 ? "down" : "neutral";
  return (
    <span className="flex flex-wrap items-center gap-1">
      {showStance && d.stanceLabel && <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${stanceTone === "up" ? "border-up/40 text-up" : stanceTone === "down" ? "border-down/40 text-down" : "border-line text-ink-2"}`}>{d.stanceLabel}</span>}
      {items.length ? (
        items.map((c, i) => (
          <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone(c.direction)}`}>
            {c.short}
          </span>
        ))
      ) : (
        <span className="text-[11px] text-muted">새 변화 없음</span>
      )}
    </span>
  );
}
