/** 브리핑 저장·조회 */
import { all, get, run } from "../db";
import type { MarketBriefing, SessionType, SymbolBriefing } from "./types";

export interface BriefingRecord<T = SymbolBriefing | MarketBriefing> {
  id: number;
  scope: string;
  tradeDate: string;
  session: SessionType;
  generatedAt: number;
  priceAsOf: number | null;
  newsAsOf: number | null;
  status: string;
  headline: string | null;
  llmModel: string | null;
  content: T;
}

interface Row {
  id: number;
  scope: string;
  trade_date: string;
  session: string;
  generated_at: number;
  price_as_of: number | null;
  news_as_of: number | null;
  status: string;
  headline: string | null;
  content: string;
  llm_model: string | null;
}

function toRecord<T>(r: Row): BriefingRecord<T> {
  return {
    id: r.id,
    scope: r.scope,
    tradeDate: r.trade_date,
    session: r.session as SessionType,
    generatedAt: r.generated_at,
    priceAsOf: r.price_as_of,
    newsAsOf: r.news_as_of,
    status: r.status,
    headline: r.headline,
    llmModel: r.llm_model,
    content: JSON.parse(r.content) as T,
  };
}

export function saveBriefing(b: SymbolBriefing | MarketBriefing) {
  run(
    `INSERT INTO briefings(scope, trade_date, session, generated_at, price_as_of, news_as_of, status, headline, content, llm_model)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(scope, trade_date, session) DO UPDATE SET generated_at=excluded.generated_at, price_as_of=excluded.price_as_of,
       news_as_of=excluded.news_as_of, status=excluded.status, headline=excluded.headline, content=excluded.content, llm_model=excluded.llm_model`,
    b.scope,
    b.tradeDate,
    b.session,
    b.generatedAt,
    b.basis.priceAsOf,
    b.basis.newsAsOf,
    b.status,
    b.headline,
    JSON.stringify(b),
    b.ai?.model ?? null,
  );
}

/** 가장 최근에 생성된 브리핑 */
export function latestBriefing<T = SymbolBriefing>(scope: string): BriefingRecord<T> | null {
  const r = get<Row>("SELECT * FROM briefings WHERE scope=? ORDER BY generated_at DESC LIMIT 1", scope);
  return r ? toRecord<T>(r) : null;
}

export function readBriefing<T = SymbolBriefing>(scope: string, tradeDate: string, session: SessionType): BriefingRecord<T> | null {
  const r = get<Row>("SELECT * FROM briefings WHERE scope=? AND trade_date=? AND session=?", scope, tradeDate, session);
  return r ? toRecord<T>(r) : null;
}

export function readBriefingById<T = SymbolBriefing>(id: number): BriefingRecord<T> | null {
  const r = get<Row>("SELECT * FROM briefings WHERE id=?", id);
  return r ? toRecord<T>(r) : null;
}

export interface BriefingListItem {
  id: number;
  scope: string;
  tradeDate: string;
  session: SessionType;
  generatedAt: number;
  status: string;
  headline: string | null;
  llmModel: string | null;
}

export function briefingHistory(scope: string, limit = 30): BriefingListItem[] {
  return all<Omit<Row, "content" | "price_as_of" | "news_as_of">>(
    "SELECT id, scope, trade_date, session, generated_at, status, headline, llm_model FROM briefings WHERE scope=? ORDER BY generated_at DESC LIMIT ?",
    scope,
    limit,
  ).map((r) => ({
    id: r.id,
    scope: r.scope,
    tradeDate: r.trade_date,
    session: r.session as SessionType,
    generatedAt: r.generated_at,
    status: r.status,
    headline: r.headline,
    llmModel: r.llm_model,
  }));
}

/** 범위(종목) 별 최신 브리핑 요약 */
export function latestBriefingList(): BriefingListItem[] {
  return all<Omit<Row, "content" | "price_as_of" | "news_as_of">>(
    `SELECT b.id, b.scope, b.trade_date, b.session, b.generated_at, b.status, b.headline, b.llm_model FROM briefings b
     JOIN (SELECT scope, max(generated_at) AS g FROM briefings GROUP BY scope) m ON m.scope = b.scope AND m.g = b.generated_at`,
  ).map((r) => ({
    id: r.id,
    scope: r.scope,
    tradeDate: r.trade_date,
    session: r.session as SessionType,
    generatedAt: r.generated_at,
    status: r.status,
    headline: r.headline,
    llmModel: r.llm_model,
  }));
}

export function availableBriefingDates(limit = 20): string[] {
  return all<{ trade_date: string }>("SELECT DISTINCT trade_date FROM briefings ORDER BY trade_date DESC LIMIT ?", limit).map((r) => r.trade_date);
}

export function briefingsForDate(tradeDate: string): BriefingListItem[] {
  return all<Omit<Row, "content" | "price_as_of" | "news_as_of">>(
    "SELECT id, scope, trade_date, session, generated_at, status, headline, llm_model FROM briefings WHERE trade_date=? ORDER BY generated_at DESC",
    tradeDate,
  ).map((r) => ({
    id: r.id,
    scope: r.scope,
    tradeDate: r.trade_date,
    session: r.session as SessionType,
    generatedAt: r.generated_at,
    status: r.status,
    headline: r.headline,
    llmModel: r.llm_model,
  }));
}
