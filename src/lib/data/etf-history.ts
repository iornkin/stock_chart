/** ETF 구성 기록 저장·조회 (제공처 자료를 받은 뒤 지금 구성을 기록) */
import { INSTRUMENTS } from "@/config/instruments";
import { all, get, run } from "@/lib/db";
import { inferFrequency } from "@/lib/dividend-analytics";
import { shouldRecord, type CompositionData, type CompositionRecord, type EtfHistoryItem } from "@/lib/etf-history";
import { addDays, etDate } from "@/lib/time";
import { readDividends } from "./dividends";
import { etfProfile } from "./profile";

function current(symbol: string): { data: CompositionData; source: string | null } {
  const p = etfProfile(symbol);
  return {
    data: {
      holdings: p.holdings.slice(0, 25).map((h) => ({ symbol: h.symbol ? h.symbol.toUpperCase() : null, name: h.name, weight: Math.round(h.weight * 100) / 100 })),
      sectors: p.sectors.map((s) => ({ sector: s.sector, weight: Math.round(s.weight * 100) / 100 })),
      expenseRatio: p.expenseRatio.value !== null ? Math.round(p.expenseRatio.value * 10000) / 10000 : null,
      category: p.category.value,
    },
    source: [p.holdingsSource, p.sectorsSource].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || null,
  };
}

function lastRecord(symbol: string): CompositionRecord | null {
  const row = get<{ date: string; data: string; source: string | null; checked_at: number }>("SELECT date, data, source, checked_at FROM etf_composition WHERE symbol=? ORDER BY date DESC LIMIT 1", symbol);
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.data) as CompositionData), date: row.date, checkedAt: row.checked_at, source: row.source };
  } catch {
    return null;
  }
}

/** 지금 저장된 제공처 자료로 구성 기록 (변화가 없으면 확인 시각만 갱신). 기록했으면 true */
export function recordEtfComposition(symbol: string, now = Date.now()): boolean {
  const { data, source } = current(symbol);
  const today = etDate(now);
  const prev = lastRecord(symbol);
  if (shouldRecord(prev, data, today)) {
    run(
      "INSERT INTO etf_composition(symbol, date, data, source, checked_at) VALUES(?,?,?,?,?) ON CONFLICT(symbol, date) DO UPDATE SET data=excluded.data, source=excluded.source, checked_at=excluded.checked_at",
      symbol,
      today,
      JSON.stringify(data),
      source,
      now,
    );
    return true;
  }
  if (prev) run("UPDATE etf_composition SET checked_at=? WHERE symbol=? AND date=?", now, symbol, prev.date);
  return false;
}

export function readEtfHistory(symbol: string, sinceDays = 800): CompositionRecord[] {
  const since = addDays(etDate(), -sinceDays);
  return all<{ date: string; data: string; source: string | null; checked_at: number }>("SELECT date, data, source, checked_at FROM etf_composition WHERE symbol=? AND date>=? ORDER BY date", symbol, since).flatMap((r) => {
    try {
      return [{ ...(JSON.parse(r.data) as CompositionData), date: r.date, checkedAt: r.checked_at, source: r.source }];
    } catch {
      return [];
    }
  });
}

/** 지원 ETF 전체의 구성 기록 + 실제 지급 기록으로 본 분배 주기 (지금 / 1년 전) */
export function buildEtfHistoryMap(): Record<string, EtfHistoryItem> {
  const today = etDate();
  const yearAgo = addDays(today, -365);
  const out: Record<string, EtfHistoryItem> = {};
  for (const inst of INSTRUMENTS) {
    if (inst.kind !== "etf") continue;
    const divs = readDividends(inst.symbol);
    const now = divs.length ? inferFrequency(divs, today) : null;
    const before = divs.length ? inferFrequency(divs, yearAgo) : null;
    out[inst.symbol] = {
      records: readEtfHistory(inst.symbol),
      distribution: now && before ? { now: now.label, yearAgo: before.label, nowBasis: now.basis, yearAgoBasis: before.basis } : null,
    };
  }
  return out;
}
