/** 종목 설정 조회 헬퍼 (서버·클라이언트 공용) */
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CORE_ORDER,
  INSTRUMENTS,
  MARKET_SYMBOLS,
  type Category,
  type InstrumentConfig,
} from "@/config/instruments";

const bySymbol = new Map<string, InstrumentConfig>();
const alias = new Map<string, string>();
for (const i of INSTRUMENTS) {
  bySymbol.set(i.symbol, i);
  for (const f of i.formerSymbols ?? []) alias.set(f, i.symbol);
}

/** 입력한 티커를 대문자·이전 티커 → 현재 티커로 맞춘다 (주소 인코딩은 풀지 않음 — 주소 값은 decodeParam 을 한 번만 거친다) */
export function normalizeSymbol(s: string): string {
  const up = String(s ?? "").trim().toUpperCase();
  return alias.get(up) ?? up;
}

/** 주소 경로·쿼리에서 온 값을 한 번만 디코딩 (잘못된 % 인코딩이면 원래 문자열) */
export function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function getInstrument(symbol: string): InstrumentConfig | undefined {
  return bySymbol.get(normalizeSymbol(symbol));
}

export function isSupported(symbol: string): boolean {
  return bySymbol.has(normalizeSymbol(symbol));
}

export function allInstruments(): InstrumentConfig[] {
  return INSTRUMENTS;
}

export function allSymbols(): string[] {
  return INSTRUMENTS.map((i) => i.symbol);
}

export function coreSymbols(): string[] {
  const set = new Set(INSTRUMENTS.filter((i) => i.core).map((i) => i.symbol));
  const ordered = CORE_ORDER.filter((s) => set.has(s));
  for (const s of set) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
}

export function byCategory(): { category: Category; label: string; items: InstrumentConfig[] }[] {
  return CATEGORY_ORDER.map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    items: INSTRUMENTS.filter((i) => i.category === c),
  })).filter((g) => g.items.length > 0);
}

export function marketSymbols() {
  return MARKET_SYMBOLS;
}

export function marketSymbolName(symbol: string): string {
  return MARKET_SYMBOLS.find((m) => m.symbol === symbol)?.nameKo ?? getInstrument(symbol)?.nameKo ?? symbol;
}

/** 브리핑 정렬: 핵심 종목 → 나머지 (설정 순서) */
export function briefingOrder(): string[] {
  const core = coreSymbols();
  return [...core, ...INSTRUMENTS.map((i) => i.symbol).filter((s) => !core.includes(s))];
}

export function distributionWord(i: InstrumentConfig | undefined): "배당금" | "분배금" {
  return i?.kind === "etf" ? "분배금" : "배당금";
}

export { CATEGORY_LABELS };
export type { InstrumentConfig, Category };
