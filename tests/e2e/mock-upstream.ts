/**
 * ⚠ 테스트 전용 가짜(모의) 데이터 제공처 서버 ⚠
 *
 * 실제 시장 데이터가 아니라, 결정적 난수로 생성한 '합성 데이터'를 각 제공처(Yahoo, Nasdaq, Finnhub,
 * FRED, SEC, Google News)의 응답 형식에 맞춰 돌려준다. 오직 자동 테스트(e2e)에서 데이터 수집 →
 * 저장 → 브리핑 생성 → 화면 표시까지의 전체 흐름을 검증하기 위해 사용한다.
 * 운영 환경에서는 절대 사용하지 않는다 (애플리케이션 코드는 이 파일을 참조하지 않음).
 */
import http from "node:http";
import { INSTRUMENTS, MARKET_SYMBOLS } from "@/config/instruments";
import { isTradingDay, marketStatus, sessionTimes } from "@/lib/market-calendar";
import { addDays, etDate, etToUtc } from "@/lib/time";

const PORT = Number(process.env.MOCK_PORT ?? 4010);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ── 거래일 목록 ──
const NOW = Date.now();
const ST = marketStatus(NOW);
const LAST = ST.lastCompletedSession;
const days: string[] = [];
for (let d = "2016-01-04"; d <= LAST; d = addDays(d, 1)) if (isTradingDay(d)) days.push(d);

// ── 기초 지수 수익률 (합성) ──
const baseSpec: Record<string, { start: number; mu: number; sigma: number }> = {
  "^GSPC": { start: 2000, mu: 0.0004, sigma: 0.011 },
  "^NDX": { start: 4400, mu: 0.0006, sigma: 0.014 },
  "^IXIC": { start: 5000, mu: 0.0005, sigma: 0.013 },
  "^DJI": { start: 17000, mu: 0.0003, sigma: 0.01 },
  "^RUT": { start: 1100, mu: 0.0002, sigma: 0.015 },
  "^SOX": { start: 650, mu: 0.0008, sigma: 0.02 },
  "GC=F": { start: 1080, mu: 0.0003, sigma: 0.009 },
  "^VIX": { start: 18, mu: 0, sigma: 0.05 },
  "^TNX": { start: 2.2, mu: 0.0001, sigma: 0.02 },
  "^IRX": { start: 0.3, mu: 0.0005, sigma: 0.03 },
  "DX-Y.NYB": { start: 98, mu: 0, sigma: 0.004 },
};
const baseRet: Record<string, number[]> = {};
for (const [s, sp] of Object.entries(baseSpec)) {
  const r = rng(hash(s));
  baseRet[s] = days.map(() => sp.mu + sp.sigma * gauss(r));
}

interface Spec {
  start: number;
  rets: number[];
}
function specFor(symbol: string): Spec {
  if (baseSpec[symbol]) return { start: baseSpec[symbol].start, rets: baseRet[symbol] };
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const r = rng(hash(symbol));
  const idio = days.map(() => gauss(r));
  const b = inst?.benchmarks?.find((x) => baseRet[x]) ?? "^GSPC";
  const br = baseRet[b] ?? baseRet["^GSPC"];
  const start = 20 + (hash(symbol) % 200);
  if (inst?.leverage) return { start: 10, rets: br.map((x) => x * (inst.leverage as number) - 0.00004) };
  if (inst?.strategy === "covered_call_index" || inst?.strategy === "option_income_active") {
    return { start: 50, rets: br.map((x, i) => (x > 0 ? x * 0.5 : x * 0.85) + 0.0001 + 0.002 * idio[i]) };
  }
  if (inst?.category === "m7") return { start, rets: br.map((x, i) => x * 1.2 + 0.015 * idio[i]) };
  if (inst?.category === "gold") return { start: 100 + (hash(symbol) % 30), rets: baseRet["GC=F"].map((x, i) => x - 0.00002 + 0.0008 * idio[i]) };
  return { start, rets: br.map((x, i) => x + 0.0015 * idio[i]) };
}

interface DBar {
  date: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
const cacheDaily = new Map<string, DBar[]>();
function dailyBars(symbol: string): DBar[] {
  const hit = cacheDaily.get(symbol);
  if (hit) return hit;
  const sp = specFor(symbol);
  const r = rng(hash(`${symbol}#ohlc`));
  let px = sp.start;
  const out: DBar[] = [];
  const vol0 = 1e6 + (hash(symbol) % 50) * 1e6;
  days.forEach((d, i) => {
    const o = px * (1 + 0.002 * gauss(r));
    const c = Math.max(0.5, px * Math.exp(sp.rets[i]));
    const h = Math.max(o, c) * (1 + Math.abs(0.004 * gauss(r)));
    const l = Math.min(o, c) * (1 - Math.abs(0.004 * gauss(r)));
    const v = Math.round(vol0 * (0.6 + r() * 0.8) * (1 + Math.abs(sp.rets[i]) * 30));
    out.push({ date: d, t: Math.floor(etToUtc(d, "09:30") / 1000), o, h, l, c, v });
    px = c;
  });
  cacheDaily.set(symbol, out);
  return out;
}

function intradayBars(symbol: string, minutes: number, sessions: number) {
  const daily = dailyBars(symbol).slice(-sessions);
  const out: DBar[] = [];
  for (const d of daily) {
    const r = rng(hash(`${symbol}${d.date}${minutes}`));
    const n = Math.round((sessionTimes(d.date).close - sessionTimes(d.date).open) / 60000 / minutes);
    let px = d.o;
    for (let k = 0; k < n; k++) {
      const target = d.o + ((d.c - d.o) * (k + 1)) / n;
      const next = target + (d.h - d.l) * 0.15 * gauss(r);
      const c = Math.min(d.h, Math.max(d.l, k === n - 1 ? d.c : next));
      const o = px;
      out.push({ date: d.date, t: Math.floor(sessionTimes(d.date).open / 1000) + k * minutes * 60, o, h: Math.max(o, c) * 1.0005, l: Math.min(o, c) * 0.9995, c, v: Math.round((d.v / n) * (0.5 + r())) });
      px = c;
    }
  }
  return out;
}

// ── 배당 (합성) ──
interface DivRec {
  ex: string;
  pay: string;
  declared: string;
  amount: number;
}
function freqOf(symbol: string): number {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!inst) return 0;
  if (inst.category === "income") return 12;
  if (inst.category === "gold" || inst.leverage || ["AMZN", "TSLA"].includes(symbol)) return 0;
  return 4;
}
const SPLIT = { symbol: "SCHD", date: "2024-10-11", ratio: 3 };
function dividends(symbol: string): DivRec[] {
  const f = freqOf(symbol);
  if (!f) return [];
  const bars = dailyBars(symbol);
  const r = rng(hash(`${symbol}#div`));
  const out: DivRec[] = [];
  const yieldPct = f === 12 ? 0.08 : symbol.length <= 4 && INSTRUMENTS.find((i) => i.symbol === symbol)?.kind === "stock" ? 0.006 : 0.025;
  for (let i = 30; i < bars.length; i++) {
    const [, m] = bars[i].date.split("-").map(Number);
    const prev = bars[i - 1].date.slice(5, 7);
    const newMonth = bars[i].date.slice(5, 7) !== prev;
    if (!newMonth) continue;
    if (f === 4 && ![3, 6, 9, 12].includes(m)) continue;
    const ex = bars[i].date;
    const pay = bars[Math.min(bars.length - 1, i + 3)].date;
    out.push({ ex, pay: pay > ex ? pay : addDays(ex, 3), declared: addDays(ex, -7), amount: Number(((bars[i].c * yieldPct) / f * (0.85 + r() * 0.3)).toFixed(4)) });
  }
  // 발표된 미래 분배금 (인컴 ETF)
  if (f === 12) {
    const ex = addDays(LAST, 10);
    out.push({ ex, pay: addDays(ex, 3), declared: addDays(LAST, -1), amount: out[out.length - 1].amount });
  }
  return out;
}

// ── 응답 헬퍼 ──
function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

function quoteOf(symbol: string) {
  const b = dailyBars(symbol);
  const last = b[b.length - 1];
  const prev = b[b.length - 2];
  const avg = b.slice(-63).reduce((a, x) => a + x.v, 0) / 63;
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  return {
    symbol,
    longName: inst?.name ?? MARKET_SYMBOLS.find((m) => m.symbol === symbol)?.nameKo ?? symbol,
    regularMarketPrice: last.c,
    regularMarketChange: last.c - prev.c,
    regularMarketChangePercent: (last.c / prev.c - 1) * 100,
    regularMarketPreviousClose: prev.c,
    regularMarketOpen: last.o,
    regularMarketDayHigh: last.h,
    regularMarketDayLow: last.l,
    regularMarketVolume: last.v,
    averageDailyVolume3Month: Math.round(avg),
    averageDailyVolume10Day: Math.round(b.slice(-10).reduce((a, x) => a + x.v, 0) / 10),
    fiftyTwoWeekHigh: Math.max(...b.slice(-252).map((x) => x.h)),
    fiftyTwoWeekLow: Math.min(...b.slice(-252).map((x) => x.l)),
    marketCap: inst?.kind === "stock" ? last.c * 2.5e10 : undefined,
    trailingPE: inst?.kind === "stock" ? 28.4 : undefined,
    forwardPE: inst?.kind === "stock" ? 24.1 : undefined,
    marketState: "CLOSED",
    fullExchangeName: inst?.exchange ?? "NYSEArca",
    currency: "USD",
    quoteType: inst?.kind === "etf" ? "ETF" : inst ? "EQUITY" : "INDEX",
    regularMarketTime: Math.floor(sessionTimes(last.date).close / 1000),
    exchangeDataDelayedBy: symbol.startsWith("^") ? 15 : 0,
    quoteSourceName: symbol.startsWith("^") ? "Delayed Quote" : "Nasdaq Real Time Price",
  };
}

function chartJson(symbol: string, interval: string, range: string) {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) || baseSpec[symbol];
  if (!inst) return { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } };
  let bars: DBar[];
  if (interval === "1d") {
    bars = dailyBars(symbol);
    if (range === "1y") bars = bars.slice(-252);
    else if (range === "5d") bars = bars.slice(-5);
  } else if (interval === "1wk" || interval === "1mo") {
    const d = dailyBars(symbol);
    const groups = new Map<string, DBar[]>();
    for (const x of d) {
      const key = interval === "1mo" ? x.date.slice(0, 7) : String(Math.floor((x.t / 86400 + 4) / 7));
      groups.set(key, [...(groups.get(key) ?? []), x]);
    }
    bars = [...groups.values()].map((g) => ({ date: g[0].date, t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1].c, v: g.reduce((a, x) => a + x.v, 0) }));
  } else {
    const mins = interval === "60m" ? 60 : Number(interval.replace("m", ""));
    bars = intradayBars(symbol, mins, interval === "1m" ? 5 : interval === "60m" ? 120 : 40);
  }
  const divs = interval === "1d" ? dividends(symbol) : [];
  const events: Record<string, unknown> = {};
  if (divs.length) {
    const first = bars[0].date;
    events.dividends = Object.fromEntries(
      divs.filter((d) => d.ex >= first && d.ex <= LAST).map((d) => [String(Math.floor(etToUtc(d.ex, "09:30") / 1000)), { amount: d.amount, date: Math.floor(etToUtc(d.ex, "09:30") / 1000) }]),
    );
  }
  if (symbol === SPLIT.symbol && interval === "1d") {
    const ts = Math.floor(etToUtc(SPLIT.date, "09:30") / 1000);
    events.splits = { [ts]: { date: ts, numerator: SPLIT.ratio, denominator: 1, splitRatio: `${SPLIT.ratio}:1` } };
  }
  const q = quoteOf(symbol);
  return {
    chart: {
      result: [
        {
          meta: { dataGranularity: interval, currency: "USD", symbol, exchangeName: "PCX", fullExchangeName: q.fullExchangeName, instrumentType: q.quoteType, regularMarketPrice: q.regularMarketPrice, regularMarketTime: q.regularMarketTime, chartPreviousClose: q.regularMarketPreviousClose, longName: q.longName, fiftyTwoWeekHigh: q.fiftyTwoWeekHigh, fiftyTwoWeekLow: q.fiftyTwoWeekLow, regularMarketVolume: q.regularMarketVolume },
          timestamp: bars.map((b) => b.t),
          events,
          indicators: {
            quote: [{ open: bars.map((b) => b.o), high: bars.map((b) => b.h), low: bars.map((b) => b.l), close: bars.map((b) => b.c), volume: bars.map((b) => b.v) }],
            adjclose: interval === "1d" ? [{ adjclose: bars.map((b) => b.c) }] : undefined,
          },
        },
      ],
      error: null,
    },
  };
}

const HOLDINGS: Record<string, [string, string, number][]> = {
  ndx: [["NVDA", "NVIDIA Corp", 0.095], ["MSFT", "Microsoft Corp", 0.085], ["AAPL", "Apple Inc", 0.078], ["AMZN", "Amazon.com Inc", 0.055], ["AVGO", "Broadcom Inc", 0.05], ["META", "Meta Platforms Inc", 0.037], ["GOOGL", "Alphabet Inc Class A", 0.031], ["TSLA", "Tesla Inc", 0.03], ["COST", "Costco Wholesale Corp", 0.025], ["NFLX", "Netflix Inc", 0.024]],
  spx: [["NVDA", "NVIDIA Corp", 0.075], ["MSFT", "Microsoft Corp", 0.068], ["AAPL", "Apple Inc", 0.062], ["AMZN", "Amazon.com Inc", 0.038], ["META", "Meta Platforms Inc", 0.028], ["AVGO", "Broadcom Inc", 0.026], ["GOOGL", "Alphabet Inc Class A", 0.021], ["TSLA", "Tesla Inc", 0.02], ["BRK-B", "Berkshire Hathaway", 0.016], ["JPM", "JPMorgan Chase", 0.015]],
  div: [["JNJ", "Johnson & Johnson", 0.04], ["XOM", "Exxon Mobil", 0.039], ["PG", "Procter & Gamble", 0.035], ["ABBV", "AbbVie", 0.033], ["KO", "Coca-Cola", 0.03]],
  semi: [["NVDA", "NVIDIA Corp", 0.2], ["TSM", "Taiwan Semiconductor", 0.11], ["AVGO", "Broadcom Inc", 0.08], ["AMD", "Advanced Micro Devices", 0.05]],
};

function summaryJson(symbol: string, modules: string[]) {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!inst) return { quoteSummary: { result: null, error: { code: "Not Found", description: "Quote not found" } } };
  const q = quoteOf(symbol);
  const r: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => modules.includes(k) && (r[k] = v);
  set("price", { regularMarketPrice: q.regularMarketPrice, longName: q.longName });
  if (inst.kind === "etf") {
    const key = inst.benchmarks?.includes("^NDX") ? "ndx" : inst.category === "dividend_growth" ? "div" : inst.category === "semis_tech" || symbol === "SOXL" ? "semi" : "spx";
    set("summaryDetail", { totalAssets: 1e9 * (5 + (hash(symbol) % 300)), navPrice: q.regularMarketPrice * 1.0003, yield: inst.category === "income" ? 0.081 : 0.012 });
    set("defaultKeyStatistics", { fundInceptionDate: Math.floor(Date.UTC(2010 + (hash(symbol) % 12), 2, 1) / 1000), beta3Year: inst.leverage ? inst.leverage : 1 });
    set("fundProfile", { family: inst.issuer, categoryName: inst.category === "gold" ? "Commodities Focused" : "Large Blend", feesExpensesInvestment: { annualReportExpenseRatio: (hash(symbol) % 90) / 10000 + 0.0003 } });
    set(
      "topHoldings",
      inst.category === "gold"
        ? { holdings: [], sectorWeightings: [] }
        : { holdings: HOLDINGS[key].map(([s, n, w]) => ({ symbol: s, holdingName: n, holdingPercent: w })), sectorWeightings: [{ technology: 0.48 }, { communication_services: 0.14 }, { consumer_cyclical: 0.12 }, { healthcare: 0.07 }] },
    );
    set("fundPerformance", { trailingReturns: { ytd: 0.12, oneYear: 0.18, threeYear: 0.14, fiveYear: 0.13, tenYear: null }, annualTotalReturns: { returns: [{ year: "2025", annualValue: 0.21 }, { year: "2024", annualValue: 0.25 }] } });
    set("assetProfile", { longBusinessSummary: `SYNTHETIC TEST DESCRIPTION for ${symbol}.` });
  } else {
    set("summaryDetail", { marketCap: q.marketCap, trailingPE: 28.4, forwardPE: 24.1, fiftyTwoWeekHigh: q.fiftyTwoWeekHigh, fiftyTwoWeekLow: q.fiftyTwoWeekLow, averageVolume: q.averageDailyVolume3Month, averageVolume10days: q.averageDailyVolume10Day, dividendRate: 1.04, dividendYield: 0.0045, payoutRatio: 0.15 });
    set("defaultKeyStatistics", { priceToBook: 12.3, trailingEps: 6.5, forwardPE: 24.1, netIncomeToCommon: 9e10 });
    set("financialData", { returnOnEquity: 0.45, revenueGrowth: 0.08, totalRevenue: 3.9e11, operatingCashflow: 1.1e11, freeCashflow: 9e10, operatingMargins: 0.31 });
    set("calendarEvents", { earnings: { earningsDate: [Math.floor(etToUtc(addDays(LAST, 9 + (hash(symbol) % 20)), "16:05") / 1000)] }, exDividendDate: Math.floor(etToUtc(addDays(LAST, -20), "09:30") / 1000) });
    set("assetProfile", { sector: "Technology", industry: "Synthetic Industry", longBusinessSummary: `SYNTHETIC TEST DESCRIPTION for ${symbol}.`, website: "https://example.com", fullTimeEmployees: 100000 });
    set("earnings", { earningsChart: { quarterly: [{ date: "3Q2025", actual: 1.6, estimate: 1.55 }, { date: "4Q2025", actual: 2.1, estimate: 2.0 }] } });
  }
  return { quoteSummary: { result: [r], error: null } };
}

function newsJson(q: string) {
  const sym = q.toUpperCase();
  const isTicker = INSTRUMENTS.some((i) => i.symbol === sym);
  const base = sessionTimes(LAST).close;
  const items = [
    { uuid: `${sym}-1`, title: `[TEST] ${q} synthetic headline about quarterly flows`, publisher: "Test Wire", link: `https://example.com/news/${encodeURIComponent(q)}/1`, providerPublishTime: Math.floor((base + 2 * 3600_000) / 1000), relatedTickers: isTicker ? [sym] : [], thumbnail: { resolutions: [{ url: `http://127.0.0.1:${PORT}/img/news.svg`, width: 280, height: 180, tag: "280x180" }] } },
    { uuid: `${sym}-2`, title: `[TEST] ${q} synthetic headline about quarterly flows update`, publisher: "Other Wire", link: `https://example.org/news/${encodeURIComponent(q)}/2`, providerPublishTime: Math.floor((base + 3 * 3600_000) / 1000), relatedTickers: isTicker ? [sym] : [] },
    { uuid: `${sym}-3`, title: `[TEST] Older ${q} synthetic story from last week`, publisher: "Test Wire", link: `https://example.com/news/${encodeURIComponent(q)}/3`, providerPublishTime: Math.floor((base - 5 * 86400_000) / 1000), relatedTickers: isTicker ? [sym] : [] },
  ];
  return { news: items.filter((n) => n.providerPublishTime * 1000 <= NOW) };
}

function rss(q: string) {
  const base = sessionTimes(LAST).close;
  const items = [1, 2].map(
    (k) => `<item><title>[TEST] ${q.replace(/[<&"]/g, "")} synthetic RSS story ${k} - RSS Test</title><link>https://news.google.com/rss/articles/test-${hash(q)}-${k}</link><pubDate>${new Date(Math.min(NOW, base + k * 3600_000)).toUTCString()}</pubDate><description>desc</description><source url="https://example.net">RSS Test</source></item>`,
  );
  return `<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`;
}

function secFacts(cik: string) {
  const usd: { start?: string; end: string; val: number; form: string; fy: number; fp: string; filed: string }[] = [];
  const ocf: typeof usd = [];
  const eq: typeof usd = [];
  for (let y = 2022; y <= 2025; y++) {
    const s = `${y - 1}-10-01`;
    const qs = [`${y - 1}-12-31`, `${y}-03-31`, `${y}-06-30`];
    const qstarts = [s, `${y}-01-01`, `${y}-04-01`];
    let cum = 0;
    qs.forEach((e, k) => {
      const v = 9e10 + y * 1e8 + k * 2e9;
      usd.push({ start: qstarts[k], end: e, val: v, form: "10-Q", fy: y, fp: `Q${k + 1}`, filed: `${e.slice(0, 4)}-${e.slice(5, 7)}-28` });
      cum += 3e10 + k * 1e9;
      ocf.push({ start: s, end: e, val: cum, form: "10-Q", fy: y, fp: `Q${k + 1}`, filed: `${e.slice(0, 4)}-${e.slice(5, 7)}-28` });
    });
    usd.push({ start: s, end: `${y}-09-30`, val: 4e11 + y * 1e8, form: "10-K", fy: y, fp: "FY", filed: `${y}-11-01` });
    ocf.push({ start: s, end: `${y}-09-30`, val: cum + 3.4e10, form: "10-K", fy: y, fp: "FY", filed: `${y}-11-01` });
    eq.push({ end: `${y}-09-30`, val: 6e10 + y * 1e6, form: "10-K", fy: y, fp: "FY", filed: `${y}-11-01` });
  }
  return {
    cik: Number(cik),
    entityName: `SYNTHETIC TEST ENTITY ${cik}`,
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: usd } },
        OperatingIncomeLoss: { units: { USD: usd.map((x) => ({ ...x, val: x.val * 0.3 })) } },
        NetIncomeLoss: { units: { USD: usd.map((x) => ({ ...x, val: x.val * 0.24 })) } },
        EarningsPerShareDiluted: { units: { "USD/shares": usd.filter((x) => x.form === "10-Q").map((x) => ({ ...x, val: 1.5 })) } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: ocf } },
        PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: ocf.map((x) => ({ ...x, val: x.val * 0.1 })) } },
        StockholdersEquity: { units: { USD: eq } },
      },
    },
  };
}

let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const qp = (k: string) => url.searchParams.get(k) ?? "";
  try {
    if (p === "/__stats") return send(res, 200, { requests });
    // Yahoo
    if (p === "/yahoo-cookie/") return send(res, 404, "not found", { "Set-Cookie": "A3=test-cookie; Path=/; Domain=127.0.0.1" });
    if (p.startsWith("/img/")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180"><rect width="280" height="180" fill="#9ab"/><text x="140" y="100" font-size="28" text-anchor="middle" fill="#fff">TEST IMAGE</text></svg>');
    }
    if (p === "/yahoo2/v1/test/getcrumb") return req.headers.cookie?.includes("A3=") ? send(res, 200, "testcrumb") : send(res, 401, "Unauthorized");
    if (p === "/yahoo1/v7/finance/quote") {
      if (qp("crumb") !== "testcrumb") return send(res, 401, { finance: { error: { code: "Unauthorized" } } });
      const syms = qp("symbols").split(",").filter(Boolean);
      const result = syms.filter((s) => INSTRUMENTS.some((i) => i.symbol === s) || baseSpec[s]).map(quoteOf);
      return send(res, 200, { quoteResponse: { result, error: null } });
    }
    const chartM = p.match(/^\/yahoo1\/v8\/finance\/chart\/(.+)$/);
    if (chartM) {
      // 실제 Yahoo 처럼 range=max 일봉·주봉 요청에는 월봉으로 줄여 응답 (사이트가 이 방식을 쓰지 않는지 확인용)
      const iv = qp("interval");
      const g = qp("range") === "max" && (iv === "1d" || iv === "1wk") ? "1mo" : iv;
      return send(res, 200, chartJson(decodeURIComponent(chartM[1]), g, qp("range")));
    }
    const sumM = p.match(/^\/yahoo2\/v10\/finance\/quoteSummary\/(.+)$/);
    if (sumM) return send(res, 200, summaryJson(decodeURIComponent(sumM[1]), qp("modules").split(",")));
    if (p === "/yahoo2/v1/finance/search") return send(res, 200, newsJson(qp("q")));
    // Nasdaq
    const nq = p.match(/^\/nasdaq\/api\/quote\/(.+)\/dividends$/);
    if (nq) {
      const sym = decodeURIComponent(nq[1]);
      const rows = dividends(sym).map((d) => {
        const raw = sym === SPLIT.symbol && d.ex < SPLIT.date ? d.amount * SPLIT.ratio : d.amount;
        const mdy = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`;
        return { exOrEffDate: mdy(d.ex), type: "Cash", amount: `$${raw.toFixed(4)}`, declarationDate: mdy(d.declared), recordDate: mdy(d.ex), paymentDate: mdy(d.pay), currency: "USD" };
      });
      return send(res, 200, { data: { dividends: { rows: rows.reverse() } }, status: { rCode: 200 } });
    }
    // Google News
    if (p === "/gnews/rss/search") return send(res, 200, rss(qp("q").replace(/ when:\d+d$/, "")), { "Content-Type": "application/rss+xml" });
    // Finnhub
    if (p.startsWith("/finnhub/")) {
      if (qp("token") !== "test-key") return send(res, 401, { error: "Invalid API key" });
      const base = Math.floor(sessionTimes(LAST).close / 1000);
      if (p === "/finnhub/company-news") {
        const s = qp("symbol");
        return send(res, 200, [{ category: "company", datetime: base + 1800, headline: `[TEST] ${s} synthetic company news with provider summary`, id: 1, related: s, source: "Finnhub Test", summary: `Synthetic summary text for ${s}. Not real news.`, url: `https://example.com/fh/${s}` }]);
      }
      if (p === "/finnhub/news") return send(res, 200, [{ category: "general", datetime: base + 600, headline: "[TEST] Synthetic market wrap headline", id: 2, related: "", source: "Finnhub Test", summary: "Synthetic market summary. Not real news.", url: "https://example.com/fh/market" }]);
      if (p === "/finnhub/calendar/earnings") {
        return send(res, 200, {
          earningsCalendar: [
            { date: LAST, symbol: "AAPL", hour: "amc", epsActual: 1.65, epsEstimate: 1.6, quarter: 4, year: 2026, revenueActual: null, revenueEstimate: null },
            { date: addDays(LAST, 5), symbol: "NVDA", hour: "amc", epsActual: null, epsEstimate: 1.1, quarter: 3, year: 2027 },
            { date: addDays(LAST, 6), symbol: "AVGO", hour: "amc", epsActual: null, epsEstimate: 1.9, quarter: 4, year: 2026 },
            { date: addDays(LAST, 7), symbol: "ZZZZ", hour: "bmo", epsActual: null, epsEstimate: 0.1, quarter: 1, year: 2026 },
          ],
        });
      }
      if (p === "/finnhub/stock/metric") return send(res, 200, { metric: { peTTM: 30.1, roeTTM: 40.2, "52WeekHigh": 1, "52WeekLow": 0.5 } });
      if (p === "/finnhub/quote") return send(res, 200, { c: 1, d: 0, dp: 0, h: 1, l: 1, o: 1, pc: 1, t: base });
    }
    // FRED
    if (p === "/fred/fred/series/observations") {
      const obs = days.slice(-30).map((d, i) => ({ date: d, value: qp("series_id") === "DGS10" ? (4.1 + i * 0.01).toFixed(2) : qp("series_id") === "DGS2" ? (3.6 + i * 0.005).toFixed(2) : (120 + i * 0.1).toFixed(2) }));
      return send(res, 200, { observations: obs.reverse() });
    }
    if (p === "/fred/fred/releases/dates") {
      return send(res, 200, {
        release_dates: [
          { release_id: 10, release_name: "Consumer Price Index", date: addDays(LAST, 2) },
          { release_id: 50, release_name: "Employment Situation", date: addDays(LAST, 4) },
          { release_id: 999, release_name: "Some Minor Release", date: addDays(LAST, 1) },
        ],
      });
    }
    // SEC
    const sec = p.match(/^\/sec\/api\/xbrl\/companyfacts\/CIK(\d+)\.json$/);
    if (sec) return req.headers["user-agent"] ? send(res, 200, secFacts(sec[1])) : send(res, 403, "UA required");
    return send(res, 404, { error: "mock: unknown path", path: p });
  } catch (e) {
    return send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-upstream] 테스트용 합성 데이터 서버 http://127.0.0.1:${PORT} (마지막 거래일 ${LAST}, ${etDate()})`));
