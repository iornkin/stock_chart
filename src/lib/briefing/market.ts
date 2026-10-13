/**
 * 오늘의 미국 시장 브리핑 생성기 (규칙 기반)
 * 실제로 확인된 데이터가 있는 섹션만 포함한다.
 */
import { MARKET_SYMBOLS } from "@/config/instruments";
import { allInstruments, getInstrument, marketSymbolName } from "../instruments";
import { readNews, MARKET_SCOPE } from "../data/news";
import { readEvents, readMacro } from "../data/events";
import { readAllDividends } from "../data/dividends";
import { nextTradingDay, previousTradingDay, sessionTimes } from "../market-calendar";
import { fmtPct, fmtPrice, fmtSigned, fmtDividend } from "../format";
import { etDate, formatEt } from "../time";
import { dayData, sessionLabelOf } from "./symbol";
import type { BriefingNews, Evidence, KeyValue, MarketBriefing, SessionType, Statement, UpcomingItem } from "./types";

const S = (text: string, kind: Statement["kind"], evidence: string[] = []): Statement => ({ text, kind, evidence });

export function buildMarketBriefing(session: SessionType, tradeDate: string, now = Date.now()): MarketBriefing {
  const evidence: Evidence[] = [];
  let n = 0;
  const addEv = (e: Omit<Evidence, "id">) => {
    const id = `E${++n}`;
    evidence.push({ id, ...e });
    return id;
  };
  const sections: MarketBriefing["sections"] = [];
  const limitations: string[] = [];
  const providers = new Set<string>();

  // 1. 주요 지수
  const idxSt: Statement[] = [];
  const idxTable: KeyValue[] = [];
  const idxChanges = new Map<string, number>();
  for (const m of MARKET_SYMBOLS.filter((x) => x.group === "index")) {
    const d = dayData(m.symbol, tradeDate, session);
    if (!d || d.changePct === null) continue;
    providers.add(d.source);
    idxChanges.set(m.symbol, d.changePct);
    const id = addEv({ type: "price", label: m.nameKo, value: `${fmtPrice(d.close)} (${fmtPct(d.changePct)})`, source: d.source, asOf: d.asOf ? formatEt(d.asOf) : tradeDate });
    idxTable.push({ label: m.nameKo, value: `${fmtPrice(d.close)} (${fmtPct(d.changePct)})`, kind: "fact" });
    if (["^GSPC", "^NDX"].includes(m.symbol)) idxSt.push(S(`${m.nameKo}는 ${fmtPrice(d.close)}로 ${fmtPct(d.changePct)} 움직였습니다.`, "fact", [id]));
  }
  if (idxTable.length) {
    const up = [...idxChanges.values()].filter((v) => v > 0).length;
    idxSt.push(S(`확인된 주요 지수 ${idxChanges.size}개 중 ${up}개 상승, ${idxChanges.size - up}개 하락(또는 보합)했습니다.`, "calc"));
    const sp = idxChanges.get("^GSPC");
    const nd = idxChanges.get("^NDX");
    const rut = idxChanges.get("^RUT");
    if (sp !== undefined && nd !== undefined) {
      idxSt.push(S(`NASDAQ 100 과 S&P 500 등락률 차이는 ${fmtSigned(nd - sp)}%p로, 기술주 중심 지수가 ${nd >= sp ? "상대적으로 강했습니다" : "상대적으로 약했습니다"}.`, "calc"));
    }
    if (sp !== undefined && rut !== undefined) idxSt.push(S(`러셀 2000(소형주)은 S&P 500 대비 ${fmtSigned(rut - sp)}%p 차이를 보였습니다.`, "calc"));
    sections.push({ key: "indices", title: "주요 지수", statements: idxSt, table: idxTable });
  } else limitations.push("지수 데이터를 확인하지 못했습니다");

  // 2. M7 및 지원 종목 등락
  const moves: { symbol: string; change: number; id: string }[] = [];
  for (const i of allInstruments()) {
    const d = dayData(i.symbol, tradeDate, session);
    if (!d || d.changePct === null) continue;
    moves.push({ symbol: i.symbol, change: d.changePct, id: "" });
  }
  const m7 = moves.filter((m) => getInstrument(m.symbol)?.category === "m7").sort((a, b) => b.change - a.change);
  if (m7.length) {
    const id = addEv({ type: "price", label: "M7 등락률", value: m7.map((m) => `${m.symbol} ${fmtPct(m.change)}`).join(", "), source: "Yahoo Finance", asOf: tradeDate });
    const avg = m7.reduce((a, m) => a + m.change, 0) / m7.length;
    const st = [
      S(`M7 등락률: ${m7.map((m) => `${m.symbol} ${fmtPct(m.change)}`).join(", ")}.`, "fact", [id]),
      S(`M7 단순 평균 등락률은 ${fmtPct(avg)}이며, 가장 강한 종목은 ${m7[0].symbol}(${fmtPct(m7[0].change)}), 가장 약한 종목은 ${m7[m7.length - 1].symbol}(${fmtPct(m7[m7.length - 1].change)})입니다.`, "calc", [id]),
    ];
    const big = m7.filter((m) => Math.abs(m.change) >= 3);
    if (big.length) st.push(S(`3% 이상 움직인 M7 종목: ${big.map((b) => b.symbol).join(", ")} — 개별 종목 브리핑에서 관련 뉴스와 함께 확인할 수 있습니다.`, "fact", [id]));
    sections.push({ key: "m7", title: "M7 대형 기술주", statements: st });
  }
  if (moves.length >= 5) {
    const sorted = [...moves].sort((a, b) => b.change - a.change);
    const id = addEv({ type: "price", label: "지원 종목 등락 순위", value: `${moves.length}개 종목`, source: "Yahoo Finance", asOf: tradeDate });
    sections.push({
      key: "movers",
      title: "지원 종목 상승·하락 상위",
      statements: [
        S(`상승률 상위: ${sorted.slice(0, 3).map((m) => `${m.symbol} ${fmtPct(m.change)}`).join(", ")}.`, "calc", [id]),
        S(`하락률 상위: ${sorted.slice(-3).reverse().map((m) => `${m.symbol} ${fmtPct(m.change)}`).join(", ")}.`, "calc", [id]),
      ],
    });
  }

  // 3. 금리·달러·금·변동성
  const macroSt: Statement[] = [];
  for (const sym of ["^TNX", "^IRX", "DX-Y.NYB", "GC=F", "^VIX"]) {
    const d = dayData(sym, tradeDate, session);
    if (!d || d.changePct === null) continue;
    const name = marketSymbolName(sym);
    const id = addEv({ type: "macro", label: name, value: `${fmtPrice(d.close, 3)} (${fmtPct(d.changePct)})`, source: d.source, asOf: tradeDate });
    if (sym === "^TNX" || sym === "^IRX") {
      macroSt.push(S(`${name}: ${fmtPrice(d.close, 3)}% (전일 대비 ${fmtSigned(d.prevClose !== null ? (d.close - d.prevClose) * 100 : null, 1)}bp).`, "fact", [id]));
    } else macroSt.push(S(`${name}: ${fmtPrice(d.close)} (${fmtPct(d.changePct)}).`, "fact", [id]));
  }
  for (const [series, label] of [
    ["DGS10", "FRED 10년 국채금리(일별 공시)"],
    ["DGS2", "FRED 2년 국채금리(일별 공시)"],
  ] as const) {
    const obs = readMacro(series, 2);
    if (obs.length) {
      const lastO = obs[obs.length - 1];
      const id = addEv({ type: "macro", label, value: `${lastO.value}% (${lastO.date})`, source: "FRED" });
      macroSt.push(S(`${label}: ${lastO.value.toFixed(2)}% (${lastO.date} 기준 — FRED 는 하루 늦게 공시될 수 있음).`, "fact", [id]));
      providers.add("FRED");
    }
  }
  const d10 = readMacro("DGS10", 1)[0];
  const d2 = readMacro("DGS2", 1)[0];
  if (d10 && d2 && d10.date === d2.date) macroSt.push(S(`10년−2년 금리차: ${fmtSigned((d10.value - d2.value) * 100, 0)}bp (${d10.date}).`, "calc"));
  if (macroSt.length) sections.push({ key: "macro", title: "금리·달러·금·변동성", statements: macroSt });

  // 4. 경제지표 발표 (오늘)
  const econToday = readEvents(tradeDate, tradeDate, { kinds: ["economic"] });
  if (econToday.length) {
    const st = econToday.map((e) => {
      const id = addEv({ type: "event", label: e.title, value: String(e.data?.releaseName ?? ""), source: e.source, asOf: e.date });
      return S(`${e.date} 발표 일정: ${e.title} (FRED 발표 일정 기준 '${e.data?.releaseName}'). 발표 수치는 이 사이트에서 수집하지 않으므로 관련 뉴스로 확인하세요.`, "fact", [id]);
    });
    sections.push({ key: "economy", title: "경제지표 발표", statements: st });
    providers.add("FRED");
  }

  // 5. 실적 발표 (오늘)
  const earnToday = readEvents(tradeDate, tradeDate, { kinds: ["earnings"] });
  if (earnToday.length) {
    const st = earnToday.slice(0, 12).map((e) => {
      const d = e.data ?? {};
      const actual = d.epsActual as number | null | undefined;
      const est = d.epsEstimate as number | null | undefined;
      const id = addEv({ type: "event", label: e.title, value: actual != null ? `EPS ${actual} (예상 ${est ?? "-"})` : "발표 수치 미수집", source: e.source, asOf: e.date });
      const rel = ((d.relatedEtfs as string[] | undefined) ?? []).slice(0, 4).join(", ");
      return S(
        `${e.symbol}: ${e.timeHint ?? "시간 미정"} 실적 발표${actual != null ? ` — 주당순이익(EPS) ${actual}, 시장 예상 ${est ?? "-"} (${e.source})` : " (발표 수치 미수집)"}${rel ? ` · 관련 ETF: ${rel}` : ""}.`,
        "fact",
        [id],
      );
    });
    sections.push({ key: "earnings", title: "주요 기업 실적 발표", statements: st });
  }

  // 6. 시장 뉴스 (보도된 시장 해석)
  const windowStart = session === "non_trading" ? sessionTimes(tradeDate).close : sessionTimes(previousTradingDay(tradeDate)).close;
  const news = readNews(MARKET_SCOPE, windowStart, now, 10);
  const newsItems: BriefingNews[] = news.map((x) => {
    const id = addEv({ type: "news", label: x.title, value: x.publisher ?? undefined, source: x.provider, asOf: formatEt(x.publishedAt), url: x.url });
    providers.add(x.provider);
    return {
      id: x.id,
      evidenceId: id,
      title: x.title,
      titleKo: x.aiTitleKo ?? null,
      summary: x.summary,
      summaryKo: x.aiSummaryKo ?? null,
      summaryBasis: x.aiSummaryKo ? "ai" : x.summary ? "provider" : "none",
      publishedAt: x.publishedAt,
      publisher: x.publisher,
      provider: x.provider,
      url: x.url,
      reason: x.reason ?? "",
      matchType: x.matchType ?? null,
      duplicates: x.duplicates ?? [],
    };
  });
  if (newsItems.length) {
    sections.push({
      key: "news",
      title: "주요 시장 뉴스 (보도 내용)",
      statements: newsItems.slice(0, 5).map((it) =>
        S(`[${it.publisher ?? it.provider}, 게시 ${formatEt(it.publishedAt)}] ${it.title}`, "market_view", [it.evidenceId]),
      ),
    });
  } else limitations.push("이 기간에 수집된 시장 뉴스가 없습니다");

  // 7. 다음 거래일 확인 사항
  const next = nextTradingDay(tradeDate === etDate(now) || session !== "non_trading" ? tradeDate : etDate(now));
  const nextItems: UpcomingItem[] = [];
  for (const e of readEvents(next, next, { kinds: ["economic"] })) nextItems.push({ date: e.date, title: e.title, kind: "경제지표", source: e.source });
  for (const e of readEvents(next, next, { kinds: ["earnings"] }).slice(0, 10)) nextItems.push({ date: e.date, title: e.title, kind: "실적 발표", source: e.source, detail: e.timeHint ?? undefined });
  for (const d of readAllDividends(next, next).filter((x) => x.exDate === next)) {
    nextItems.push({ date: d.exDate, title: `${d.symbol} 배당락일 (주당 ${fmtDividend(d.amount)})`, kind: "배당락", source: d.sources.join(", ") });
  }

  const sp = idxChanges.get("^GSPC");
  const nd = idxChanges.get("^NDX");
  const headline =
    sp !== undefined || nd !== undefined
      ? `S&P 500 ${fmtPct(sp ?? null)} · NASDAQ 100 ${fmtPct(nd ?? null)}${m7.length ? ` · M7 최강 ${m7[0].symbol} ${fmtPct(m7[0].change)}` : ""}`
      : "지수 데이터 없음";

  return {
    version: 1,
    scope: "MARKET",
    session,
    sessionLabel: sessionLabelOf(session, tradeDate, now),
    tradeDate,
    generatedAt: now,
    headline,
    status: idxTable.length ? "ok" : "partial",
    sections,
    news: newsItems,
    nextDay: { date: next, items: nextItems },
    ai: null,
    basis: {
      analysisDate: tradeDate,
      priceAsOf: now,
      priceAsOfLabel: session === "intraday" ? "잠정(장중)" : session === "close" ? "정규장 확정" : "마지막 거래일",
      newsAsOf: now,
      providers: [...providers],
      limitations,
    },
    evidence,
  };
}
