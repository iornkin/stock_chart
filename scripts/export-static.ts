/**
 * 정적 사이트 데이터 내보내기
 *   STATIC_EXPORT=1 next build 로 out/ 을 만든 뒤 실행한다: npm run export:static
 * 화면(브라우저)이 읽는 JSON 을 out/data 아래에 쓴다. 네트워크는 쓰지 않고 DB 에 저장된 데이터만 사용한다.
 */
import fs from "node:fs";
import path from "node:path";
import { INSTRUMENTS, MARKET_SYMBOLS } from "@/config/instruments";
import { readBarMeta, readBars } from "@/lib/data/bars";
import { readDividends } from "@/lib/data/dividends";
import { delayLabel, getQuotes } from "@/lib/data/quotes";
import { loadCompareInput } from "@/lib/compare";
import { buildIncomeMap, buildSeries, seriesSymbols } from "@/lib/data/series";
import { buildExposureMap } from "@/lib/data/exposure";
import { buildEtfHistoryMap } from "@/lib/data/etf-history";
import { encodeSeries, seriesFileKey } from "@/lib/sim/series";
import { availableBriefingDates, briefingHistory, briefingsForDate, latestBriefingRecords, readBriefing } from "@/lib/briefing/store";
import type { MarketBriefing, SessionType, SymbolBriefing } from "@/lib/briefing/types";
import { digestOf, type BriefingDigest } from "@/lib/briefing/digest";
import { describeSchedule, getSchedule } from "@/lib/jobs/schedule";
import { JOB_LABELS } from "@/lib/jobs/jobs";
import { env } from "@/lib/env";
import { etDate, etToUtc } from "@/lib/time";
import type { Bar, Interval } from "@/lib/types";

const OUT = path.resolve(process.env.OUT_DIR ?? "out");
const DATA = path.join(OUT, "data");
const WORKFLOW = path.resolve(".github/workflows/pages.yml");
let files = 0;
let bytes = 0;

function write(rel: string, value: unknown) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const s = JSON.stringify(value);
  fs.writeFileSync(p, s);
  files++;
  bytes += s.length;
}

/** 5분봉을 정규장 시작(09:30 ET) 기준 구간으로 묶는다 — Yahoo 의 15·30·60분봉과 같은 정렬 */
function aggregateIntraday(bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = [];
  const size = minutes * 60;
  const anchors = new Map<string, number>();
  let cur: Bar | null = null;
  for (const b of bars) {
    const d = etDate(b.t * 1000);
    let anchor = anchors.get(d);
    if (anchor === undefined) {
      anchor = etToUtc(d, "09:30") / 1000;
      anchors.set(d, anchor);
    }
    const start = anchor + Math.floor((b.t - anchor) / size) * size;
    if (cur && cur.t === start) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    } else {
      cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      out.push(cur);
    }
  }
  return out;
}

function metaOf(symbol: string, interval: Interval, sourceNote?: string) {
  const m = readBarMeta(symbol, interval);
  let instrument: Record<string, unknown> = {};
  try {
    instrument = m?.meta ? JSON.parse(m.meta) : {};
  } catch {
    instrument = {};
  }
  const source = m?.source ? `${m.source}${sourceNote ? ` (${sourceNote})` : ""}` : null;
  return { meta: { source, fetchedAt: m?.fetched_at ?? null, stale: false, error: null as string | null }, instrument };
}

function exportCharts(symbol: string) {
  const fiveMin = readBars(symbol, "5m");
  const divs = readDividends(symbol).map((d) => ({ exDate: d.exDate, amount: d.amount, kind: d.kind }));
  const charts: { interval: Interval; bars: Bar[]; info: ReturnType<typeof metaOf> }[] = [
    { interval: "5m", bars: fiveMin, info: metaOf(symbol, "5m") },
    { interval: "15m", bars: aggregateIntraday(fiveMin, 15), info: metaOf(symbol, "5m", "5분봉에서 집계") },
    { interval: "30m", bars: aggregateIntraday(fiveMin, 30), info: metaOf(symbol, "5m", "5분봉에서 집계") },
  ];
  // 1시간봉: 수집된 1시간봉(최대 2년) 뒤에 그 이후 5분봉을 묶어 이어 붙인다
  const hourly = readBars(symbol, "60m");
  const lastHour = hourly.length ? hourly[hourly.length - 1].t : 0;
  const tail = aggregateIntraday(fiveMin, 60).filter((b) => b.t > lastHour);
  const hourlyInfo = hourly.length ? metaOf(symbol, "60m", tail.length ? "최근 구간은 5분봉에서 집계" : undefined) : metaOf(symbol, "5m", "5분봉에서 집계");
  charts.push({ interval: "60m", bars: [...hourly, ...tail], info: hourlyInfo });
  for (const interval of ["1d", "1wk", "1mo"] as const) charts.push({ interval, bars: readBars(symbol, interval), info: metaOf(symbol, interval) });

  for (const c of charts) {
    const daily = c.interval === "1d" || c.interval === "1wk" || c.interval === "1mo";
    write(`chart/${symbol}/${c.interval}.json`, {
      symbol,
      interval: c.interval,
      bars: c.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
      meta: c.bars.length ? c.info.meta : { ...c.info.meta, error: "수집된 가격 데이터가 없습니다" },
      instrument: c.info.instrument,
      dividends: daily ? divs : [],
      ...(c.bars.length ? {} : { error: "수집된 가격 데이터가 없습니다" }),
    });
  }
}

function exportBriefings() {
  const latest: Record<string, BriefingDigest> = {};
  for (const b of latestBriefingRecords()) if (b.scope !== "MARKET") latest[b.scope] = digestOf(b.content as SymbolBriefing);
  write("briefing/latest.json", latest);

  // 종목·시장별 최근 30건 (브리핑 상세 페이지의 기록 목록과 같은 범위)
  for (const scope of ["MARKET", ...INSTRUMENTS.map((i) => i.symbol)]) {
    for (const h of briefingHistory(scope, 30)) {
      const rec = readBriefing(scope, h.tradeDate, h.session);
      if (rec) write(`briefing/${scope}/${h.tradeDate}_${h.session}.json`, rec);
    }
  }
  // 날짜별 목록 (브리핑 목록 페이지의 날짜 선택)
  for (const date of availableBriefingDates(30)) {
    const items = briefingsForDate(date);
    const markets: Partial<Record<SessionType, MarketBriefing>> = {};
    for (const s of new Set(items.map((i) => i.session))) {
      const m = readBriefing<MarketBriefing>("MARKET", date, s);
      if (m) markets[s] = m.content;
    }
    write(`briefing/day/${date}.json`, { date, items, markets });
  }
}

function actionsCrons(): string[] {
  try {
    const y = fs.readFileSync(WORKFLOW, "utf8");
    return [...y.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

async function main() {
  if (!fs.existsSync(OUT)) {
    console.error(`${OUT} 가 없습니다. 먼저 STATIC_EXPORT=1 로 next build 를 실행하세요.`);
    process.exit(1);
  }
  // 내보내기 중에는 제공처를 호출하지 않는다 (수집은 run-job 이 이미 끝냄)
  process.env.ON_DEMAND_FETCH = "0";
  fs.rmSync(DATA, { recursive: true, force: true });
  const started = Date.now();

  const symbols = [...INSTRUMENTS.map((i) => i.symbol), ...MARKET_SYMBOLS.map((m) => m.symbol)];
  const quotes = await getQuotes(symbols, "list");
  write("quotes.json", {
    quotes: [...quotes.values()].map((q) => ({ ...q, delay: delayLabel(q) })),
    missing: symbols.filter((s) => !quotes.has(s)),
    serverTime: started,
  });

  for (const i of INSTRUMENTS) {
    exportCharts(i.symbol);
    write(`compare/${i.symbol}.json`, await loadCompareInput(i.symbol, { allowFetch: false }));
  }
  // 백테스트·시뮬레이션용 일봉 종가 + 분배금 (지수·환율 포함)
  for (const s of seriesSymbols()) write(`series/${seriesFileKey(s)}.json`, encodeSeries(buildSeries(s)));
  write("income.json", { asOf: started, items: buildIncomeMap() });
  write("exposure.json", { asOf: started, items: buildExposureMap() });
  write("exposure-history.json", { asOf: started, items: buildEtfHistoryMap() });
  exportBriefings();

  const schedule = getSchedule();
  write("status.json", {
    schedule,
    scheduleRows: describeSchedule(schedule).map((r) => ({ ...r, label: JOB_LABELS[r.job] })),
    worker: { alive: false, owner: null, leaseUntil: null },
    adminEnabled: false,
    llm: { enabled: Boolean(env.anthropicKey), model: env.llmModel, sessions: env.llmSessions },
    actionsCrons: actionsCrons(),
  });
  write("build.json", { builtAt: started });
  // GitHub Pages 의 Jekyll 처리 끄기 (_next 폴더가 무시되지 않도록)
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  console.log(`정적 데이터 ${files}개 파일, ${(bytes / 1024 / 1024).toFixed(1)}MB → ${DATA}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
