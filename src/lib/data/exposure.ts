/** 지원 종목별 편입 종목·섹터·총보수 (저장된 제공처 자료만, 새로 받지 않음) */
import { INSTRUMENTS } from "@/config/instruments";
import type { ExposureInfo } from "@/lib/exposure-types";
import { etfProfile, readSnapshot, sectorKo } from "./profile";

const FUND_RE = /\bETF\b|\bFund\b|Money Market|\bTrust\b.*\bETF\b/i;

export function buildExposureMap(): Record<string, ExposureInfo> {
  const etfSymbols = new Set(INSTRUMENTS.filter((i) => i.kind === "etf").map((i) => i.symbol));
  const out: Record<string, ExposureInfo> = {};
  for (const inst of INSTRUMENTS) {
    if (inst.kind === "etf") {
      const p = etfProfile(inst.symbol);
      out[inst.symbol] = {
        symbol: inst.symbol,
        kind: "etf",
        category: inst.category,
        leverage: inst.leverage ?? null,
        strategy: inst.strategy ?? null,
        holdings: p.holdings.map((h) => ({ symbol: h.symbol ? h.symbol.toUpperCase() : null, name: h.name, weight: h.weight, fund: FUND_RE.test(h.name) || (!!h.symbol && etfSymbols.has(h.symbol.toUpperCase())) })),
        holdingsSource: p.holdingsSource,
        sectors: p.sectors,
        sectorsSource: p.sectorsSource,
        stockSector: null,
        expenseRatio: p.expenseRatio.value,
        fetchedAt: p.sources.length ? Math.max(...p.sources.map((s) => s.fetchedAt)) : null,
      };
    } else {
      const ys = readSnapshot<{ assetProfile?: { sector?: unknown } }>("yahoo_summary", inst.symbol);
      const sector = typeof ys?.data.assetProfile?.sector === "string" ? sectorKo(ys.data.assetProfile.sector) : null;
      out[inst.symbol] = {
        symbol: inst.symbol,
        kind: "stock",
        category: inst.category,
        leverage: null,
        strategy: null,
        holdings: [],
        holdingsSource: null,
        sectors: [],
        sectorsSource: sector ? (ys?.source ?? null) : null,
        stockSector: sector,
        expenseRatio: null,
        fetchedAt: ys?.fetchedAt ?? null,
      };
    }
  }
  return out;
}
