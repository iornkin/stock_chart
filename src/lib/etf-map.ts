/**
 * ETF 관계 지도 데이터
 * - 연결은 설정 파일의 실제 기초지수(underlying)·운용 전략(strategy)·레버리지 배수로만 정한다
 * - 편입 종목 중복도는 제공처가 준 상위 편입 종목(보통 10개) 기준 — 전체 보유 내역이 아니다
 * - 성과·변동성·상관계수는 수집된 일봉(최근 1년)으로 계산
 */
import { INSTRUMENTS, type InstrumentConfig } from "@/config/instruments";
import { readBars } from "./data/bars";
import { readDividends } from "./data/dividends";
import { etfProfile } from "./data/profile";
import { readQuotes } from "./data/quotes";
import { summarizeDividends } from "./dividend-analytics";
import { totalReturnIndex } from "./performance";
import { addDays, etDate } from "./time";

import type { EtfMapData, MapHub, MapNode, RelationKind, StockHolder } from "./etf-map-types";

export { RELATION_LABEL } from "./etf-map-types";
export type { EtfMapData, MapHub, MapNode, RelationKind, StockHolder } from "./etf-map-types";

const HUBS: { key: string; title: string; description: string; test: (i: InstrumentConfig) => boolean }[] = [
  { key: "ndx", title: "나스닥100", description: "Nasdaq-100 지수와 그 지수를 기반으로 한 레버리지·옵션 전략 ETF", test: (i) => /nasdaq-100/i.test(i.underlying ?? "") },
  { key: "spx", title: "S&P 500", description: "S&P 500 지수와 그 지수를 기반으로 한 레버리지·옵션 전략 ETF", test: (i) => i.category !== "dividend_growth" && /s&p 500( index|\)|$| buywrite)/i.test(i.underlying ?? "") },
  { key: "rut", title: "러셀2000", description: "미국 소형주 지수 기반 옵션 전략", test: (i) => /russell 2000/i.test(i.underlying ?? "") },
  { key: "semi", title: "반도체·기술", description: "반도체·기술 섹터 지수 (지수마다 구성 방식이 다름)", test: (i) => i.category === "semis_tech" || /semiconductor/i.test(i.underlying ?? "") },
  { key: "broad", title: "미국 전체·성장주", description: "미국 시장 전체·대형 성장주 지수", test: (i) => i.kind === "etf" && i.strategy === "index" && /total market|growth/i.test(i.underlying ?? "") },
  { key: "div", title: "배당", description: "배당 성장·고배당 지수 (지수마다 선정 기준이 다름)", test: (i) => i.category === "dividend_growth" },
  { key: "gold", title: "금", description: "실물 금을 보유하는 신탁형 ETF", test: (i) => i.category === "gold" },
];

function relationOf(i: InstrumentConfig, hub: string): { kind: RelationKind; text: string } {
  if (i.leverage) return { kind: "leveraged", text: `${i.leverage}배 레버리지 (하루 수익률 기준)` };
  if (i.strategy === "covered_call_index") return { kind: "covered_call", text: "지수 보유 + 지수 콜옵션 매도 (규칙 기반)" };
  if (i.strategy === "option_income_active") return { kind: "option_active", text: "주식 보유 + 옵션 매도·ELN (액티브 운용)" };
  if (i.strategy === "dividend") return { kind: "dividend", text: "배당 기준으로 종목을 고르는 지수" };
  if (i.strategy === "physical_gold") return { kind: "gold", text: "실물 금괴 보유 신탁" };
  if (i.strategy === "sector") return { kind: "sector", text: "섹터 지수 추종" };
  if (hub === "broad") return { kind: "broad", text: "시장 전체·성장주 지수 추종" };
  return { kind: "index", text: "같은 지수를 1배로 추종" };
}

function dailyReturns1y(symbol: string, from: string): Map<string, number> {
  const bars = readBars(symbol, "1d").filter((b) => etDate(b.t * 1000) >= from);
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) out.set(etDate(bars[i].t * 1000), Math.log(bars[i].c / bars[i - 1].c));
  return out;
}

function correlation(a: Map<string, number>, b: Map<string, number>): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, x] of a) {
    const y = b.get(d);
    if (y !== undefined) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < 60) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function buildEtfMap(): EtfMapData {
  const etfs = INSTRUMENTS.filter((i) => i.kind === "etf");
  const stocks = INSTRUMENTS.filter((i) => i.kind === "stock");
  const quotes = readQuotes(INSTRUMENTS.map((i) => i.symbol));
  let asOf: string | null = null;
  const lastDates = INSTRUMENTS.map((i) => readBars(i.symbol, "1d").slice(-1)[0]).filter(Boolean).map((b) => etDate(b.t * 1000));
  if (lastDates.length) asOf = lastDates.sort().slice(-1)[0];
  const from = addDays(asOf ?? etDate(), -366);

  const hubs: MapHub[] = [];
  const nodes: Record<string, MapNode> = {};
  const assigned = new Set<string>();
  for (const h of HUBS) {
    const members = etfs.filter((i) => !assigned.has(i.symbol) && h.test(i));
    if (!members.length) continue;
    hubs.push({ key: h.key, title: h.title, description: h.description, members: members.map((m) => m.symbol) });
    for (const m of members) {
      assigned.add(m.symbol);
      const rel = relationOf(m, h.key);
      const prof = etfProfile(m.symbol);
      const bars = readBars(m.symbol, "1d").filter((b) => etDate(b.t * 1000) >= from);
      const pts = bars.map((b) => ({ date: etDate(b.t * 1000), close: b.c }));
      const divs = readDividends(m.symbol);
      const tri = pts.length > 200 ? totalReturnIndex(pts, divs.map((d) => ({ exDate: d.exDate, amount: d.amount }))) : [];
      const r = [...dailyReturns1y(m.symbol, from).values()];
      const mean = r.reduce((a, b) => a + b, 0) / (r.length || 1);
      const vol = r.length > 60 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100 : null;
      const price = quotes.get(m.symbol)?.price ?? pts[pts.length - 1]?.close ?? null;
      nodes[m.symbol] = {
        symbol: m.symbol,
        name: m.nameKo,
        hub: h.key,
        relation: rel.kind,
        relationText: rel.text,
        underlying: m.underlying ?? "-",
        strategyNote: m.strategyNote ?? "",
        leverage: m.leverage ?? null,
        ret1y: tri.length ? tri[tri.length - 1].value - 100 : null,
        vol1y: vol,
        expenseRatio: prof.expenseRatio.value,
        ttmYield: divs.length ? summarizeDividends(divs, asOf ?? etDate(), price).ttmYield : null,
        holdings: prof.holdings.slice(0, 10),
        holdingsSource: prof.holdingsSource,
      };
    }
  }

  // 상관계수 (ETF + 개별 주식)
  const syms = [...Object.keys(nodes), ...stocks.map((s) => s.symbol)];
  const rets = new Map(syms.map((s) => [s, dailyReturns1y(s, from)]));
  const corr: EtfMapData["corr"] = {};
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      const c = correlation(rets.get(syms[i]) as Map<string, number>, rets.get(syms[j]) as Map<string, number>);
      if (c === null) continue;
      const v = Math.round(c * 100) / 100;
      (corr[syms[i]] ??= {})[syms[j]] = v;
      (corr[syms[j]] ??= {})[syms[i]] = v;
    }
  }

  // 상위 편입 종목 중복
  const overlap: EtfMapData["overlap"] = {};
  const keys = Object.keys(nodes).filter((s) => nodes[s].holdings.some((h) => h.symbol));
  for (let i = 0; i < keys.length; i++) {
    const a = new Map(nodes[keys[i]].holdings.filter((h) => h.symbol).map((h) => [h.symbol as string, h.weight]));
    for (let j = i + 1; j < keys.length; j++) {
      let o = 0;
      for (const h of nodes[keys[j]].holdings) if (h.symbol && a.has(h.symbol)) o += Math.min(a.get(h.symbol) as number, h.weight);
      if (o <= 0) continue;
      const v = Math.round(o * 10) / 10;
      (overlap[keys[i]] ??= {})[keys[j]] = v;
      (overlap[keys[j]] ??= {})[keys[i]] = v;
    }
  }

  // 개별 주식을 많이 담은 ETF (상위 편입 종목 기준)
  const stockHolders: StockHolder[] = stocks.map((s) => ({
    stock: s.symbol,
    name: s.nameKo,
    holders: Object.values(nodes)
      .map((n) => ({ etf: n.symbol, weight: n.holdings.find((h) => h.symbol === s.symbol)?.weight ?? 0 }))
      .filter((h) => h.weight > 0)
      .sort((a, b) => b.weight - a.weight),
  }));

  return { hubs, nodes, corr, overlap, stocks: stockHolders, asOf };
}
