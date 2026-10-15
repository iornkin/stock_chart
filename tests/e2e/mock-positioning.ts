/**
 * ⚠ 테스트 전용 가짜(모의) 포지션·심리 응답 ⚠ — mock-upstream 에서 불러 쓴다.
 * FINRA·Cboe·AAII·Nasdaq 옵션 체인·SEC 13F 의 '응답 형식'만 흉내 낸 합성 데이터이며 실제 값이 아니다.
 * 13F 가치는 모의 서버 자신의 종가 × 수량으로 만들어 앱의 가격 대조 검사가 통과하게 한다.
 */
import type http from "node:http";
import { INSTRUMENTS } from "@/config/instruments";
import { CUSIPS } from "@/config/positioning";
import { isTradingDay } from "@/lib/market-calendar";
import { addDays } from "@/lib/time";

interface Ctx {
  LAST: string;
  days: string[];
  close: (symbol: string, date: string) => number | null;
  send: (res: http.ServerResponse, status: number, body: unknown, headers?: Record<string, string>) => void;
  hash: (s: string) => number;
}

/** 모의 13F 를 내는 기관 (나머지 CIK 는 일반 공시 목록만) */
export const MOCK_13F_CIKS = [1067983, 2012383, 895421];
const MOCK_13F_NAMES: Record<number, string> = { 1067983: "[TEST] BERKSHIRE HATHAWAY INC", 2012383: "[TEST] BlackRock, Inc.", 895421: "[TEST] MORGAN STANLEY" };

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function quarterEnds(LAST: string): [string, string] {
  // 제출(분기 말 + 40일)이 LAST 이전인 가장 최근 두 분기 말
  const ends: string[] = [];
  for (let y = Number(LAST.slice(0, 4)); y >= Number(LAST.slice(0, 4)) - 2; y--) for (const md of ["12-31", "09-30", "06-30", "03-31"]) ends.push(`${y}-${md}`);
  const ok = ends.filter((e) => addDays(e, 40) <= LAST);
  return [ok[1], ok[0]];
}

function lastTradingOnOrBefore(d: string): string {
  let x = d;
  while (!isTradingDay(x)) x = addDays(x, -1);
  return x;
}

function settlementDates(LAST: string): string[] {
  const out: string[] = [];
  const cutoff = addDays(LAST, -10);
  for (let k = 0; k < 15; k++) {
    const dt = new Date(Date.parse(`${LAST.slice(0, 7)}-01T00:00:00Z`));
    dt.setUTCMonth(dt.getUTCMonth() - k);
    const ym = dt.toISOString().slice(0, 7);
    const mid = lastTradingOnOrBefore(`${ym}-15`);
    const endDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    for (const d of [lastTradingOnOrBefore(endDay), mid]) if (d <= cutoff && d >= addDays(LAST, -400)) out.push(d);
  }
  return [...new Set(out)].sort();
}

function infoTable(cik: number, period: string, ctx: Ctx, extraQqq = false): string {
  const px = lastTradingOnOrBefore(period);
  const late = period === quarterEnds(ctx.LAST)[1];
  // 기간별 보유 수량 (늘림·줄임·새로 보고·목록에서 빠짐을 모두 만든다)
  const plan: [string, number | null][] = extraQqq
    ? [["QQQ", 50_000]]
    : [
        ["AAPL", late ? 900_000 : 1_000_000],
        ["MSFT", late ? 300_000 : null],
        ["NVDA", late ? null : 400_000],
        ["SPY", 200_000 + (cik % 7) * 1000],
        ["JEPI", late ? 120_000 : 100_000],
      ];
  const rows: string[] = [];
  for (const [sym, sh] of plan) {
    if (!sh) continue;
    const c = ctx.close(sym, px);
    if (!c) continue;
    rows.push(`<infoTable><nameOfIssuer>[TEST] ${sym} ISSUER</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${CUSIPS[sym]}</cusip><value>${Math.round(sh * c)}</value><shrsOrPrnAmt><sshPrnamt>${sh}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion></infoTable>`);
  }
  if (!extraQqq) {
    // 옵션 행 (기초자산 수량) — 주식 보유와 따로 집계돼야 한다
    rows.push(`<infoTable><nameOfIssuer>[TEST] AAPL ISSUER</nameOfIssuer><titleOfClass>PUT</titleOfClass><cusip>${CUSIPS.AAPL}</cusip><value>1000000</value><shrsOrPrnAmt><sshPrnamt>5000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>Put</putCall><investmentDiscretion>SOLE</investmentDiscretion></infoTable>`);
    rows.push(`<infoTable><nameOfIssuer>[TEST] OTHER HOLDING CORP</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>99999T105</cusip><value>${late ? 2_000_000_000 : 1_500_000_000}</value><shrsOrPrnAmt><sshPrnamt>10000000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion></infoTable>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${rows.join("")}</informationTable>`;
}

function filingsFor(cik: number, LAST: string) {
  const [p0, p1] = quarterEnds(LAST);
  const f = [
    { form: "13F-HR", period: p1, filed: addDays(p1, 40), acc: `0000${cik}-90-000002` },
    { form: "13F-HR", period: p0, filed: addDays(p0, 40), acc: `0000${cik}-90-000001` },
  ];
  // Morgan Stanley(모의)는 최근 분기에 '추가 보고' 정정 공시 (QQQ 보유를 나중에 보고)
  if (cik === 895421) f.unshift({ form: "13F-HR/A", period: p1, filed: addDays(p1, 42), acc: `0000${cik}-90-000003` });
  return f;
}

function optionChain(sym: string, LAST: string, hash: (s: string) => number) {
  if (sym === "GLDM") return { data: { totalRecord: 0, lastTrade: null, table: { rows: [] } }, message: "Options are not available for this symbol", status: { rCode: 200 } };
  const h = hash(`${sym}#opt#${LAST}`);
  const rows: Record<string, unknown>[] = [];
  for (let e = 0; e < 3; e++) {
    rows.push({ expirygroup: `[TEST] Expiry ${e + 1}`, strike: null, c_Volume: null, p_Volume: null, c_Openinterest: null, p_Openinterest: null });
    for (let k = 0; k < 5; k++) {
      const v = (h >>> (e * 3 + k)) % 997;
      rows.push({ expirygroup: "", expiryDate: "TEST", strike: `${100 + k * 5}.00`, c_Volume: String(1000 + v * 3), p_Volume: k === 0 ? "--" : String(800 + v * 2), c_Openinterest: (5000 + v * 10).toLocaleString("en-US"), p_Openinterest: String(4000 + v * 9) });
    }
  }
  const [y, m, d] = LAST.split("-");
  return { data: { totalRecord: rows.length, lastTrade: `LAST TRADE: $100.00 (AS OF ${MON[Number(m) - 1]} ${Number(d)}, ${y})`, table: { rows } }, status: { rCode: 200 } };
}

function aaiiWeeks(LAST: string, n: number) {
  // 설문 마감 = 수요일 (LAST 이전 가장 최근 수요일부터)
  let d = LAST;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 3) d = addDays(d, -1);
  const out: { week: string; b: number; n: number; br: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = 30 + ((i * 7) % 15) + 0.4;
    const nn = 25 + ((i * 3) % 10) + 0.3;
    out.push({ week: d, b, n: nn, br: Math.round((100 - b - nn) * 10) / 10 });
    d = addDays(d, -7);
  }
  return out;
}

export function positioningRoute(req: http.IncomingMessage, res: http.ServerResponse, p: string, ctx: Ctx): boolean {
  const { LAST, send } = ctx;
  // ── FINRA 공매도 잔고 (POST) ──
  if (p === "/finra-api/data/group/otcMarket/name/consolidatedShortInterest") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const q = JSON.parse(body || "{}");
        const symbols: string[] = q.domainFilters?.[0]?.values ?? [];
        const start: string = q.dateRangeFilters?.[0]?.startDate ?? "2000-01-01";
        const end: string = q.dateRangeFilters?.[0]?.endDate ?? "2100-01-01";
        const rows: Record<string, unknown>[] = [];
        for (const s of symbols) {
          let prev: number | null = null;
          for (const d of settlementDates(LAST)) {
            const qty = 1_000_000 + (ctx.hash(`${s}#si#${d}`) % 9_000_000);
            if (d >= start && d <= end) rows.push({ symbolCode: s, settlementDate: d, issueName: `[TEST] ${s}`, currentShortPositionQuantity: qty, previousShortPositionQuantity: prev, averageDailyVolumeQuantity: 2_000_000 + (ctx.hash(`${s}#adv`) % 5_000_000), daysToCoverQuantity: 1, changePercent: 0, revisionFlag: null, stockSplitFlag: null });
            prev = qty;
          }
        }
        const off = Number(q.offset ?? 0);
        const lim = Number(q.limit ?? 5000);
        send(res, 200, rows.slice(off, off + lim), { "record-total": String(rows.length) });
      } catch (e) {
        send(res, 400, { error: String(e) });
      }
    });
    return true;
  }
  // ── FINRA 일일 공매도 거래량 파일 ──
  const sv = p.match(/^\/finra-cdn\/equity\/regsho\/daily\/CNMSshvol(\d{8})\.txt$/);
  if (sv) {
    const d = `${sv[1].slice(0, 4)}-${sv[1].slice(4, 6)}-${sv[1].slice(6, 8)}`;
    if (!isTradingDay(d) || d > LAST) {
      send(res, 403, "<Error>AccessDenied</Error>");
      return true;
    }
    const lines = ["Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market"];
    for (const i of INSTRUMENTS) {
      const total = 1_000_000 + (ctx.hash(`${i.symbol}#tv#${d}`) % 4_000_000);
      const short = Math.round(total * (0.35 + (ctx.hash(`${i.symbol}#sr#${d}`) % 300) / 1000));
      lines.push(`${sv[1]}|${i.symbol}|${short}.250000|${ctx.hash(i.symbol) % 1000}|${total}.500000|B,Q,N`);
    }
    lines.push(String(INSTRUMENTS.length));
    send(res, 200, lines.join("\n"));
    return true;
  }
  // ── Cboe 일일 옵션 통계 ──
  const cb = p.match(/^\/cboe-cdn\/data\/us\/options\/market_statistics\/daily\/(\d{4}-\d{2}-\d{2})_daily_options$/);
  if (cb) {
    const d = cb[1];
    if (!isTradingDay(d) || d > LAST) {
      send(res, 403, "<Error>AccessDenied</Error>");
      return true;
    }
    const mk = (seed: string, base: number) => {
      const call = base + (ctx.hash(`${seed}c${d}`) % base);
      const put = Math.round(call * (0.5 + (ctx.hash(`${seed}p${d}`) % 700) / 1000));
      return { call, put, coi: call * 40, poi: put * 35 };
    };
    const sec = { "SUM OF ALL PRODUCTS": mk("t", 8_000_000), "INDEX OPTIONS": mk("i", 3_000_000), "EXCHANGE TRADED PRODUCTS": mk("e", 2_000_000), "EQUITY OPTIONS": mk("q", 3_000_000), "CBOE VOLATILITY INDEX (VIX)": mk("v", 500_000), "SPX + SPXW": mk("s", 2_000_000) };
    const ratioName: Record<string, string> = { "SUM OF ALL PRODUCTS": "TOTAL PUT/CALL RATIO", "INDEX OPTIONS": "INDEX PUT/CALL RATIO", "EXCHANGE TRADED PRODUCTS": "EXCHANGE TRADED PRODUCTS PUT/CALL RATIO", "EQUITY OPTIONS": "EQUITY PUT/CALL RATIO", "CBOE VOLATILITY INDEX (VIX)": "CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO", "SPX + SPXW": "SPX + SPXW PUT/CALL RATIO" };
    const out: Record<string, unknown> = { ratios: Object.entries(sec).map(([k, v]) => ({ name: ratioName[k], value: (v.put / v.call).toFixed(2) })) };
    for (const [k, v] of Object.entries(sec)) out[k] = [{ name: "VOLUME", call: v.call, put: v.put, total: v.call + v.put }, { name: "OPEN INTEREST", call: v.coi, put: v.poi, total: v.coi + v.poi }];
    send(res, 200, out);
    return true;
  }
  // ── AAII 설문 페이지 ──
  if (p === "/aaii/sentimentsurvey") {
    const w = aaiiWeeks(LAST, 4);
    const fmt = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
    const rows = w.map((x) => `<tr><td>${fmt(x.week)}</td><td>${x.b.toFixed(1)}%</td><td>${x.n.toFixed(1)}%</td><td>${x.br.toFixed(1)}%</td></tr>`).join("");
    send(res, 200, `<html><body><h1>[TEST] Sentiment Survey</h1><h2>Recent weekly results</h2><table><tr><th>Week Ending</th><th>Sentiment Votes</th></tr><tr><th>Bullish</th><th>Neutral</th><th>Bearish</th></tr>${rows}</table><p>Historical view</p><table><tr><td>Historical Averages</td><td>37.5%</td><td>31.0%</td><td>31.5%</td></tr></table></body></html>`, { "Content-Type": "text/html" });
    return true;
  }
  if (p === "/aaii/sentimentsurvey/sent_results") {
    const w = aaiiWeeks(LAST, 12);
    const rows = w.map((x) => `<tr><td>${MON3[Number(x.week.slice(5, 7)) - 1]} ${Number(x.week.slice(8, 10))}</td><td>${x.b.toFixed(1)}%</td><td>${x.n.toFixed(1)}%</td><td>${x.br.toFixed(1)}%</td></tr>`).join("");
    send(res, 200, `<html><body><table><tr><th>Reported Date</th><th>Bullish</th><th>Neutral</th><th>Bearish</th></tr>${rows}</table></body></html>`, { "Content-Type": "text/html" });
    return true;
  }
  // ── Nasdaq 옵션 체인 ──
  const oc = p.match(/^\/nasdaq\/api\/quote\/(.+)\/option-chain$/);
  if (oc) {
    send(res, 200, optionChain(decodeURIComponent(oc[1]).toUpperCase(), LAST, ctx.hash));
    return true;
  }
  // ── SEC 13F (기관 제출 목록은 mock-upstream 의 submissions 에서, 문서는 여기서) ──
  const doc = p.match(/^\/secwww\/Archives\/edgar\/data\/(\d+)\/(\d+)\/(index\.json|primary_doc\.xml|infotable\.xml)$/);
  if (doc) {
    if (!req.headers["user-agent"]) {
      send(res, 403, "UA required");
      return true;
    }
    const cik = Number(doc[1]);
    const f = filingsFor(cik, LAST).find((x) => x.acc.replace(/-/g, "") === doc[2]);
    if (!f) {
      send(res, 404, "not found");
      return true;
    }
    if (doc[3] === "index.json") send(res, 200, { directory: { item: [{ name: "primary_doc.xml" }, { name: "infotable.xml" }] } });
    else if (doc[3] === "primary_doc.xml") {
      const [y, m, d] = f.period.split("-");
      const amend = f.form === "13F-HR/A";
      send(res, 200, `<edgarSubmission><headerData><filerInfo><periodOfReport>${m}-${d}-${y}</periodOfReport></filerInfo></headerData><formData><coverPage><reportCalendarOrQuarter>${m}-${d}-${y}</reportCalendarOrQuarter><isAmendment>${amend}</isAmendment>${amend ? "<amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo>" : ""}</coverPage><summaryPage><tableEntryTotal>7</tableEntryTotal><tableValueTotal>3500000000</tableValueTotal></summaryPage></formData></edgarSubmission>`, { "Content-Type": "application/xml" });
    } else send(res, 200, infoTable(cik, f.period, ctx, f.form === "13F-HR/A"), { "Content-Type": "application/xml" });
    return true;
  }
  return false;
}

/** 모의 13F 기관의 submissions 응답 (해당 CIK 가 아니면 null) */
export function mock13fSubmissions(cik: number, LAST: string) {
  if (!MOCK_13F_CIKS.includes(cik)) return null;
  const f = filingsFor(cik, LAST);
  return { cik: String(cik), name: MOCK_13F_NAMES[cik], filings: { recent: { form: f.map((x) => x.form), filingDate: f.map((x) => x.filed), reportDate: f.map((x) => x.period), accessionNumber: f.map((x) => x.acc), primaryDocument: f.map(() => "primary_doc.xml"), primaryDocDescription: f.map(() => "") } } };
}
