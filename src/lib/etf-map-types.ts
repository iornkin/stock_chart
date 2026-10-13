/** ETF 관계 지도 타입·표시 문구 (서버·브라우저 공용) */
export type RelationKind = "index" | "leveraged" | "covered_call" | "option_active" | "dividend" | "sector" | "gold" | "broad";

export const RELATION_LABEL: Record<RelationKind, string> = {
  index: "지수 추종 (1배)",
  leveraged: "레버리지 (일일 배수)",
  covered_call: "커버드콜 지수",
  option_active: "옵션 인컴 (액티브)",
  dividend: "배당 지수",
  sector: "섹터 지수",
  gold: "실물 금",
  broad: "시장 전체·성장주 지수",
};

export interface MapNode {
  symbol: string;
  name: string;
  hub: string;
  relation: RelationKind;
  relationText: string;
  underlying: string;
  strategyNote: string;
  leverage: number | null;
  ret1y: number | null;
  vol1y: number | null;
  expenseRatio: number | null;
  ttmYield: number | null;
  holdings: { symbol: string | null; name: string; weight: number }[];
  holdingsSource: string | null;
}

export interface MapHub {
  key: string;
  title: string;
  description: string;
  members: string[];
}

export interface StockHolder {
  stock: string;
  name: string;
  holders: { etf: string; weight: number }[];
}

export interface EtfMapData {
  hubs: MapHub[];
  nodes: Record<string, MapNode>;
  /** 1년 일간 수익률 상관계수 (대칭, 소수 둘째 자리) */
  corr: Record<string, Record<string, number>>;
  /** 상위 편입 종목 기준 중복 비중 (%) */
  overlap: Record<string, Record<string, number>>;
  stocks: StockHolder[];
  asOf: string | null;
}

