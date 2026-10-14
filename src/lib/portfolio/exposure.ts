/**
 * 내 자산의 종목·섹터 노출 (순수 함수)
 *
 * - 간접 노출: ETF 평가금액 × 제공처가 준 '상위 편입 종목' 비중. 상위 종목(보통 10개) 밖은 알 수 없으므로
 *   '확인 못 한 부분'으로 따로 두고 추정하지 않는다. 따라서 종목별 노출은 '최소한 이만큼'의 값이다.
 * - 레버리지 ETF 는 스왑·선물로 노출을 만들어 상위 편입 목록에 나오지 않으므로 편입 종목으로 계산하지 않는다.
 * - 다른 ETF·머니마켓 펀드를 담은 경우 그 안까지 펼치지 않는다.
 * - 중복도: 두 ETF 의 상위 편입 종목 중 같은 종목의 비중 중 작은 쪽을 더한 값 (상위 종목 기준).
 * - 유형별 비중은 이 사이트의 종목 분류(설정 파일의 category)를 따른다.
 */
import type { Category } from "@/config/instruments";
import type { ExposureInfo } from "@/lib/exposure-types";

export interface ExposurePosition {
  symbol: string;
  value: number;
}

export const STYLE_OF: Record<Category, { key: string; label: string }> = {
  m7: { key: "growth", label: "성장형" },
  semis_tech: { key: "growth", label: "성장형" },
  index: { key: "index", label: "시장 지수형" },
  dividend_growth: { key: "dividend", label: "배당형" },
  income: { key: "income", label: "인컴형 (옵션 인컴 등)" },
  leveraged: { key: "leveraged", label: "레버리지" },
  gold: { key: "gold", label: "금" },
};

export interface EtfLook {
  symbol: string;
  value: number;
  pct: number;
  /** 편입 종목으로 간접 노출을 계산했는지 */
  used: boolean;
  /** 계산하지 않은 이유 */
  reason: string | null;
  /** 상위 편입 종목 비중 합 (%, 펼친 종목만) */
  coveredPct: number;
  holdings: ExposureInfo["holdings"];
  source: string | null;
  fetchedAt: number | null;
  stale: boolean;
}

export interface LookRow {
  symbol: string;
  name: string;
  direct: number;
  via: { etf: string; amount: number }[];
  total: number;
  pct: number;
}

export interface ExposureResult {
  invested: number;
  cash: number;
  etfs: EtfLook[];
  lookthrough: LookRow[];
  /** 투자금 중 종목까지 확인한 비율 (직접 보유 + ETF 상위 편입) */
  knownPct: number;
  overlaps: { a: string; b: string; overlapPct: number; common: string[] }[];
  sectors: { sector: string; value: number; pct: number }[];
  /** 섹터를 알 수 없는 비율 (%) */
  sectorUnknownPct: number;
  styles: { key: string; label: string; value: number; pct: number }[];
  leveraged: { value: number; pct: number; effective: number; items: { symbol: string; value: number; leverage: number }[] };
  m7: { value: number; pct: number; direct: number; indirect: number; bySymbol: { symbol: string; total: number }[] };
  missingInfo: string[];
  staleInfo: string[];
}

export function portfolioExposure(input: { positions: ExposurePosition[]; cash: number; info: Record<string, ExposureInfo | undefined>; now: number; staleDays?: number; m7Symbols: string[] }): ExposureResult {
  const staleMs = (input.staleDays ?? 7) * 86400_000;
  const pos = input.positions.filter((p) => p.value > 0);
  const invested = pos.reduce((a, p) => a + p.value, 0);
  const pctOf = (v: number) => (invested > 0 ? (v / invested) * 100 : 0);
  const look = new Map<string, LookRow>();
  const row = (symbol: string, name: string) => {
    let r = look.get(symbol);
    if (!r) look.set(symbol, (r = { symbol, name, direct: 0, via: [], total: 0, pct: 0 }));
    return r;
  };
  const sectors = new Map<string, number>();
  let sectorKnown = 0;
  const styles = new Map<string, { label: string; value: number }>();
  const etfs: EtfLook[] = [];
  const missingInfo: string[] = [];
  const staleInfo: string[] = [];
  const lev: ExposureResult["leveraged"]["items"] = [];
  let known = 0;

  for (const p of pos) {
    const info = input.info[p.symbol];
    if (!info) {
      missingInfo.push(p.symbol);
      continue;
    }
    const st = STYLE_OF[info.category];
    const s = styles.get(st.key) ?? { label: st.label, value: 0 };
    s.value += p.value;
    styles.set(st.key, s);
    const stale = info.fetchedAt === null || input.now - info.fetchedAt > staleMs;
    if (stale && (info.kind === "etf" ? info.holdings.length || info.sectors.length : info.stockSector)) staleInfo.push(p.symbol);

    if (info.kind === "stock") {
      const r = row(p.symbol, p.symbol);
      r.direct += p.value;
      known += p.value;
      if (info.stockSector) {
        sectors.set(info.stockSector, (sectors.get(info.stockSector) ?? 0) + p.value);
        sectorKnown += p.value;
      }
      continue;
    }

    if (info.leverage) lev.push({ symbol: p.symbol, value: p.value, leverage: info.leverage });
    let reason: string | null = null;
    if (info.leverage) reason = "레버리지 ETF 는 스왑·선물로 노출을 만들어 편입 목록으로 계산하지 않음";
    else if (!info.holdings.length) reason = info.category === "gold" ? "실물 금 보유 — 주식 편입 없음" : "제공처 편입 종목 미제공";
    let covered = 0;
    if (!reason) {
      for (const h of info.holdings) {
        if (!h.symbol || h.fund || !(h.weight > 0)) continue;
        const amt = (p.value * h.weight) / 100;
        const r = row(h.symbol, h.name);
        r.via.push({ etf: p.symbol, amount: amt });
        covered += h.weight;
      }
      if (!(covered > 0)) reason = "펼칠 수 있는 주식 편입 종목 없음 (다른 ETF·펀드를 담음)";
    }
    known += (p.value * Math.min(covered, 100)) / 100;
    etfs.push({ symbol: p.symbol, value: p.value, pct: pctOf(p.value), used: !reason, reason, coveredPct: covered, holdings: info.holdings, source: info.holdingsSource, fetchedAt: info.fetchedAt, stale });

    // 섹터: 제공처 섹터 비중 (합이 100% 미만이면 나머지는 미분류)
    const sum = info.sectors.reduce((a, x) => a + x.weight, 0);
    if (sum > 0) {
      for (const x of info.sectors) sectors.set(x.sector, (sectors.get(x.sector) ?? 0) + (p.value * x.weight) / 100);
      sectorKnown += (p.value * Math.min(sum, 100)) / 100;
    }
  }

  for (const r of look.values()) {
    r.total = r.direct + r.via.reduce((a, v) => a + v.amount, 0);
    r.pct = pctOf(r.total);
    r.via.sort((a, b) => b.amount - a.amount);
  }
  // 같은 회사의 다른 주식 종류(GOOGL/GOOG 등)는 따로 둔다 (제공처 표기 그대로)
  const lookthrough = [...look.values()].sort((a, b) => b.total - a.total);

  const used = etfs.filter((e) => e.used);
  const overlaps: ExposureResult["overlaps"] = [];
  for (let i = 0; i < used.length; i++) {
    const a = new Map(used[i].holdings.filter((h) => h.symbol && !h.fund).map((h) => [h.symbol as string, h.weight]));
    for (let j = i + 1; j < used.length; j++) {
      let o = 0;
      const common: string[] = [];
      for (const h of used[j].holdings) {
        if (!h.symbol || h.fund || !a.has(h.symbol)) continue;
        o += Math.min(a.get(h.symbol) as number, h.weight);
        common.push(h.symbol);
      }
      overlaps.push({ a: used[i].symbol, b: used[j].symbol, overlapPct: o, common });
    }
  }
  overlaps.sort((x, y) => y.overlapPct - x.overlapPct);

  const m7set = new Set(input.m7Symbols);
  const m7rows = lookthrough.filter((r) => m7set.has(r.symbol));
  const m7direct = m7rows.reduce((a, r) => a + r.direct, 0);
  const m7total = m7rows.reduce((a, r) => a + r.total, 0);
  const levValue = lev.reduce((a, x) => a + x.value, 0);

  return {
    invested,
    cash: input.cash,
    etfs: etfs.sort((a, b) => b.value - a.value),
    lookthrough,
    knownPct: pctOf(known),
    overlaps,
    sectors: [...sectors.entries()].map(([sector, value]) => ({ sector, value, pct: pctOf(value) })).sort((a, b) => b.value - a.value),
    sectorUnknownPct: invested > 0 ? Math.max(0, 100 - pctOf(sectorKnown)) : 0,
    styles: [...styles.entries()].map(([key, v]) => ({ key, label: v.label, value: v.value, pct: pctOf(v.value) })).sort((a, b) => b.value - a.value),
    leveraged: { value: levValue, pct: pctOf(levValue), effective: lev.reduce((a, x) => a + x.value * x.leverage, 0), items: lev },
    m7: { value: m7total, pct: pctOf(m7total), direct: m7direct, indirect: m7total - m7direct, bySymbol: m7rows.map((r) => ({ symbol: r.symbol, total: r.total })) },
    missingInfo,
    staleInfo,
  };
}
