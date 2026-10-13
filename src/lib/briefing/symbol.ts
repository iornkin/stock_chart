/**
 * 종목별 일일 투자 브리핑 생성기 (규칙 기반, 수집·저장된 데이터만 사용)
 *
 * 원칙
 * - 저장된 실제 데이터에서 확인되는 사실과 계산값만 사용한다. 네트워크 호출을 하지 않는다.
 * - 주가 움직임의 원인을 추정하지 않는다. 같은 기간의 뉴스는 '시간적 연관성'으로만 표시한다.
 * - 매수·매도 판단을 내리지 않는다.
 * - 데이터가 없으면 해당 항목을 비우고 한계(limitations)에 기록한다.
 */
import type { InstrumentConfig } from "@/config/instruments";
import { getInstrument, distributionWord, marketSymbolName } from "../instruments";
import { readBars, readBarMeta } from "../data/bars";
import { readQuotes } from "../data/quotes";
import { readDividends } from "../data/dividends";
import { readNews } from "../data/news";
import { readEvents } from "../data/events";
import { etfProfile, stockFundamentals, topHoldings } from "../data/profile";
import { summarizeDividends, FREQUENCY_KO } from "../dividend-analytics";
import { bollinger, ema, macd, realizedVol, rsi, sma, supportResistance, last } from "../indicators";
import { previousTradingDay, sessionTimes, upcomingHolidays } from "../market-calendar";
import { addDays, etDate, etTime, formatEt } from "../time";
import { fmtCompact, fmtDividend, fmtPct, fmtPrice, fmtSigned, fmtUsd, fmtUsdCompact, isNum } from "../format";
import type { Bar, NewsItem } from "../types";
import { generalRisks } from "./risks";
import { compareRows, priceSignalChanges, signalStateAt, sortChanges, type ChangeItem } from "./signals";
import { buildJudgment } from "./judgment";
import type { BriefingNews, Evidence, KeyValue, SessionType, Statement, SymbolBriefing, UpcomingItem } from "./types";

export interface DayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  changePct: number | null;
  provisional: boolean;
  asOf: number | null;
  source: string;
}

class EvidenceBook {
  list: Evidence[] = [];
  private counters = new Map<string, number>();
  add(prefix: string, e: Omit<Evidence, "id">): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    const id = `${prefix}${n}`;
    this.list.push({ id, ...e });
    return id;
  }
}

const S = (text: string, kind: Statement["kind"], evidence: string[] = []): Statement => ({ text, kind, evidence });

function dailyFor(symbol: string): { date: string; bar: Bar }[] {
  return readBars(symbol, "1d").map((b) => ({ date: etDate(b.t * 1000), bar: b }));
}

/** 분석 기준일의 일봉 (장중이면 시세로 잠정 구성) */
export function dayData(symbol: string, tradeDate: string, session: SessionType): DayData | null {
  const daily = dailyFor(symbol);
  const idx = daily.findIndex((d) => d.date === tradeDate);
  const prior = (idx >= 0 ? daily.slice(0, idx) : daily.filter((d) => d.date < tradeDate)).slice(-1)[0];
  const meta = readBarMeta(symbol, "1d");
  if (session === "intraday") {
    const q = readQuotes([symbol]).get(symbol);
    if (q && q.price !== null && q.marketTime && etDate(q.marketTime) === tradeDate) {
      const prevClose = q.prevClose ?? prior?.bar.c ?? null;
      return {
        date: tradeDate,
        open: q.open ?? NaN,
        high: q.high ?? NaN,
        low: q.low ?? NaN,
        close: q.price,
        volume: q.volume ?? NaN,
        prevClose,
        changePct: prevClose ? (q.price / prevClose - 1) * 100 : null,
        provisional: true,
        asOf: q.marketTime,
        source: q.source,
      };
    }
  }
  if (idx < 0) return null;
  const b = daily[idx].bar;
  const prevClose = prior?.bar.c ?? null;
  // 장 마감 직후에도 일봉이 갱신되기 전이면 잠정 데이터로 표시
  const closeTs = sessionTimes(tradeDate).close;
  const provisional = !meta || meta.fetched_at < closeTs + 5 * 60_000;
  return {
    date: tradeDate,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    prevClose,
    changePct: prevClose ? (b.c / prevClose - 1) * 100 : null,
    provisional,
    asOf: meta?.fetched_at ?? null,
    source: meta?.source ?? "Yahoo Finance",
  };
}

function pctChangeOver(daily: { date: string; bar: Bar }[], endDate: string, sessions: number): number | null {
  const idx = daily.findIndex((d) => d.date === endDate);
  if (idx < sessions) return null;
  return (daily[idx].bar.c / daily[idx - sessions].bar.c - 1) * 100;
}

function toBriefingNews(n: NewsItem, evidenceId: string, reason?: string): BriefingNews {
  return {
    id: n.id,
    evidenceId,
    title: n.title,
    titleKo: n.aiTitleKo ?? null,
    summary: n.summary,
    summaryKo: n.aiSummaryKo ?? null,
    summaryBasis: n.aiSummaryKo ? "ai" : n.summary ? "provider" : "none",
    publishedAt: n.publishedAt,
    publisher: n.publisher,
    provider: n.provider,
    url: n.url,
    image: n.image ?? null,
    reason: reason ?? n.reason ?? "",
    matchType: n.matchType ?? null,
    duplicates: n.duplicates ?? [],
  };
}

export function sessionLabelOf(session: SessionType, tradeDate: string, generatedAt: number): string {
  if (session === "intraday") return `장중 브리핑 · ${tradeDate} ${etTime(generatedAt)} ET 기준 (확정 전 데이터)`;
  if (session === "close") return `장 마감 후 브리핑 · ${tradeDate} 정규장 확정 데이터 기준`;
  return `휴장일 브리핑 · 마지막 거래일 ${tradeDate} 기준 + 이후 새 뉴스`;
}

export function buildSymbolBriefing(symbol: string, session: SessionType, tradeDate: string, now = Date.now()): SymbolBriefing {
  const inst = getInstrument(symbol) as InstrumentConfig;
  if (!inst) throw new Error(`지원하지 않는 종목: ${symbol}`);
  const ev = new EvidenceBook();
  const limitations: string[] = [];
  const providers = new Set<string>();
  const quote = readQuotes([symbol]).get(symbol) ?? null;
  let recentRows: SymbolBriefing["price"]["recent"] = [];
  const name = quote?.name ?? inst.name;
  const daily = dailyFor(symbol);
  const dd = dayData(symbol, tradeDate, session);
  const word = distributionWord(inst);

  // ─────────────── 1. 주가 움직임 ───────────────
  const priceStatements: Statement[] = [];
  const table: KeyValue[] = [];
  const intraday: Statement[] = [];
  const benchmarkSt: Statement[] = [];
  let pId = "";
  let vId = "";
  let volRatio: number | null = null;
  if (dd) {
    providers.add(dd.source);
    pId = ev.add("P", {
      type: "price",
      label: `${symbol} ${dd.provisional ? "현재가(잠정)" : "종가"}`,
      value: `${fmtUsd(dd.close)} (${fmtPct(dd.changePct)})`,
      source: dd.source,
      asOf: dd.asOf ? formatEt(dd.asOf) : tradeDate,
    });
    const verb = dd.changePct === null ? "" : dd.changePct > 0 ? "상승" : dd.changePct < 0 ? "하락" : "보합";
    const when = session === "non_trading" ? `마지막 거래일(${tradeDate})` : session === "intraday" ? "현재(장중)" : `${tradeDate} 정규장`;
    priceStatements.push(
      S(
        `${when} ${symbol} 가격은 ${fmtUsd(dd.close)}로, 전일 종가 ${fmtUsd(dd.prevClose)} 대비 ${fmtPct(dd.changePct)} ${verb}했습니다.`,
        "fact",
        [pId],
      ),
    );
    if (dd.provisional && session !== "intraday") {
      priceStatements.push(S("일봉 데이터가 장 마감 후 아직 확정 갱신되지 않았을 수 있어 잠정값으로 표시합니다.", "notice"));
    }
    table.push({ label: session === "intraday" ? "현재가" : "종가", value: fmtUsd(dd.close), kind: "fact" });
    table.push({ label: "전일 대비", value: `${fmtSigned(dd.prevClose !== null ? dd.close - dd.prevClose : null)} (${fmtPct(dd.changePct)})`, kind: "calc" });
    if (isNum(dd.open)) table.push({ label: "시가 / 고가 / 저가", value: `${fmtPrice(dd.open)} / ${fmtPrice(dd.high)} / ${fmtPrice(dd.low)}`, kind: "fact" });
    if (isNum(dd.open) && dd.prevClose) {
      const gap = (dd.open / dd.prevClose - 1) * 100;
      table.push({ label: "시가 갭", value: fmtPct(gap), kind: "calc", note: "시가 ÷ 전일 종가 − 1" });
      if (Math.abs(gap) >= 1) {
        priceStatements.push(S(`시가가 전일 종가 대비 ${fmtPct(gap)} ${gap > 0 ? "높게" : "낮게"} 출발했습니다.`, "calc", [pId]));
      }
    }
    if (isNum(dd.high) && isNum(dd.low) && dd.high > dd.low) {
      const pos = ((dd.close - dd.low) / (dd.high - dd.low)) * 100;
      table.push({ label: "일중 범위 내 위치", value: `${pos.toFixed(0)}%`, kind: "calc", note: "(현재가−저가)÷(고가−저가)" });
    }
    // 거래량
    const idx = daily.findIndex((d) => d.date === tradeDate);
    const prior20 = (idx >= 0 ? daily.slice(Math.max(0, idx - 20), idx) : daily.filter((d) => d.date < tradeDate).slice(-20)).map((d) => d.bar.v);
    const avg20 = prior20.length >= 10 ? prior20.reduce((a, b) => a + b, 0) / prior20.length : null;
    // 거래량 0 은 제공처 값 누락으로 보고 계산에 쓰지 않는다 (상장 ETF·주식이 하루 거래가 0일 가능성은 사실상 없음)
    if (isNum(dd.volume) && dd.volume > 0) {
      volRatio = avg20 ? dd.volume / avg20 : null;
      vId = ev.add("V", {
        type: "volume",
        label: `${symbol} 거래량`,
        value: `${fmtCompact(dd.volume)}주 (20일 평균 ${fmtCompact(avg20)}주)`,
        source: dd.source,
        asOf: tradeDate,
      });
      table.push({ label: "거래량", value: `${fmtCompact(dd.volume)}주`, kind: "fact" });
      table.push({ label: "20일 평균 거래량", value: avg20 ? `${fmtCompact(avg20)}주` : "-", kind: "calc" });
      table.push({ label: "추정 거래대금", value: fmtUsdCompact(dd.close * dd.volume), kind: "calc", note: "가격 × 거래량 (실제 체결 대금과 다를 수 있음)" });
      if (volRatio !== null) {
        priceStatements.push(
          S(
            `거래량은 ${fmtCompact(dd.volume)}주로 직전 20거래일 평균의 ${volRatio.toFixed(2)}배입니다${session === "intraday" ? " (장중 누적치이므로 하루 전체와 직접 비교하기 어렵습니다)" : ""}.`,
            "calc",
            [vId],
          ),
        );
      }
    } else limitations.push(isNum(dd.volume) ? "제공처 거래량 값이 0으로 와서 거래량 분석을 생략했습니다" : "거래량 데이터 미제공");
    // 최근 흐름
    const upto = daily.filter((d) => d.date <= tradeDate).slice(-6);
    const recent = upto.slice(1).map((d, i) => ({
      date: d.date,
      close: d.bar.c,
      changePct: (d.bar.c / upto[i].bar.c - 1) * 100,
      volume: d.bar.v,
    }));
    let streak = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const c = recent[i].changePct ?? 0;
      if (streak === 0) streak = c > 0 ? 1 : c < 0 ? -1 : 0;
      else if ((streak > 0 && c > 0) || (streak < 0 && c < 0)) streak += Math.sign(streak);
      else break;
      if (streak === 0) break;
    }
    const r5 = pctChangeOver(daily, tradeDate, 5);
    if (r5 !== null) {
      priceStatements.push(
        S(
          `최근 5거래일 수익률은 ${fmtPct(r5)}${Math.abs(streak) >= 2 ? `, ${Math.abs(streak)}거래일 연속 ${streak > 0 ? "상승" : "하락"} 중` : ""}입니다.`,
          "calc",
          [pId],
        ),
      );
    }
    recentRows = recent;
    // 장중 움직임 (5분봉)
    const intraBars = readBars(symbol, "5m").filter((b) => etDate(b.t * 1000) === tradeDate);
    if (intraBars.length >= 6) {
      const hi = intraBars.reduce((m, b) => (b.h > m.h ? b : m));
      const lo = intraBars.reduce((m, b) => (b.l < m.l ? b : m));
      const first6 = intraBars.slice(0, 6);
      const firstMove = (first6[first6.length - 1].c / intraBars[0].o - 1) * 100;
      const iId = ev.add("I", {
        type: "price",
        label: `${symbol} 5분봉 (${tradeDate})`,
        value: `${intraBars.length}개 봉`,
        source: readBarMeta(symbol, "5m")?.source ?? "Yahoo Finance",
        asOf: formatEt(intraBars[intraBars.length - 1].t * 1000),
      });
      intraday.push(S(`장중 고가 ${fmtUsd(hi.h)}는 ${etTime(hi.t * 1000)} ET, 저가 ${fmtUsd(lo.l)}는 ${etTime(lo.t * 1000)} ET 구간에 기록되었습니다.`, "fact", [iId]));
      intraday.push(S(`개장 후 첫 30분 동안 ${fmtPct(firstMove)} 움직였습니다.`, "calc", [iId]));
      if (intraBars.length >= 18 && session !== "intraday") {
        const lastHourStart = intraBars[intraBars.length - 12];
        const lastHour = (intraBars[intraBars.length - 1].c / lastHourStart.o - 1) * 100;
        intraday.push(S(`마지막 1시간 동안 ${fmtPct(lastHour)} 움직였습니다.`, "calc", [iId]));
      }
    } else {
      limitations.push("해당 거래일 분봉 데이터가 없어 장중 흐름 분석을 생략했습니다");
    }
  } else {
    limitations.push(`${tradeDate} 가격 데이터를 확인하지 못했습니다 (제공처 응답 실패 또는 미수집)`);
  }

  // ─────────────── 2. 기준 지수·기초자산 비교 ───────────────
  const bmSymbols = inst.benchmarks ?? [];
  let bmPrimary: { symbol: string; change: number; id: string } | null = null;
  for (const b of bmSymbols) {
    const bd = dayData(b, tradeDate, session);
    if (!bd || bd.changePct === null) continue;
    const id = ev.add("B", {
      type: "benchmark",
      label: `${marketSymbolName(b)} (${b})`,
      value: `${fmtPrice(bd.close)} (${fmtPct(bd.changePct)})`,
      source: bd.source,
      asOf: bd.asOf ? formatEt(bd.asOf) : tradeDate,
    });
    if (!bmPrimary) bmPrimary = { symbol: b, change: bd.changePct, id };
    benchmarkSt.push(S(`${marketSymbolName(b)}(${b})는 ${fmtPct(bd.changePct)} 움직였습니다.`, "fact", [id]));
  }
  if (!bmPrimary && bmSymbols.length) limitations.push(`기준 지수(${bmSymbols.join(", ")}) 데이터가 없어 상대 비교를 생략했습니다`);
  if (dd && dd.changePct !== null && bmPrimary) {
    const diff = dd.changePct - bmPrimary.change;
    if (inst.leverage) {
      const expected = bmPrimary.change * inst.leverage;
      benchmarkSt.push(
        S(
          `기준 지수 등락률 × ${inst.leverage} = ${fmtPct(expected)}이며, ${symbol}의 실제 등락률(${fmtPct(dd.changePct)})과의 차이는 ${fmtSigned(dd.changePct - expected)}%p입니다.`,
          "calc",
          [pId, bmPrimary.id],
        ),
      );
      benchmarkSt.push(
        S(
          "일일 목표 대비 차이는 종가 산정 시점 차이, 운용 비용, 파생상품 가격, 기준 지수와 ETF 의 거래 시간 차이 등으로 생길 수 있습니다(원인 특정 아님).",
          "notice",
        ),
      );
      // 다일(20거래일) 복리 효과
      const etf20 = pctChangeOver(daily, tradeDate, 20);
      const bmDaily = dailyFor(bmPrimary.symbol);
      const bm20 = pctChangeOver(bmDaily, tradeDate, 20);
      if (etf20 !== null && bm20 !== null) {
        benchmarkSt.push(
          S(
            `최근 20거래일 ${symbol} 수익률은 ${fmtPct(etf20)}, 같은 기간 기준 지수 수익률 × ${inst.leverage}는 ${fmtPct(bm20 * inst.leverage)}로 ${fmtSigned(etf20 - bm20 * inst.leverage)}%p 차이가 납니다. 하루를 넘는 기간에는 일일 재조정과 복리 효과로 단순 배수와 달라집니다.`,
            "calc",
            [pId, bmPrimary.id],
          ),
        );
      }
    } else if (inst.strategy === "covered_call_index" || inst.strategy === "option_income_active") {
      benchmarkSt.push(S(`${symbol}와 기준 지수의 등락률 차이는 ${fmtSigned(diff)}%p입니다.`, "calc", [pId, bmPrimary.id]));
      if (bmPrimary.change > 0.5 && dd.changePct < bmPrimary.change) {
        benchmarkSt.push(
          S("기준 지수 상승일에 상승 폭이 더 작았습니다. 이는 콜옵션 매도로 상승 참여가 제한되는 상품 구조와 일치하는 움직임이지만, 특정 원인을 확정하지는 않습니다.", "interpretation", [pId, bmPrimary.id]),
        );
      } else if (bmPrimary.change < -0.5 && dd.changePct > bmPrimary.change) {
        benchmarkSt.push(
          S("기준 지수 하락일에 하락 폭이 더 작았습니다. 옵션 프리미엄·보유 종목 구성 차이 등이 영향을 줄 수 있으나 특정 원인을 확정하지는 않습니다.", "interpretation", [pId, bmPrimary.id]),
        );
      }
    } else if (inst.strategy === "physical_gold") {
      benchmarkSt.push(
        S(
          `${symbol}와 금 선물(근월물)의 등락률 차이는 ${fmtSigned(diff)}%p입니다. 금 선물은 현물과 만기·거래 시간이 달라 ETF 와 정확히 일치하지 않습니다.`,
          "calc",
          [pId, bmPrimary.id],
        ),
      );
    } else {
      benchmarkSt.push(S(`${symbol}의 등락률은 ${marketSymbolName(bmPrimary.symbol)} 대비 ${fmtSigned(diff)}%p ${diff >= 0 ? "높았습니다" : "낮았습니다"}.`, "calc", [pId, bmPrimary.id]));
    }
  }
  // 금 ETF: 금리·달러 동향 (사실만)
  if (inst.strategy === "physical_gold") {
    for (const m of ["^TNX", "DX-Y.NYB"]) {
      const md = dayData(m, tradeDate, session);
      if (!md || md.changePct === null) continue;
      const id = ev.add("M", { type: "macro", label: marketSymbolName(m), value: `${fmtPrice(md.close)} (${fmtPct(md.changePct)})`, source: md.source, asOf: tradeDate });
      benchmarkSt.push(
        S(
          m === "^TNX"
            ? `미국 10년물 국채금리는 ${fmtPrice(md.close, 3)}%로 전일 대비 ${fmtSigned(md.prevClose !== null ? (md.close - md.prevClose) * 100 : null, 1)}bp 변했습니다.`
            : `달러 인덱스(DXY)는 ${fmtPrice(md.close)}로 ${fmtPct(md.changePct)} 움직였습니다.`,
          "fact",
          [id],
        ),
      );
    }
    benchmarkSt.push(S("금리·달러와 금 가격의 관계는 일반적으로 거론되는 경향일 뿐이며, 오늘의 움직임에 대한 인과관계는 확인되지 않았습니다.", "notice"));
  }
  // 지수·섹터 ETF: 상위 편입 종목 기여도(근사)
  let holdingsList: { symbol: string; name: string; weight: number }[] = [];
  if (inst.kind === "etf" && inst.strategy !== "physical_gold") {
    holdingsList = topHoldings(symbol, 3);
    if (holdingsList.length && session !== "non_trading") {
      const qs = readQuotes(holdingsList.map((h) => h.symbol));
      const contrib = holdingsList
        .map((h) => {
          const q = qs.get(h.symbol);
          if (!q || q.changePct === null || !q.marketTime || etDate(q.marketTime) !== tradeDate) return null;
          return { ...h, change: q.changePct, contrib: (h.weight * q.changePct) / 100, source: q.source };
        })
        .filter(Boolean) as { symbol: string; name: string; weight: number; change: number; contrib: number; source: string }[];
      contrib.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
      if (contrib.length) {
        const top = contrib.slice(0, 3);
        const id = ev.add("H", {
          type: "profile",
          label: `${symbol} 상위 편입 종목 등락`,
          value: top.map((t) => `${t.symbol} ${fmtPct(t.change)}(비중 ${t.weight.toFixed(1)}%)`).join(", "),
          source: top[0].source,
          asOf: tradeDate,
        });
        benchmarkSt.push(
          S(
            `상위 편입 종목 중 영향이 컸던 종목(비중×등락률 근사): ${top.map((t) => `${t.symbol} ${fmtPct(t.change)} (비중 ${t.weight.toFixed(1)}%, 기여 약 ${fmtSigned(t.contrib)}%p)`).join(", ")}.`,
            "calc",
            [id],
          ),
        );
      }
    }
  }

  // ─────────────── 3. 뉴스 ───────────────
  // 뉴스 수집 구간: 직전 정규장 마감 이후 (휴장일 브리핑은 마지막 거래일 마감 이후)
  const windowStart =
    session === "non_trading" ? sessionTimes(tradeDate).close : sessionTimes(previousTradingDay(tradeDate)).close;
  const windowEnd = now;
  const raw = readNews(symbol, windowStart, windowEnd, 12, ["tagged", "title", "query"]);
  const newsItems = raw.slice(0, 8).map((n) => {
    const id = ev.add("N", { type: "news", label: n.title, value: n.publisher ?? undefined, source: n.provider, asOf: formatEt(n.publishedAt), url: n.url });
    providers.add(n.provider);
    return toBriefingNews(n, id);
  });
  const older = readNews(symbol, windowStart - 7 * 86400_000, windowStart - 1, 50, ["tagged", "title"]).length;
  const holdingsItems: BriefingNews[] = [];
  if (inst.kind === "etf" && holdingsList.length) {
    for (const h of holdingsList.filter((x) => x.weight >= 5 && getInstrument(x.symbol)).slice(0, 4)) {
      const hn = readNews(h.symbol, windowStart, windowEnd, 2, ["tagged", "title"]);
      for (const n of hn.slice(0, 1)) {
        const id = ev.add("N", { type: "news", label: n.title, value: n.publisher ?? undefined, source: n.provider, asOf: formatEt(n.publishedAt), url: n.url });
        holdingsItems.push(toBriefingNews(n, id, `상위 편입 종목 ${h.symbol}(비중 ${h.weight.toFixed(1)}%) 관련 기사`));
      }
    }
  }
  const newsStatements: Statement[] = [];
  const windowLabel = `${formatEt(windowStart)} ~ ${formatEt(windowEnd)} 게시 기사`;
  if (!newsItems.length) newsStatements.push(S("이 기간에 확인된 관련 뉴스가 없습니다.", "notice"));
  const directNews = newsItems.filter((n) => n.matchType === "tagged" || n.matchType === "title");

  // 원인 관련 안내
  let causality: Statement | null = null;
  if (dd && dd.changePct !== null) {
    const big = Math.abs(dd.changePct) >= 2 || (volRatio !== null && volRatio >= 1.8);
    if (directNews.length) {
      causality = S(
        `같은 기간 ${directNews.length}건의 관련 기사가 확인되었지만, 기사와 주가 움직임 사이의 인과관계는 확인되지 않았습니다(시간적 연관성만 있음).`,
        "notice",
        directNews.slice(0, 3).map((n) => n.evidenceId),
      );
    } else if (big) {
      causality = S("움직임이 컸지만 이를 설명하는 확인된 관련 뉴스가 없습니다. 원인을 추정하지 않습니다.", "notice", [pId]);
    } else {
      causality = S("주가 움직임의 원인으로 확인된 정보는 없습니다.", "notice");
    }
  }

  // ─────────────── 4. 기술적 분석 ───────────────
  const techValues: KeyValue[] = [];
  const interp: Statement[] = [];
  let levels: SymbolBriefing["technical"]["levels"] = [];
  const hist = daily.filter((d) => d.date <= tradeDate);
  const closes = hist.map((d) => d.bar.c);
  if (session === "intraday" && dd && hist[hist.length - 1]?.date !== tradeDate) closes.push(dd.close);
  let rsiV: number | null = null;
  let techId = "";
  if (closes.length >= 30) {
    const lastC = closes[closes.length - 1];
    const s20 = last(sma(closes, 20));
    const s50 = last(sma(closes, 50));
    const s200 = closes.length >= 200 ? last(sma(closes, 200)) : null;
    const e20 = last(ema(closes, 20));
    rsiV = last(rsi(closes, 14));
    const m = macd(closes);
    const mLine = last(m.macd);
    const mSig = last(m.signal);
    const mHist = m.hist.filter((x) => x !== null) as number[];
    const bb = bollinger(closes, 20, 2);
    const bu = last(bb.upper);
    const bl = last(bb.lower);
    const tId = ev.add("T", { type: "indicator", label: `${symbol} 일봉 기술적 지표`, value: `종가 ${fmtPrice(lastC)}`, source: "사이트 계산 (일봉 기준)", asOf: tradeDate });
    techId = tId;
    techValues.push({ label: "SMA 20 / 50 / 200", value: `${fmtPrice(s20)} / ${fmtPrice(s50)} / ${fmtPrice(s200)}`, kind: "calc" });
    techValues.push({ label: "EMA 20", value: fmtPrice(e20), kind: "calc" });
    techValues.push({ label: "RSI(14)", value: rsiV !== null ? rsiV.toFixed(1) : "-", kind: "calc" });
    techValues.push({ label: "MACD(12,26,9)", value: `${fmtSigned(mLine, 3)} / 시그널 ${fmtSigned(mSig, 3)} / 히스토그램 ${fmtSigned(last(m.hist), 3)}`, kind: "calc" });
    techValues.push({ label: "볼린저 밴드(20,2)", value: `${fmtPrice(bl)} ~ ${fmtPrice(bu)}`, kind: "calc" });
    const hi20 = Math.max(...hist.slice(-20).map((d) => d.bar.h));
    const lo20 = Math.min(...hist.slice(-20).map((d) => d.bar.l));
    const y = hist.slice(-252);
    const hi52 = Math.max(...y.map((d) => d.bar.h));
    const lo52 = Math.min(...y.map((d) => d.bar.l));
    techValues.push({ label: "20일 고가 / 저가", value: `${fmtPrice(hi20)} / ${fmtPrice(lo20)}`, kind: "calc" });
    techValues.push({ label: `${y.length >= 250 ? "52주" : `${y.length}거래일`} 고가 / 저가`, value: `${fmtPrice(hi52)} / ${fmtPrice(lo52)}`, kind: "calc" });
    const rel = (ma: number | null, label: string) => {
      if (ma === null) return;
      const d = (lastC / ma - 1) * 100;
      interp.push(S(`현재가는 ${label}(${fmtPrice(ma)})보다 ${fmtPct(Math.abs(d), 1, false)} ${d >= 0 ? "위" : "아래"}에 있습니다.`, "calc", [tId]));
    };
    rel(s20, "20일 이동평균");
    rel(s50, "50일 이동평균");
    rel(s200, "200일 이동평균");
    if (s50 !== null && s200 !== null) {
      const s50s = sma(closes, 50);
      const s200s = sma(closes, 200);
      for (let k = 1; k <= 10; k++) {
        const i = closes.length - k;
        const a0 = s50s[i - 1];
        const b0 = s200s[i - 1];
        const a1 = s50s[i];
        const b1 = s200s[i];
        if (a0 === null || b0 === null || a1 === null || b1 === null) break;
        if (a0 <= b0 && a1 > b1) {
          interp.push(S(`최근 ${k}거래일 이내 50일선이 200일선을 상향 돌파했습니다(흔히 '골든크로스'로 부름).`, "interpretation", [tId]));
          break;
        }
        if (a0 >= b0 && a1 < b1) {
          interp.push(S(`최근 ${k}거래일 이내 50일선이 200일선을 하향 돌파했습니다(흔히 '데드크로스'로 부름).`, "interpretation", [tId]));
          break;
        }
      }
    }
    if (rsiV !== null) {
      interp.push(
        S(
          rsiV >= 70
            ? `RSI ${rsiV.toFixed(1)}: 일반적으로 '과매수'로 분류되는 70 이상 구간입니다. 강한 추세에서는 이 구간이 길게 유지되기도 합니다.`
            : rsiV <= 30
              ? `RSI ${rsiV.toFixed(1)}: 일반적으로 '과매도'로 분류되는 30 이하 구간입니다. 하락 추세에서는 이 구간이 이어지기도 합니다.`
              : `RSI ${rsiV.toFixed(1)}: 30~70 사이 중립 구간입니다.`,
          "interpretation",
          [tId],
        ),
      );
    }
    if (mLine !== null && mSig !== null) {
      let cross = "";
      const ml = m.macd;
      const ms = m.signal;
      for (let k = 0; k < 3; k++) {
        const i = closes.length - 1 - k;
        if (ml[i - 1] === null || ms[i - 1] === null || ml[i] === null || ms[i] === null) break;
        if ((ml[i - 1] as number) <= (ms[i - 1] as number) && (ml[i] as number) > (ms[i] as number)) cross = "최근 3거래일 이내 MACD 선이 시그널 선을 상향 교차했습니다.";
        if ((ml[i - 1] as number) >= (ms[i - 1] as number) && (ml[i] as number) < (ms[i] as number)) cross = "최근 3거래일 이내 MACD 선이 시그널 선을 하향 교차했습니다.";
        if (cross) break;
      }
      const h1 = mHist[mHist.length - 1];
      const h0 = mHist[mHist.length - 2];
      interp.push(
        S(
          `MACD 선이 시그널 선 ${mLine >= mSig ? "위" : "아래"}에 있고, 히스토그램은 전일 대비 ${h1 !== undefined && h0 !== undefined ? (h1 > h0 ? "확대(상승 방향)" : "축소(하락 방향)") : "-"}되었습니다. ${cross}`.trim(),
          "interpretation",
          [tId],
        ),
      );
    }
    if (bu !== null && bl !== null) {
      if (lastC > bu) interp.push(S("종가가 볼린저 밴드 상단 위에 있습니다(최근 변동성 대비 큰 상승).", "interpretation", [tId]));
      else if (lastC < bl) interp.push(S("종가가 볼린저 밴드 하단 아래에 있습니다(최근 변동성 대비 큰 하락).", "interpretation", [tId]));
    }
    if (volRatio !== null && vId) {
      if (volRatio >= 1.5) interp.push(S(`거래량이 20일 평균의 ${volRatio.toFixed(1)}배로 늘었습니다. 거래량 증가는 가격 움직임에 참여한 매매가 많았다는 의미이며 방향을 알려 주지는 않습니다.`, "interpretation", [vId]));
      else if (volRatio <= 0.6) interp.push(S(`거래량이 20일 평균의 ${volRatio.toFixed(1)}배로 적었습니다.`, "interpretation", [vId]));
    }
    levels = supportResistance(hist.map((d) => d.bar)).map((l) => ({ kind: l.kind, price: l.price, basis: l.basis }));
  } else {
    limitations.push("일봉 데이터가 30개 미만이라 기술적 지표를 계산하지 않았습니다");
  }

  // ─────────────── 5. 배당·분배금 ───────────────
  let distributions: SymbolBriefing["distributions"] = null;
  const divs = readDividends(symbol);
  const price = dd?.close ?? quote?.price ?? null;
  const wantsDiv = divs.length > 0 || ["income", "dividend_growth"].includes(inst.category);
  if (wantsDiv) {
    const sum = summarizeDividends(divs, tradeDate, price);
    const dt: KeyValue[] = [];
    const ds: Statement[] = [];
    if (sum.latest) {
      const dId = ev.add("D", {
        type: "dividend",
        label: `${symbol} 최근 ${word}`,
        value: `${fmtDividend(sum.latest.amount)} (배당락일 ${sum.latest.exDate}, 지급일 ${sum.latest.payDate ?? "미제공"})`,
        source: sum.latest.sources.join(", "),
      });
      for (const s of sum.latest.sources) providers.add(s);
      dt.push({ label: `최근 ${word} (주당)`, value: fmtDividend(sum.latest.amount), kind: "fact" });
      dt.push({ label: "배당락일 / 지급일", value: `${sum.latest.exDate} / ${sum.latest.payDate ?? "미제공"}`, kind: "fact" });
      dt.push({ label: "직전 대비", value: fmtPct(sum.latestChangePct), kind: "calc" });
      dt.push({ label: "최근 12개월 지급 합계", value: `${fmtDividend(sum.ttmSum)} (${sum.ttmCount}회)`, kind: "calc" });
      dt.push({ label: "TTM 수익률", value: fmtPct(sum.ttmYield, 2, false), kind: "calc", note: "최근 12개월 실제 지급액 ÷ 현재 가격" });
      dt.push({
        label: "최근 지급액 연환산 수익률(참고)",
        value: sum.annualizedLatestYield !== null ? fmtPct(sum.annualizedLatestYield, 2, false) : "계산 안 함",
        kind: "calc",
        note: sum.frequency.perYear ? `최근 1회 지급액 × ${sum.frequency.perYear} ÷ 현재 가격. 앞으로 같은 금액이 지급된다는 보장이 없는 참고값` : "지급 주기가 불규칙해 연환산하지 않음",
      });
      dt.push({ label: "지급 주기(기록 기반)", value: FREQUENCY_KO[sum.frequency.label], kind: "calc", note: sum.frequency.basis });
      ds.push(
        S(
          `최근 ${word}은 주당 ${fmtDividend(sum.latest.amount)}(배당락일 ${sum.latest.exDate})로, 직전 ${fmtDividend(sum.previous?.amount)} 대비 ${fmtPct(sum.latestChangePct)} ${(sum.latestChangePct ?? 0) >= 0 ? "변동" : "감소"}했습니다.`,
          "calc",
          [dId],
        ),
      );
      if (sum.latest.exDate === tradeDate) {
        ds.push(S(`오늘(${tradeDate})은 배당락일입니다. 당일 주가 등락률에는 ${word} 지급에 따른 가격 조정분이 포함되어 있습니다.`, "fact", [dId]));
      }
      if (inst.strategy === "covered_call_index" || inst.strategy === "option_income_active") {
        ds.push(
          S("이 상품의 분배금은 보유 주식 배당 외에 옵션 프리미엄 등 여러 수익원에서 나오며 매달 달라질 수 있습니다. 일반 기업의 배당금과 같은 개념이 아닙니다.", "notice"),
        );
      }
    } else {
      ds.push(S(`저장된 ${word} 지급 기록이 없습니다 (데이터 미제공 또는 지급 이력 없음).`, "notice"));
    }
    for (const u of sum.upcoming.slice(0, 2)) {
      const id = ev.add("D", { type: "dividend", label: `${symbol} 예정 ${word}`, value: `${fmtDividend(u.amount)} (배당락일 ${u.exDate})`, source: u.sources.join(", ") });
      ds.push(S(`발표된 다음 ${word}: 주당 ${fmtDividend(u.amount)}, 배당락일 ${u.exDate}, 지급일 ${u.payDate ?? "미제공"}.`, "fact", [id]));
    }
    distributions = { available: Boolean(sum.latest), word, table: dt, statements: ds };
  } else if (inst.strategy === "physical_gold") {
    distributions = {
      available: false,
      word,
      table: [],
      statements: [S("실물 금을 보유하는 신탁 구조로, 저장된 분배금 지급 기록이 없습니다.", "notice")],
    };
  }

  // ─────────────── 6. 앞으로 확인할 사항 ───────────────
  const today = etDate(now);
  const upcoming: UpcomingItem[] = [];
  const evs = readEvents(today, addDays(today, 45), { kinds: ["earnings"], symbols: [symbol] });
  for (const e of evs) upcoming.push({ date: e.date, title: e.title, kind: "실적 발표", source: e.source, detail: e.timeHint ?? undefined });
  if (inst.kind === "etf") {
    const hEv = readEvents(today, addDays(today, 14), { kinds: ["earnings"] }).filter((e) =>
      ((e.data?.relatedEtfs as string[] | undefined) ?? []).some((x) => x.startsWith(`${symbol}(`)),
    );
    for (const e of hEv.slice(0, 6)) {
      const w = ((e.data?.relatedEtfs as string[]) ?? []).find((x) => x.startsWith(`${symbol}(`));
      upcoming.push({ date: e.date, title: `편입 종목 ${e.symbol} 실적 발표`, kind: "편입 종목 실적", source: e.source, detail: w ? `비중 ${w.slice(symbol.length + 1, -1)}` : undefined });
    }
  }
  for (const d of divs.filter((x) => x.exDate > today).slice(0, 2)) {
    upcoming.push({ date: d.exDate, title: `${word} 배당락일 (주당 ${fmtDividend(d.amount)})`, kind: "배당락", source: d.sources.join(", ") });
  }
  for (const d of divs.filter((x) => x.payDate && x.payDate > today && x.exDate <= today).slice(0, 1)) {
    upcoming.push({ date: d.payDate as string, title: `${word} 지급일 (주당 ${fmtDividend(d.amount)})`, kind: "지급", source: d.sources.join(", ") });
  }
  const econ = readEvents(today, addDays(today, 10), { kinds: ["economic"] }).filter((e) => e.data?.importance === "high");
  for (const e of econ.slice(0, 4)) upcoming.push({ date: e.date, title: e.title, kind: "경제지표", source: e.source });
  for (const h of upcomingHolidays(today, 21)) upcoming.push({ date: h.date, title: `미국 증시 휴장 (${h.name})`, kind: "휴장", source: "NYSE 휴장 규칙" });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // ─────────────── 7. 위험 요인 (현재 상황) ───────────────
  const current: Statement[] = [];
  if (hist.length >= 60) {
    const y = hist.slice(-252);
    const hi52 = Math.max(...y.map((d) => d.bar.c));
    const lastC = hist[hist.length - 1].bar.c;
    const ddPct = (lastC / hi52 - 1) * 100;
    const tId = ev.add("R", { type: "indicator", label: `${symbol} 고점 대비 하락률`, value: fmtPct(ddPct), source: "사이트 계산 (일봉 종가)", asOf: tradeDate });
    if (ddPct <= -10) current.push(S(`현재 종가는 최근 1년 종가 고점 대비 ${fmtPct(ddPct)} 낮은 수준입니다.`, "calc", [tId]));
    else if (ddPct >= -1) current.push(S("현재 종가는 최근 1년 종가 고점 부근(1% 이내)에 있습니다.", "calc", [tId]));
    const v20 = realizedVol(hist.map((d) => d.bar.c), 20);
    const v250 = realizedVol(hist.map((d) => d.bar.c), Math.min(250, hist.length - 1));
    if (v20 !== null && v250 !== null) {
      const vId2 = ev.add("R", { type: "indicator", label: `${symbol} 실현 변동성`, value: `20일 ${(v20 * 100).toFixed(1)}% / 1년 ${(v250 * 100).toFixed(1)}%`, source: "사이트 계산 (일봉 종가)", asOf: tradeDate });
      current.push(
        S(
          `최근 20거래일 연환산 실현 변동성은 ${(v20 * 100).toFixed(1)}%로, 최근 1년 평균(${(v250 * 100).toFixed(1)}%)보다 ${v20 > v250 * 1.2 ? "높습니다" : v20 < v250 * 0.8 ? "낮습니다" : "비슷합니다"}.`,
          "calc",
          [vId2],
        ),
      );
    }
  }
  const nextEarn = evs[0];
  if (nextEarn && Math.round((Date.parse(nextEarn.date) - Date.parse(today)) / 86400000) <= 7) {
    current.push(S(`${nextEarn.date} 실적 발표가 예정되어 있습니다. 실적 발표 전후에는 주가 변동이 커지는 경우가 많습니다.`, "interpretation"));
  }
  if (inst.kind === "etf") {
    const prof = etfProfile(symbol);
    if (prof.top10Weight !== null && prof.holdingsSource) {
      const id = ev.add("F", { type: "profile", label: `${symbol} 상위 10개 종목 비중`, value: `${prof.top10Weight.toFixed(1)}%`, source: prof.holdingsSource });
      current.push(S(`상위 10개 편입 종목 비중 합계는 ${prof.top10Weight.toFixed(1)}%입니다(제공처 최신 공시 기준).`, "fact", [id]));
      providers.add(prof.holdingsSource);
    }
    if (inst.leverage && bmPrimary) {
      const bmCloses = dailyFor(bmPrimary.symbol).filter((d) => d.date <= tradeDate).map((d) => d.bar.c);
      const bv = realizedVol(bmCloses, 20);
      if (bv !== null) {
        const id = ev.add("R", { type: "indicator", label: `${bmPrimary.symbol} 20일 실현 변동성`, value: `${(bv * 100).toFixed(1)}%`, source: "사이트 계산", asOf: tradeDate });
        current.push(
          S(
            `기준 지수의 최근 20거래일 실현 변동성은 ${(bv * 100).toFixed(1)}%입니다. 변동성이 높을수록 ${inst.leverage}배 레버리지 ETF 의 복리 효과(변동성 손실)가 커질 수 있습니다.`,
            "calc",
            [id],
          ),
        );
      }
    }
    if ((inst.strategy === "covered_call_index" || inst.strategy === "option_income_active") && hist.length > 252) {
      const p0 = hist[hist.length - 253].bar.c;
      const p1 = hist[hist.length - 1].bar.c;
      const startDate = hist[hist.length - 253].date;
      const paid = divs.filter((d) => d.exDate > startDate && d.exDate <= tradeDate).reduce((a, d) => a + d.amount, 0);
      const id = ev.add("R", { type: "dividend", label: `${symbol} 1년 가격·분배금`, value: `가격 ${fmtPct((p1 / p0 - 1) * 100)}, 분배금 ${fmtDividend(paid)}`, source: "사이트 계산" });
      current.push(
        S(
          `최근 1년 가격 수익률은 ${fmtPct((p1 / p0 - 1) * 100)}, 같은 기간 받은 분배금을 현금으로 더한 수익률은 ${fmtPct(((p1 + paid) / p0 - 1) * 100)}입니다(재투자·세금 미반영).`,
          "calc",
          [id],
        ),
      );
    }
  } else {
    const fv = stockFundamentals(symbol, price);
    if (fv.trailingPE.value !== null || fv.forwardPE.value !== null) {
      const id = ev.add("F", {
        type: "profile",
        label: `${symbol} 밸류에이션`,
        value: `PER ${fv.trailingPE.value?.toFixed(1) ?? "-"} / 선행 PER ${fv.forwardPE.value?.toFixed(1) ?? "-"}`,
        source: fv.trailingPE.source ?? fv.forwardPE.source ?? "-",
      });
      current.push(S(`현재 PER ${fv.trailingPE.value?.toFixed(1) ?? "-"}배, 선행 PER ${fv.forwardPE.value?.toFixed(1) ?? "-"}배입니다(제공처 기준). 이 수치 자체로 고평가·저평가를 판단하지 않습니다.`, "fact", [id]));
    }
  }

  // ─────────────── 8. 전일 대비 새 변화 · 종합 판단 ───────────────
  const series = daily.filter((d) => d.date <= tradeDate);
  if (session === "intraday" && dd && series[series.length - 1]?.date !== tradeDate && isNum(dd.open) && isNum(dd.high) && isNum(dd.low)) {
    series.push({ date: tradeDate, bar: { t: Math.floor((dd.asOf ?? now) / 1000), o: dd.open, h: dd.high, l: dd.low, c: dd.close, v: isNum(dd.volume) ? dd.volume : 0 } });
  }
  const curState = series[series.length - 1]?.date === tradeDate ? signalStateAt(series, series.length - 1) : null;
  const prevState = curState ? signalStateAt(series, series.length - 2) : null;
  const evIds = { price: pId ? [pId] : [], volume: vId ? [vId] : [], tech: techId ? [techId] : [] };
  const changeItems: ChangeItem[] = [];
  if (curState && session !== "non_trading") changeItems.push(...priceSignalChanges(prevState, curState, evIds));
  if (dd && dd.changePct !== null && bmPrimary && session !== "non_trading") {
    if (inst.leverage) {
      const exp = bmPrimary.change * inst.leverage;
      const gap = dd.changePct - exp;
      if (Math.abs(gap) >= 1) {
        changeItems.push({
          short: `일일 목표와 ${fmtSigned(gap)}%p 차이`,
          text: `오늘 등락률 ${fmtPct(dd.changePct)}는 기준 지수 × ${inst.leverage}(${fmtPct(exp)})와 ${fmtSigned(gap)}%p 차이가 납니다. 종가 산정 시점·운용 비용 등으로 생길 수 있으며 원인을 특정하지 않습니다.`,
          kind: "calc",
          importance: 2,
          tag: "relative",
          direction: "neutral",
          evidence: [pId, bmPrimary.id],
        });
      }
    } else {
      const gap = dd.changePct - bmPrimary.change;
      if (Math.abs(gap) >= 2) {
        changeItems.push({
          short: `${bmPrimary.symbol} 대비 ${fmtSigned(gap)}%p`,
          text: `기준 지수 ${marketSymbolName(bmPrimary.symbol)}(${fmtPct(bmPrimary.change)})보다 ${fmtSigned(gap)}%p ${gap > 0 ? "강하게" : "약하게"} 움직였습니다.`,
          kind: "calc",
          importance: 2,
          tag: "relative",
          direction: gap > 0 ? "up" : "down",
          evidence: [pId, bmPrimary.id],
        });
      }
    }
  }
  if (directNews.length) {
    changeItems.push({
      short: `새 관련 기사 ${directNews.length}건`,
      text: `직전 장 마감 이후 관련 기사 ${directNews.length}건이 새로 확인되었습니다. 대표 기사: "${directNews[0].title}" (${directNews[0].publisher ?? directNews[0].provider}). 기사와 주가 움직임의 인과관계는 확인되지 않았습니다.`,
      kind: "fact",
      importance: directNews.length >= 3 ? 3 : 2,
      tag: "news",
      direction: "neutral",
      evidence: directNews.slice(0, 3).map((n) => n.evidenceId),
    });
  }
  const prevSession = previousTradingDay(tradeDate);
  const divsSorted = [...divs].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const exToday = divsSorted.find((d) => d.exDate === tradeDate);
  if (exToday && session !== "non_trading") {
    const id = ev.add("D", { type: "dividend", label: `${symbol} 배당락`, value: `${fmtDividend(exToday.amount)} (배당락일 ${exToday.exDate})`, source: exToday.sources.join(", ") });
    changeItems.push({ short: `오늘 배당락 ${fmtDividend(exToday.amount)}`, text: `${tradeDate}은 ${word} 배당락일입니다(주당 ${fmtDividend(exToday.amount)}). 당일 등락률에는 ${word}만큼의 가격 조정이 포함됩니다.`, kind: "fact", importance: 3, tag: "dividend", direction: "neutral", evidence: [id] });
  }
  const declared = divsSorted.filter((d) => d.declaredDate && d.declaredDate > prevSession && d.declaredDate <= today && d.exDate !== tradeDate);
  for (const d of declared.slice(-1)) {
    const before = divsSorted.filter((x) => x.exDate < d.exDate).slice(-1)[0];
    const chg = before ? (d.amount / before.amount - 1) * 100 : null;
    const id = ev.add("D", { type: "dividend", label: `${symbol} 새 ${word} 발표`, value: `${fmtDividend(d.amount)} (발표 ${d.declaredDate}, 배당락 ${d.exDate})`, source: d.sources.join(", ") });
    changeItems.push({
      short: `${word} 발표 ${fmtDividend(d.amount)}${chg === null ? "" : Math.abs(chg) < 0.05 ? " (직전과 같음)" : ` (${fmtPct(chg, 1)})`}`,
      text: `새 ${word}이 발표되었습니다: 주당 ${fmtDividend(d.amount)}, 배당락일 ${d.exDate}, 지급일 ${d.payDate ?? "미제공"}${chg === null ? "" : Math.abs(chg) < 0.05 ? ` — 직전 지급(${fmtDividend(before?.amount)})과 같은 금액` : ` — 직전 지급(${fmtDividend(before?.amount)}) 대비 ${fmtPct(chg)}`}.`,
      kind: "fact",
      importance: 3,
      tag: "dividend",
      direction: chg === null || Math.abs(chg) < 0.01 ? "neutral" : chg > 0 ? "up" : "down",
      evidence: [id],
    });
  }
  const earnNear = readEvents(prevSession, addDays(tradeDate, 7), { kinds: ["earnings"], symbols: [symbol] });
  const eToday = earnNear.find((e) => e.date === tradeDate);
  const eSoon = earnNear.find((e) => e.date > tradeDate && e.date > addDays(prevSession, 7));
  if (eToday && session !== "non_trading") {
    changeItems.push({ short: "실적 발표일", text: `${tradeDate} 실적 발표일입니다${eToday.timeHint ? ` (${eToday.timeHint})` : ""}. 발표 내용은 기업 공시와 관련 기사에서 확인하세요.`, kind: "fact", importance: 3, tag: "event", direction: "neutral", evidence: [] });
  } else if (eSoon) {
    changeItems.push({ short: `실적 발표 ${eSoon.date}`, text: `실적 발표(${eSoon.date}${eSoon.timeHint ? `, ${eSoon.timeHint}` : ""})가 7일 이내로 다가왔습니다.`, kind: "fact", importance: 2, tag: "event", direction: "neutral", evidence: [] });
  }
  const changes: NonNullable<SymbolBriefing["changes"]> = {
    comparedWith: prevState?.date ?? null,
    items: sortChanges(changeItems).slice(0, 8),
    table: curState && prevState && session !== "non_trading" ? compareRows(prevState, curState) : [],
    note: changeItems.length
      ? null
      : session === "non_trading"
        ? "휴장일이라 새 가격 변화가 없고, 새로 확인된 뉴스·일정 변화도 없습니다."
        : "전일 대비 새로 확인된 중요한 변화가 없습니다.",
  };

  const bench20 = bmPrimary ? pctChangeOver(dailyFor(bmPrimary.symbol), tradeDate, 20) : null;
  let incomeView: { ttmYield: number | null; ttmChangePct: number | null; word: string } | null = null;
  if (["income", "dividend_growth"].includes(inst.category) && divsSorted.length) {
    const s = summarizeDividends(divsSorted, tradeDate, price);
    const y1 = addDays(tradeDate, -365);
    const y2 = addDays(tradeDate, -730);
    const sumIn = (a: string, b: string) => divsSorted.filter((d) => d.exDate > a && d.exDate <= b).reduce((x, d) => x + d.amount, 0);
    const recent = sumIn(y1, tradeDate);
    const before = sumIn(y2, y1);
    const longEnough = divsSorted[0].exDate <= addDays(y2, 45);
    incomeView = { ttmYield: s.ttmYield, ttmChangePct: longEnough && before > 0 && recent > 0 ? (recent / before - 1) * 100 : null, word };
  }
  const nextEarnInfo = evs[0] ? { date: evs[0].date, daysAway: Math.round((Date.parse(evs[0].date) - Date.parse(today)) / 86400000) } : null;
  const nextEx = divsSorted.find((d) => d.exDate > tradeDate);
  const judgment = buildJudgment({
    symbol,
    cur: curState,
    bench20: bmPrimary && bench20 !== null ? { symbol: bmPrimary.symbol, ret: bench20 } : null,
    leverage: inst.leverage,
    coveredCall: inst.strategy === "covered_call_index" || inst.strategy === "option_income_active",
    levels,
    nextEarnings: nextEarnInfo,
    nextExDate: nextEx ? { date: nextEx.exDate, amount: nextEx.amount } : null,
    income: incomeView,
    evidence: { price: evIds.price, tech: evIds.tech, volume: evIds.volume, bench: bmPrimary ? [bmPrimary.id] : [] },
  });

  // ─────────────── 핵심 요약 ───────────────
  const summary: Statement[] = [];
  if (priceStatements[0]) summary.push(priceStatements[0]);
  const volSt = priceStatements.find((s) => s.evidence.includes(vId));
  if (volSt) summary.push(volSt);
  const bmMain = benchmarkSt.find((s) => s.kind === "calc");
  if (bmMain) summary.push(bmMain);
  if (directNews.length) {
    summary.push(S(`관련 기사 ${directNews.length}건 확인 — 대표 기사: "${directNews[0].title}" (${directNews[0].publisher ?? directNews[0].provider}).`, "fact", [directNews[0].evidenceId]));
  } else if (newsItems.length) {
    summary.push(S(`직접 관련 기사는 없고, 기초지수·기초자산 관련 기사 ${newsItems.length}건이 확인되었습니다.`, "fact", newsItems.slice(0, 1).map((n) => n.evidenceId)));
  } else {
    summary.push(S("이 기간에 확인된 관련 뉴스가 없습니다.", "notice"));
  }
  if (distributions?.statements[0] && distributions.available && ["income", "dividend_growth"].includes(inst.category)) summary.push(distributions.statements[0]);
  const soon = upcoming.find((u) => u.kind === "실적 발표" || u.kind === "배당락");
  if (soon && Math.round((Date.parse(soon.date) - Date.parse(today)) / 86400000) <= 10) {
    summary.push(S(`예정 일정: ${soon.date} ${soon.title} (${soon.source}).`, "fact"));
  }
  if (session === "non_trading") {
    summary.unshift(S(`오늘은 미국 증시 휴장일입니다. 아래 가격 정보는 마지막 거래일(${tradeDate}) 기준이며 당일 주가 분석은 생성하지 않습니다.`, "notice"));
  }

  const topChange = changes.items.find((c) => c.importance >= 2 && c.tag !== "news");
  const headlineParts = [
    `${symbol} ${dd ? fmtPct(dd.changePct) : "가격 데이터 없음"}`,
    topChange ? topChange.short : volRatio !== null ? `거래량 20일 평균의 ${volRatio.toFixed(1)}배` : null,
    directNews.length ? `관련 뉴스 ${directNews.length}건` : "직접 관련 뉴스 없음",
  ].filter(Boolean);

  if (!newsItems.length && !providers.size) limitations.push("뉴스 데이터 제공처 응답이 없었습니다");
  const priceAsOf = dd?.asOf ?? null;

  return {
    version: 1,
    scope: symbol,
    name,
    kind: inst.kind,
    category: inst.category,
    session,
    sessionLabel: sessionLabelOf(session, tradeDate, now),
    tradeDate,
    generatedAt: now,
    headline: headlineParts.join(" · "),
    status: dd ? "ok" : "partial",
    summary,
    price: {
      available: Boolean(dd),
      statements: priceStatements,
      table,
      recent: recentRows,
      intraday,
      benchmark: benchmarkSt,
      causality,
    },
    news: { windowLabel, items: newsItems, holdingsItems, olderCount: older, statements: newsStatements },
    technical: {
      available: techValues.length > 0,
      values: techValues,
      interpretations: interp,
      levels,
      note: "기술적 지표는 과거 가격으로 계산한 값이며 미래 움직임을 보장하지 않습니다. 지지·저항은 최근 스윙 고점·저점을 묶은 '분석상 참고 수준'일 뿐 확정적인 가격이 아닙니다.",
    },
    distributions,
    upcoming: { items: upcoming, note: upcoming.length ? null : "확인된 예정 일정이 없습니다 (데이터 제공처 기준)." },
    risks: { general: generalRisks(inst), current },
    ai: null,
    changes,
    judgment,
    glance: {
      price: dd?.close ?? null,
      changePct: dd?.changePct ?? null,
      volRatio,
      ret20: curState?.ret20 ?? null,
      rsi: curState?.rsi ?? null,
      fromHigh: curState?.fromHigh ?? null,
      vol20: curState?.vol20 ?? null,
    },
    basis: {
      analysisDate: tradeDate,
      priceAsOf,
      priceAsOfLabel: dd ? (dd.provisional ? "잠정(장중 또는 확정 전)" : "정규장 확정") : "데이터 없음",
      newsAsOf: now,
      providers: [...providers],
      limitations,
    },
    evidence: ev.list,
  };
}
