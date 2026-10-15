/**
 * ETF 구성 기록 비교 (순수 함수 — 서버·브라우저 공용)
 *
 * 제공처는 '지금' 구성만 주므로 과거 구성은 이 사이트가 갱신할 때마다 직접 저장한 기록만 쓴다.
 * 기록이 쌓이기 전의 변화는 알 수 없으며 만들어 내지 않는다.
 * - 저장: 처음이거나, 의미 있는 변화(편입·편출, 비중 0.5%p 이상, 섹터 1%p 이상, 총보수·분류 변경)가 있거나,
 *   마지막 기록 후 28일이 지났을 때만 새 기록을 남긴다 (그 외에는 '확인 시각'만 갱신).
 */
import type { FrequencyLabel } from "./dividend-analytics";

export interface CompositionData {
  holdings: { symbol: string | null; name: string; weight: number }[];
  sectors: { sector: string; weight: number }[];
  expenseRatio: number | null;
  /** 제공처 분류 (예: Large Growth) */
  category: string | null;
}

export interface CompositionRecord extends CompositionData {
  /** 기록한 날 (미국 동부 날짜) */
  date: string;
  /** 같은 구성을 마지막으로 확인한 시각 */
  checkedAt: number;
  source: string | null;
}

export interface EtfHistoryItem {
  records: CompositionRecord[];
  /** 실제 지급 기록으로 판정한 분배 주기: 지금 / 1년 전 기준 */
  distribution: { now: FrequencyLabel; yearAgo: FrequencyLabel; nowBasis: string; yearAgoBasis: string } | null;
}

export interface EtfHistoryResponse {
  asOf: number;
  items: Record<string, EtfHistoryItem>;
}

const keyOf = (h: { symbol: string | null; name: string }) => (h.symbol ? h.symbol.toUpperCase() : `name:${h.name.trim().toLowerCase()}`);

export function isMaterialChange(a: CompositionData, b: CompositionData): boolean {
  const ha = new Map(a.holdings.map((h) => [keyOf(h), h.weight]));
  const hb = new Map(b.holdings.map((h) => [keyOf(h), h.weight]));
  if (ha.size !== hb.size) return true;
  for (const [k, w] of hb) {
    if (!ha.has(k)) return true;
    if (Math.abs((ha.get(k) as number) - w) >= 0.5) return true;
  }
  const sa = new Map(a.sectors.map((s) => [s.sector, s.weight]));
  const sb = new Map(b.sectors.map((s) => [s.sector, s.weight]));
  for (const k of new Set([...sa.keys(), ...sb.keys()])) if (Math.abs((sa.get(k) ?? 0) - (sb.get(k) ?? 0)) >= 1) return true;
  if ((a.expenseRatio ?? null) !== (b.expenseRatio ?? null)) return true;
  if ((a.category ?? null) !== (b.category ?? null)) return true;
  return false;
}

/** 새 기록을 남길지: 처음 / 의미 있는 변화 / 마지막 기록 후 28일 이상 */
export function shouldRecord(prev: CompositionRecord | null, next: CompositionData, today: string): boolean {
  if (!next.holdings.length && !next.sectors.length && next.expenseRatio === null) return false;
  if (!prev) return true;
  if (isMaterialChange(prev, next)) return true;
  return Date.parse(today) - Date.parse(prev.date) >= 28 * 86400_000;
}

export interface HoldingChange {
  key: string;
  symbol: string | null;
  name: string;
  before: number | null;
  after: number | null;
  /** 새로 들어옴 / 빠짐 / 비중 변화 */
  status: "new" | "gone" | "changed" | "same";
  diff: number;
}

export interface CompositionDiff {
  from: string;
  to: string;
  holdings: HoldingChange[];
  sectors: { sector: string; before: number; after: number; diff: number }[];
  /** 상위 편입 종목 비중 합 (집중도) */
  topSumBefore: number;
  topSumAfter: number;
  expense: { before: number | null; after: number | null } | null;
  category: { before: string | null; after: string | null } | null;
}

export function compareCompositions(a: CompositionRecord, b: CompositionRecord): CompositionDiff {
  const map = new Map<string, HoldingChange>();
  for (const h of a.holdings) map.set(keyOf(h), { key: keyOf(h), symbol: h.symbol, name: h.name, before: h.weight, after: null, status: "gone", diff: -h.weight });
  for (const h of b.holdings) {
    const k = keyOf(h);
    const prev = map.get(k);
    if (prev) {
      const diff = h.weight - (prev.before as number);
      map.set(k, { ...prev, name: h.name, after: h.weight, diff, status: Math.abs(diff) >= 0.05 ? "changed" : "same" });
    } else map.set(k, { key: k, symbol: h.symbol, name: h.name, before: null, after: h.weight, status: "new", diff: h.weight });
  }
  const order = { new: 0, gone: 1, changed: 2, same: 3 };
  const holdings = [...map.values()].sort((x, y) => order[x.status] - order[y.status] || Math.abs(y.diff) - Math.abs(x.diff));
  const sa = new Map(a.sectors.map((s) => [s.sector, s.weight]));
  const sb = new Map(b.sectors.map((s) => [s.sector, s.weight]));
  const sectors = [...new Set([...sa.keys(), ...sb.keys()])]
    .map((s) => ({ sector: s, before: sa.get(s) ?? 0, after: sb.get(s) ?? 0, diff: (sb.get(s) ?? 0) - (sa.get(s) ?? 0) }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const sum = (r: CompositionRecord) => r.holdings.reduce((s, h) => s + h.weight, 0);
  return {
    from: a.date,
    to: b.date,
    holdings,
    sectors,
    topSumBefore: sum(a),
    topSumAfter: sum(b),
    expense: (a.expenseRatio ?? null) !== (b.expenseRatio ?? null) ? { before: a.expenseRatio, after: b.expenseRatio } : null,
    category: (a.category ?? null) !== (b.category ?? null) ? { before: a.category, after: b.category } : null,
  };
}

/** 기준일(baseDate) 이전 기록 중 가장 최근 것 — 없으면 가장 오래된 기록 */
export function baselineRecord(records: CompositionRecord[], baseDate: string): CompositionRecord | null {
  if (records.length < 2) return null;
  const sorted = [...records].sort((x, y) => x.date.localeCompare(y.date));
  const latest = sorted[sorted.length - 1];
  const before = sorted.filter((r) => r.date <= baseDate && r.date < latest.date);
  return before.length ? before[before.length - 1] : sorted[0];
}
