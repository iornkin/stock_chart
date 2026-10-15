/**
 * 데이터 수집·브리핑 생성 작업 정의
 * 각 작업은 결과(성공/부분 성공/실패)와 상세 오류를 반환하며 runner 가 job_runs 에 기록한다.
 */
import { MARKET_SYMBOLS } from "@/config/instruments";
import { allInstruments, allSymbols, briefingOrder, getInstrument } from "../instruments";
import { refreshQuotes } from "../data/quotes";
import { readBarMeta, refreshBars } from "../data/bars";
import { refreshDividendDetails } from "../data/dividends";
import { collectMarketNews, collectSymbolNews } from "../data/news";
import { refreshProfile, topHoldings } from "../data/profile";
import { recordEtfComposition } from "../data/etf-history";
import { collectPositioning, positioningEnabled } from "../data/positioning";
import { refreshEarnings, refreshEconomicCalendar, refreshMacro } from "../data/events";
import { buildSymbolBriefing } from "../briefing/symbol";
import { buildMarketBriefing } from "../briefing/market";
import { enrichMarketBriefing, enrichSymbolBriefing, llmEnabled } from "../briefing/llm";
import { saveBriefing } from "../briefing/store";
import { marketStatus, sessionTimes } from "../market-calendar";
import { env } from "../env";
import { all, run } from "../db";
import type { SessionType } from "../briefing/types";
import { etDate, etParts } from "../time";

export type JobName =
  | "refresh_quotes"
  | "collect_news"
  | "collect_reference"
  | "collect_eod"
  | "briefing_intraday"
  | "briefing_close"
  | "briefing_non_trading"
  | "collect_positioning"
  | "cleanup";

export interface JobContext {
  now: number;
  /** 분석 기준 거래일 (지정 시) */
  tradeDate?: string;
  symbols?: string[];
  force?: boolean;
  log: (msg: string) => void;
}

export interface JobResult {
  status: "success" | "partial" | "failed" | "skipped";
  message: string;
  details?: Record<string, unknown>;
}

export const JOB_LABELS: Record<JobName, string> = {
  refresh_quotes: "시세 갱신",
  collect_news: "뉴스 수집",
  collect_reference: "기업·ETF 정보, 실적·경제 일정, 거시 지표 수집",
  collect_eod: "장 마감 데이터 수집 (일봉·분봉·배당)",
  briefing_intraday: "장중 브리핑 생성",
  briefing_close: "장 마감 후 브리핑 생성",
  briefing_non_trading: "휴장일 브리핑 생성",
  collect_positioning: "포지션·심리 수집 (공매도·옵션·기관 13F·투자심리 설문)",
  cleanup: "오래된 데이터 정리",
};

/** 보조 시세 대상: ETF 상위 편입 종목 (브리핑의 편입 종목 기여도 계산용) */
function auxHoldingSymbols(): string[] {
  const set = new Set<string>();
  for (const i of allInstruments()) if (i.kind === "etf") for (const h of topHoldings(i.symbol, 3)) set.add(h.symbol);
  for (const s of allSymbols()) set.delete(s);
  return [...set].filter((s) => /^[A-Z.]{1,6}$/.test(s)).slice(0, 80);
}

function summarize(ok: number, failed: { symbol: string; error: string }[], what: string): JobResult {
  if (!failed.length) return { status: "success", message: `${what} ${ok}건 완료` };
  return {
    status: ok > 0 ? "partial" : "failed",
    message: `${what} ${ok}건 성공, ${failed.length}건 실패`,
    details: { failed: failed.slice(0, 50) },
  };
}

async function jobRefreshQuotes(ctx: JobContext): Promise<JobResult> {
  const symbols = ctx.symbols ?? [...allSymbols(), ...MARKET_SYMBOLS.map((m) => m.symbol), ...auxHoldingSymbols()];
  const r = await refreshQuotes(symbols);
  ctx.log(`시세 ${r.ok.length}/${symbols.length}`);
  // 정적 사이트는 화면에서 분봉을 받아올 수 없으므로 장중·장 마감 직후에는 5분봉도 함께 갱신한다
  const phase = marketStatus(ctx.now).phase;
  if (env.collectAllIntervals && !ctx.symbols && (phase === "regular" || phase === "post")) {
    let n = 0;
    for (const s of allSymbols()) {
      try {
        await refreshBars(s, "5m");
        n++;
      } catch (e) {
        ctx.log(`5분봉 ${s} 실패: ${(e as Error).message}`);
      }
    }
    ctx.log(`5분봉 ${n}/${allSymbols().length}`);
  }
  return summarize(r.ok.length, r.failed, "시세");
}

async function jobCollectNews(ctx: JobContext): Promise<JobResult> {
  const failed: { symbol: string; error: string }[] = [];
  let ok = 0;
  try {
    const m = await collectMarketNews();
    if (m.errors.length && !m.providers.length) failed.push({ symbol: "MARKET", error: m.errors.join(" / ") });
    else ok++;
  } catch (e) {
    failed.push({ symbol: "MARKET", error: (e as Error).message });
  }
  const core = new Set(allInstruments().filter((i) => i.core).map((i) => i.symbol));
  for (const s of ctx.symbols ?? allSymbols()) {
    try {
      const r = await collectSymbolNews(s, { usePolygon: core.has(s) });
      if (!r.providers.length && r.errors.length) failed.push({ symbol: s, error: r.errors.join(" / ") });
      else ok++;
    } catch (e) {
      failed.push({ symbol: s, error: (e as Error).message });
    }
  }
  ctx.log(`뉴스 수집 ${ok}개 범위`);
  return summarize(ok, failed, "뉴스 수집");
}

async function jobCollectReference(ctx: JobContext): Promise<JobResult> {
  const failed: { symbol: string; error: string }[] = [];
  let ok = 0;
  for (const s of ctx.symbols ?? allSymbols()) {
    try {
      const r = await refreshProfile(s, { maxAgeMs: ctx.force ? 0 : undefined });
      // ETF 구성 기록 (제공처는 지금 구성만 주므로 직접 쌓는다)
      if (getInstrument(s)?.kind === "etf") {
        try {
          recordEtfComposition(s);
        } catch (e) {
          ctx.log(`${s} 구성 기록 실패: ${(e as Error).message}`);
        }
      }
      if (r.errors.length && !r.done.length) failed.push({ symbol: s, error: r.errors.join(" / ") });
      else ok++;
    } catch (e) {
      failed.push({ symbol: s, error: (e as Error).message });
    }
  }
  for (const [name, fn] of [
    ["실적 일정", refreshEarnings],
    ["경제지표 일정", refreshEconomicCalendar],
    ["거시 지표", refreshMacro],
  ] as const) {
    try {
      const r = await fn();
      if ("errors" in r && r.errors.length && r.count === 0) failed.push({ symbol: name, error: r.errors.join(" / ") });
      else ok++;
    } catch (e) {
      failed.push({ symbol: name, error: (e as Error).message });
    }
  }
  return summarize(ok, failed, "참조 데이터");
}

async function jobCollectEod(ctx: JobContext): Promise<JobResult> {
  const failed: { symbol: string; error: string }[] = [];
  let ok = 0;
  const universe = ctx.symbols ?? allSymbols();
  const marketSyms = ctx.symbols ? [] : MARKET_SYMBOLS.map((m) => m.symbol);
  for (const s of [...universe, ...marketSyms]) {
    try {
      await refreshBars(s, "1d");
      if (universe.includes(s)) await refreshBars(s, "5m");
      ok++;
    } catch (e) {
      failed.push({ symbol: s, error: (e as Error).message });
    }
    if (env.collectAllIntervals && universe.includes(s)) {
      for (const i of ["60m", "1wk", "1mo"] as const) {
        try {
          await refreshBars(s, i);
        } catch (e) {
          failed.push({ symbol: `${s}(${i})`, error: (e as Error).message });
        }
      }
    }
  }
  // 배당 상세 (지급일 포함): 인컴·배당 ETF 와 배당 기록이 있는 종목은 매일, 그 외는 주 1회(월요일)
  const isMonday = etParts(ctx.now).weekday === 1;
  for (const s of universe) {
    const inst = getInstrument(s);
    const daily = inst && (inst.category === "income" || inst.category === "dividend_growth");
    const hasDivs = all<{ n: number }>("SELECT count(*) AS n FROM dividends WHERE symbol=?", s)[0]?.n ?? 0;
    if (!daily && !isMonday && !ctx.force) continue;
    if (!daily && hasDivs === 0 && inst?.strategy === "leveraged") continue;
    try {
      const r = await refreshDividendDetails(s);
      if (r.errors.length && !r.sources.length) failed.push({ symbol: `${s}(배당)`, error: r.errors.join(" / ") });
    } catch (e) {
      failed.push({ symbol: `${s}(배당)`, error: (e as Error).message });
    }
  }
  return summarize(ok, failed, "장 마감 데이터");
}

async function generateBriefings(ctx: JobContext, session: SessionType, tradeDate: string): Promise<JobResult> {
  const failed: { symbol: string; error: string }[] = [];
  let ok = 0;
  let partial = 0;
  const useLlm = llmEnabled() && env.llmSessions.includes(session);
  const symbols = ctx.symbols ?? briefingOrder();
  for (const s of symbols) {
    try {
      let b = buildSymbolBriefing(s, session, tradeDate, Date.now());
      if (useLlm) {
        try {
          b = await enrichSymbolBriefing(b);
        } catch (e) {
          b.basis.limitations.push(`AI 서술 생성 실패: ${(e as Error).message}`);
        }
      }
      saveBriefing(b);
      if (b.status === "partial") partial++;
      ok++;
    } catch (e) {
      failed.push({ symbol: s, error: (e as Error).message });
    }
  }
  if (!ctx.symbols) {
    try {
      let m = buildMarketBriefing(session, tradeDate, Date.now());
      if (llmEnabled() && env.llmSessions.includes("market")) {
        try {
          m = await enrichMarketBriefing(m);
        } catch (e) {
          m.basis.limitations.push(`AI 서술 생성 실패: ${(e as Error).message}`);
        }
      }
      saveBriefing(m);
      ok++;
    } catch (e) {
      failed.push({ symbol: "MARKET", error: (e as Error).message });
    }
  }
  const res = summarize(ok, failed, `${tradeDate} ${session} 브리핑`);
  if (res.status === "success" && partial > 0) {
    return { status: "partial", message: `${res.message} (가격 데이터 없는 종목 ${partial}개)`, details: { partial } };
  }
  return res;
}

async function jobBriefingIntraday(ctx: JobContext): Promise<JobResult> {
  const st = marketStatus(ctx.now);
  if (st.phase !== "regular" && !ctx.force) return { status: "skipped", message: "정규장 시간이 아니어서 장중 브리핑을 생성하지 않았습니다" };
  const tradeDate = ctx.tradeDate ?? st.etDate;
  await jobRefreshQuotes({ ...ctx, symbols: undefined });
  for (const s of ctx.symbols ?? allSymbols()) {
    try {
      await refreshBars(s, "5m");
    } catch {
      // 분봉이 없어도 브리핑은 생성 (한계로 기록됨)
    }
  }
  return generateBriefings(ctx, "intraday", tradeDate);
}

async function jobBriefingClose(ctx: JobContext): Promise<JobResult> {
  const st = marketStatus(ctx.now);
  const tradeDate = ctx.tradeDate ?? st.lastCompletedSession;
  const closeTs = sessionTimes(tradeDate).close;
  if (ctx.now < closeTs + 10 * 60_000 && !ctx.force) {
    return { status: "skipped", message: `${tradeDate} 정규장 마감 후 10분이 지나지 않았습니다` };
  }
  // 일봉이 장 마감 이후에 갱신되었는지 확인 → 아니면 장 마감 데이터 수집 실행
  const stale = (ctx.symbols ?? allSymbols()).filter((s) => {
    const m = readBarMeta(s, "1d");
    return !m || m.fetched_at < closeTs + 5 * 60_000;
  });
  if (stale.length) {
    ctx.log(`장 마감 일봉 미확정 ${stale.length}개 → 수집`);
    await jobCollectEod({ ...ctx, symbols: ctx.symbols });
  }
  await jobCollectNews({ ...ctx });
  return generateBriefings(ctx, "close", tradeDate);
}

async function jobBriefingNonTrading(ctx: JobContext): Promise<JobResult> {
  const st = marketStatus(ctx.now);
  if (st.isTradingDay && !ctx.force) return { status: "skipped", message: "거래일에는 휴장일 브리핑을 생성하지 않습니다" };
  const tradeDate = ctx.tradeDate ?? st.lastCompletedSession;
  await jobCollectNews({ ...ctx });
  return generateBriefings(ctx, "non_trading", tradeDate);
}

/** 포지션·심리: 출처마다 따로 수집하고, 일부만 실패하면 부분 성공 */
async function jobCollectPositioning(ctx: JobContext): Promise<JobResult> {
  if (!positioningEnabled()) return { status: "skipped", message: "포지션·심리 수집이 꺼져 있습니다 (ENABLE_POSITIONING=0)" };
  const tradeDate = ctx.tradeDate ?? marketStatus(ctx.now).lastCompletedSession;
  const parts = await collectPositioning({ tradeDate, now: ctx.now, log: ctx.log, symbols: ctx.symbols, ignoreOptionWindow: Boolean(ctx.force) });
  const keys = Object.keys(parts);
  const failed = keys.filter((k) => !parts[k].ok);
  const summary = keys.map((k) => `${k} ${parts[k].ok ? "성공" : "실패"}`).join(", ");
  if (!failed.length) return { status: "success", message: `${tradeDate} 포지션·심리 수집 (${summary})`, details: parts };
  return { status: failed.length === keys.length ? "failed" : "partial", message: `${tradeDate} 포지션·심리 수집 일부 실패 (${summary})`, details: parts };
}

async function jobCleanup(ctx: JobContext): Promise<JobResult> {
  const now = ctx.now;
  run("DELETE FROM http_cache WHERE expires_at < ?", now);
  run("DELETE FROM provider_calls WHERE at < ?", now - 14 * 86400_000);
  run("DELETE FROM job_runs WHERE started_at < ?", now - 120 * 86400_000);
  run("DELETE FROM bars WHERE interval IN ('1m','5m','15m','30m') AND ts < ?", Math.floor((now - 90 * 86400_000) / 1000));
  run("DELETE FROM news_symbols WHERE news_id IN (SELECT id FROM news WHERE published_at < ?)", now - 180 * 86400_000);
  run("DELETE FROM news WHERE published_at < ?", now - 180 * 86400_000);
  run("DELETE FROM job_requests WHERE requested_at < ?", now - 30 * 86400_000);
  return { status: "success", message: `정리 완료 (${etDate(now)})` };
}

export const JOBS: Record<JobName, (ctx: JobContext) => Promise<JobResult>> = {
  refresh_quotes: jobRefreshQuotes,
  collect_news: jobCollectNews,
  collect_reference: jobCollectReference,
  collect_eod: jobCollectEod,
  briefing_intraday: jobBriefingIntraday,
  briefing_close: jobBriefingClose,
  briefing_non_trading: jobBriefingNonTrading,
  collect_positioning: jobCollectPositioning,
  cleanup: jobCleanup,
};

export function isJobName(s: string): s is JobName {
  return s in JOBS;
}
