/** 브리핑 데이터 구조 (DB 의 briefings.content 에 JSON 으로 저장) */
import type { ChangeItem, CompareRow } from "./signals";
import type { Judgment } from "./judgment";

export type SessionType = "intraday" | "close" | "non_trading";

/**
 * 문장의 성격
 * - fact: 수집 데이터로 확인된 사실
 * - calc: 수집 데이터로 계산한 값
 * - interpretation: 사이트의 규칙 기반 분석 해석
 * - market_view: 기사에 보도된 시장 참여자의 해석 (출처 기사 인용)
 * - ai: AI(Claude)가 근거 자료만으로 작성한 분석 문장
 * - notice: 데이터 한계·안내
 */
export type StatementKind = "fact" | "calc" | "interpretation" | "market_view" | "ai" | "notice";

export interface Statement {
  text: string;
  kind: StatementKind;
  evidence: string[];
}

export interface Evidence {
  id: string;
  type: "price" | "volume" | "indicator" | "news" | "event" | "dividend" | "profile" | "macro" | "benchmark";
  label: string;
  value?: string;
  source: string;
  asOf?: string;
  url?: string;
}

export interface BriefingNews {
  id: string;
  evidenceId: string;
  title: string;
  titleKo?: string | null;
  summary: string | null;
  summaryKo?: string | null;
  summaryBasis: "provider" | "ai" | "none";
  publishedAt: number;
  publisher: string | null;
  provider: string;
  url: string;
  /** 제공처가 준 기사 대표 이미지 (없으면 null) */
  image?: string | null;
  reason: string;
  matchType: string | null;
  duplicates: { title: string; url: string; publisher: string | null; publishedAt: number }[];
}

export interface KeyValue {
  label: string;
  value: string;
  kind: "fact" | "calc";
  note?: string;
}

export interface UpcomingItem {
  date: string;
  title: string;
  kind: string;
  source: string;
  detail?: string;
}

export interface SymbolBriefing {
  version: 1;
  scope: string;
  name: string;
  kind: "stock" | "etf";
  category: string;
  session: SessionType;
  sessionLabel: string;
  tradeDate: string;
  generatedAt: number;
  headline: string;
  status: "ok" | "partial";
  summary: Statement[];
  price: {
    available: boolean;
    statements: Statement[];
    table: KeyValue[];
    recent: { date: string; close: number; changePct: number | null; volume: number }[];
    intraday: Statement[];
    benchmark: Statement[];
    causality: Statement | null;
  };
  news: {
    windowLabel: string;
    items: BriefingNews[];
    holdingsItems: BriefingNews[];
    olderCount: number;
    statements: Statement[];
  };
  technical: {
    available: boolean;
    values: KeyValue[];
    interpretations: Statement[];
    levels: { kind: "support" | "resistance"; price: number; basis: string }[];
    note: string;
  };
  distributions: {
    available: boolean;
    word: "배당금" | "분배금";
    table: KeyValue[];
    statements: Statement[];
  } | null;
  upcoming: { items: UpcomingItem[]; note: string | null };
  risks: { general: string[]; current: Statement[] };
  ai: { model: string; paragraphs: Statement[]; generatedAt: number } | null;
  /** 직전 거래일 대비 새로 생긴 변화 (이전 버전 브리핑에는 없음) */
  changes?: { comparedWith: string | null; items: ChangeItem[]; table: CompareRow[]; note: string | null };
  /** 한눈에 보기용 핵심 수치 (이전 버전 브리핑에는 없음) */
  glance?: {
    price: number | null;
    changePct: number | null;
    volRatio: number | null;
    ret20: number | null;
    rsi: number | null;
    fromHigh: number | null;
    vol20: number | null;
  };
  /** 규칙 기반 종합 판단 (이전 버전 브리핑에는 없음) */
  judgment?: Judgment;
  basis: {
    analysisDate: string;
    priceAsOf: number | null;
    priceAsOfLabel: string;
    newsAsOf: number | null;
    providers: string[];
    limitations: string[];
  };
  evidence: Evidence[];
}

export interface MarketBriefing {
  version: 1;
  scope: "MARKET";
  session: SessionType;
  sessionLabel: string;
  tradeDate: string;
  generatedAt: number;
  headline: string;
  status: "ok" | "partial";
  sections: { key: string; title: string; statements: Statement[]; table?: KeyValue[] }[];
  news: BriefingNews[];
  nextDay: { date: string; items: UpcomingItem[] };
  ai: { model: string; paragraphs: Statement[]; generatedAt: number } | null;
  basis: SymbolBriefing["basis"];
  evidence: Evidence[];
}

export const KIND_LABEL: Record<StatementKind, string> = {
  fact: "사실",
  calc: "계산",
  interpretation: "해석",
  market_view: "보도",
  ai: "AI",
  notice: "참고",
};

/** 배지 툴팁·범례용 설명 */
export const KIND_DESC: Record<StatementKind, string> = {
  fact: "수집 데이터로 확인된 사실",
  calc: "수집 데이터로 계산한 값",
  interpretation: "사이트의 규칙 기반 해석 (확정 아님)",
  market_view: "기사에 보도된 시장 참여자의 해석",
  ai: "AI 가 근거 자료만으로 작성",
  notice: "데이터 한계·안내",
};
