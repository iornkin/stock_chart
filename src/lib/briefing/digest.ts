/** 브리핑 요약 (대시보드·관심 종목용, 서버·브라우저 공용) */
import type { ChangeItem } from "./signals";
import type { Stance } from "./judgment";
import type { SymbolBriefing } from "./types";

export interface BriefingDigest {
  scope: string;
  name: string;
  tradeDate: string;
  session: string;
  headline: string;
  price: number | null;
  changePct: number | null;
  stance: Stance | null;
  stanceLabel: string | null;
  score: number | null;
  risk: "high" | "normal" | "low" | null;
  /** 중요도 순 상위 변화 */
  changes: Pick<ChangeItem, "short" | "direction" | "importance" | "tag">[];
  maxImportance: number;
}

export function digestOf(b: SymbolBriefing): BriefingDigest {
  const items = b.changes?.items ?? [];
  return {
    scope: b.scope,
    name: b.name,
    tradeDate: b.tradeDate,
    session: b.session,
    headline: b.headline,
    price: b.glance?.price ?? null,
    changePct: b.glance?.changePct ?? null,
    stance: b.judgment?.stance ?? null,
    stanceLabel: b.judgment?.label ?? null,
    score: b.judgment?.score ?? null,
    risk: b.judgment?.risk.level ?? null,
    changes: items.slice(0, 4).map((c) => ({ short: c.short, direction: c.direction, importance: c.importance, tag: c.tag })),
    maxImportance: items.reduce((m, c) => Math.max(m, c.importance), 0),
  };
}
