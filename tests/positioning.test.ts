/**
 * 포지션·심리 계산·파서·저장 검증
 * ⚠ 이 파일의 숫자·HTML·XML 은 모두 테스트 전용으로 직접 만든 고정 자료이며 실제 시장 데이터가 아니다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  ageDays,
  composePeriod,
  cusipValid,
  describeAmendments,
  thousandsCorrection,
  holdingChange,
  impliedPriceCheck,
  isStale,
  percentileOf,
  publishedRatioConsistent,
  putCallSummary,
  ratio,
  sentimentSummary,
  sentimentValid,
  shortInterestSummary,
  shortVolumeSummary,
  valueInDollars,
  type FilingRef,
} from "@/lib/positioning";
import { CUSIPS } from "@/config/positioning";
import { parseShortInterest, parseShortVolumeFile } from "@/lib/providers/finra";
import { parseCboeDaily } from "@/lib/providers/cboe";
import { parseResultsPage, parseSurveyPage } from "@/lib/providers/aaii";
import { parseOptionChain } from "@/lib/providers/nasdaq";
import { parse13fCover, parse13fInfoTable } from "@/lib/providers/sec";
import { ProviderError } from "@/lib/http";

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usi-pos-"));
  process.env.DATABASE_PATH = path.join(dir, "t.db");
});

const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("투자심리 설문 (강세·중립·약세)", () => {
  it("세 비율 합계 100 ± 0.5 만 유효, 범위 밖·숫자 아님은 무효", () => {
    expect(sentimentValid({ week: "2026-10-14", bullish: 38.7, neutral: 19.7, bearish: 41.6 }).ok).toBe(true);
    expect(sentimentValid({ week: "w", bullish: 33.4, neutral: 33.3, bearish: 33.4 }).ok).toBe(true); // 100.1 반올림 오차
    expect(sentimentValid({ week: "w", bullish: 50, neutral: 30, bearish: 30 }).ok).toBe(false);
    expect(sentimentValid({ week: "w", bullish: -1, neutral: 51, bearish: 50 }).ok).toBe(false);
    expect(sentimentValid({ week: "w", bullish: Number.NaN, neutral: 50, bearish: 50 }).ok).toBe(false);
  });

  it("강세−약세·장기 평균 대비·8주 평균, 무효한 주는 빼고 따로 보고", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ week: `2026-08-${String(5 + i * 3).padStart(2, "0")}`, bullish: 40, neutral: 30, bearish: 30 }));
    rows.push({ week: "2026-09-30", bullish: 70, neutral: 30, bearish: 30 }); // 합계 130 → 무효
    const s = sentimentSummary(rows, { bullish: 37.5, neutral: 31, bearish: 31.5 });
    expect(s.latest?.week).toBe("2026-08-29");
    expect(s.latest?.spread).toBe(10);
    expect(s.vsAverage?.bullish).toBeCloseTo(2.5);
    expect(s.vsAverage?.bearish).toBeCloseTo(-1.5);
    expect(s.spreadAvg8).toBe(10);
    expect(s.invalid.map((x) => x.week)).toEqual(["2026-09-30"]);
    expect(sentimentSummary(rows.slice(0, 7), null).spreadAvg8).toBeNull(); // 8주 미만
    expect(sentimentSummary([], null).latest).toBeNull();
  });
});

describe("분모가 0 이거나 값이 이상할 때", () => {
  it("ratio: 분모 0·음수·NaN 은 null (0 으로 채우지 않음)", () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(5, -1)).toBeNull();
    expect(ratio(Number.NaN, 2)).toBeNull();
    expect(ratio(-1, 2)).toBeNull();
    expect(ratio(null, 2)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
  it("풋/콜: 콜이 0 이면 거래량 비율 없음, 미결제약정 비율은 따로", () => {
    const s = putCallSummary([{ date: "2026-10-14", callVolume: 0, putVolume: 100, callOI: 200, putOI: 100 }]);
    expect(s.latest?.volumeRatio).toBeNull();
    expect(s.latest?.oiRatio).toBe(0.5);
  });
  it("공매도: 평균 거래량·유통주식 수가 없거나 0 이면 Days to Cover·유통 대비 비율을 만들지 않음", () => {
    const s = shortInterestSummary([{ date: "2026-09-30", shortQty: 1000, prevQty: 800, avgDailyVolume: null, revised: false, split: false }], 0, NOW);
    expect(s.daysToCover).toBeNull();
    expect(s.pctFloat).toBeNull();
    expect(shortInterestSummary([{ date: "2026-09-30", shortQty: 0, prevQty: 0, avgDailyVolume: 10, revised: false, split: false }], 1000, NOW).pctFloat).toBe(0);
  });
  it("공매도 거래 비중: 전체 거래량 0 인 날은 비율 없음, 평균에서 제외", () => {
    const s = shortVolumeSummary([
      { date: "2026-10-13", shortVolume: 0, totalVolume: 0 },
      ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-0${i + 1}`, shortVolume: 40, totalVolume: 100 })),
    ]);
    expect(s.latest?.ratioPct).toBeNull();
    expect(s.avg20).toBe(40);
    expect(s.samples).toBe(5);
  });
});

describe("공매도 잔고 계산", () => {
  const pts = [
    { date: "2026-09-15", shortQty: 100, prevQty: 90, avgDailyVolume: 50, revised: false, split: false },
    { date: "2026-09-30", shortQty: 120, prevQty: 100, avgDailyVolume: 40, revised: true, split: false },
  ];
  it("직전 보고 대비 변화·Days to Cover = 잔고 ÷ 평균 일일 거래량·유통 대비 %", () => {
    const s = shortInterestSummary(pts, 2400, NOW);
    expect(s.previousQty).toBe(100);
    expect(s.change).toBe(20);
    expect(s.changePct).toBeCloseTo(20);
    expect(s.daysToCover).toBe(3);
    expect(s.pctFloat).toBeCloseTo(5);
    expect(s.ageDays).toBe(15);
  });
  it("기록이 하나뿐이면 FINRA 가 준 직전 수량으로 비교, 분할 주기는 비교 안 함", () => {
    expect(shortInterestSummary([pts[0]], null, NOW).change).toBe(10);
    const sp = shortInterestSummary([pts[0], { ...pts[1], split: true }], null, NOW);
    expect(sp.change).toBeNull();
    expect(sp.splitNote).toBe(true);
  });
});

describe("풋/콜 비율 기준", () => {
  it("거래량 기준 = 풋 거래량 ÷ 콜 거래량, 미결제약정 기준 = 풋 OI ÷ 콜 OI (서로 다른 값)", () => {
    const s = putCallSummary([{ date: "2026-10-14", callVolume: 2000, putVolume: 1500, callOI: 10000, putOI: 12000 }]);
    expect(s.latest?.volumeRatio).toBe(0.75);
    expect(s.latest?.oiRatio).toBe(1.2);
  });
  it("평균은 5일 이상, 위치(백분위)는 20일 이상 쌓여야 계산", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, callVolume: 100, putVolume: 50 + i, callOI: 1, putOI: 1 }));
    expect(putCallSummary(pts(4)).volumeAvg20).toBeNull();
    expect(putCallSummary(pts(19)).volumePercentile).toBeNull();
    expect(putCallSummary(pts(20)).volumePercentile).toBe(100);
    expect(percentileOf(1, [1, 2, 3])).toBeNull();
  });
  it("Cboe 공표 비율(둘째 자리)과 직접 계산값 대조", () => {
    expect(publishedRatioConsistent(7998416 / 9084651, 0.88)).toBe(true);
    expect(publishedRatioConsistent(0.9, 0.88)).toBe(false);
    expect(publishedRatioConsistent(null, 0.88)).toBeNull();
  });
});

describe("기관 13F 보유 변화", () => {
  it("상태: 새로 보고·늘림·줄임·같음·목록에서 빠짐, 직전 공시 자료가 없으면 비교 안 함", () => {
    expect(holdingChange(100, null, true).status).toBe("new");
    expect(holdingChange(150, 100, true)).toEqual({ status: "increased", change: 50, changePct: 50 });
    expect(holdingChange(80, 100, true).changePct).toBeCloseTo(-20);
    expect(holdingChange(100, 100, true).status).toBe("unchanged");
    expect(holdingChange(null, 100, true)).toEqual({ status: "exited", change: -100, changePct: -100 });
    expect(holdingChange(100, null, false)).toEqual({ status: "none", change: null, changePct: null });
  });

  const F = (accession: string, form: string, filed: string, amendmentType: string | null = null): FilingRef => ({ accession, form, period: "2026-06-30", filed, amendmentType });
  const row = (accession: string, cusip: string, shares: number, putCall = "") => ({ accession, cusip, putCall, shares, value: shares * 10 });

  it("정정 공시: '추가 보고'는 더하고, '전체 대체'는 원 공시를 대신하고, 종류를 모르는 정정은 반영하지 않음", () => {
    const orig = F("a1", "13F-HR", "2026-08-14");
    const addl = F("a2", "13F-HR/A", "2026-08-20", "NEW HOLDINGS");
    const rows = [row("a1", "037833100", 100), row("a2", "46090E103", 50), row("a1", "037833100", 5, "PUT")];
    const c = composePeriod([orig, addl], rows);
    expect(c.base?.accession).toBe("a1");
    expect(c.holdings.get("037833100|")?.shares).toBe(100);
    expect(c.holdings.get("46090E103|")?.shares).toBe(50);
    expect(c.holdings.get("037833100|PUT")?.shares).toBe(5); // 옵션 행은 주식과 따로

    const restate = F("a3", "13F-HR/A", "2026-09-01", "RESTATEMENT");
    const c2 = composePeriod([orig, addl, restate], [...rows, row("a3", "037833100", 90)]);
    expect(c2.base?.accession).toBe("a3");
    expect(c2.holdings.get("037833100|")?.shares).toBe(90);
    expect(c2.holdings.has("46090E103|")).toBe(false); // 대체 이전의 추가 보고는 반영 안 함

    const unknown = F("a4", "13F-HR/A", "2026-09-05", null);
    const c3 = composePeriod([orig, unknown], [row("a1", "037833100", 100), row("a4", "037833100", 999)]);
    expect(c3.holdings.get("037833100|")?.shares).toBe(100);
    expect(c3.others.map((f) => f.accession)).toEqual(["a4"]);
  });

  it("정정 공시 반영 내용을 문장으로 (전체 대체 기준·추가 보고 반영·대체된 원 공시·종류 불명)", () => {
    const orig = F("a1", "13F-HR", "2026-08-07");
    const restate = F("a2", "13F-HR/A", "2026-09-22", "RESTATEMENT");
    const addl = F("a3", "13F-HR/A", "2026-09-25", "NEW HOLDINGS");
    const unknown = F("a4", "13F-HR/A", "2026-09-30", null);
    const notes = describeAmendments(composePeriod([orig, restate, addl, unknown], []));
    expect(notes).toEqual(["전체 대체 정정(제출 2026-09-22)을 기준으로 씀", "추가 보고 정정(제출 2026-09-25) 반영", "이전 공시(제출 2026-08-07)는 정정 공시로 대체됨", "종류를 알 수 없는 정정(제출 2026-09-30)은 반영 안 함"]);
    expect(describeAmendments(composePeriod([orig], []))).toEqual([]);
  });

  it("천 달러 단위로 잘못 보고한 13F 를 기말 가격 중앙값으로 찾아 보정", () => {
    // 실제 사례 유형: 2026년 제출인데 가치가 천 달러 단위 (주당 0.2달러처럼 보임)
    expect(thousandsCorrection([{ value: 637, shares: 3186306 }, { value: 118, shares: 589680 }, { value: 70, shares: 3102880 }]).factor).toBe(1000);
    expect(thousandsCorrection([{ value: 289.36e6, shares: 1e6 }, { value: 31.7e6, shares: 1e6 }, { value: 5e6, shares: 1e6 }]).factor).toBe(1);
    expect(thousandsCorrection([{ value: 1, shares: 100 }]).factor).toBe(1); // 표본 3개 미만이면 판단 안 함
  });

  it("신고 가치 단위(2023-01-03 이전 천 달러)·가격 대조", () => {
    expect(valueInDollars(5, "2022-11-14")).toBe(5000);
    expect(valueInDollars(5, "2023-02-14")).toBe(5);
    expect(impliedPriceCheck(28936, 100, 289.36).ok).toBe(true);
    expect(impliedPriceCheck(28936000, 100, 289.36).ok).toBe(false); // 단위 오류
    expect(impliedPriceCheck(28936, 100, null).ok).toBeNull();
  });

  it("설정의 CUSIP 은 모두 검사 숫자가 맞고, 한 티커에 하나씩", () => {
    for (const [s, c] of Object.entries(CUSIPS)) expect(cusipValid(c), s).toBe(true);
    expect(new Set(Object.values(CUSIPS)).size).toBe(Object.keys(CUSIPS).length);
    expect(cusipValid("037833101")).toBe(false);
    expect(CUSIPS.SPXL).toBeUndefined(); // 확인하지 못한 종목은 넣지 않음
  });
});

describe("오래된 데이터", () => {
  it("기준일부터 지난 일수와 기준 초과 여부", () => {
    expect(ageDays("2026-10-01", NOW)).toBe(14);
    expect(isStale("2026-10-01", NOW, 14)).toBe(false);
    expect(isStale("2026-09-30", NOW, 14)).toBe(true);
    expect(isStale(null, NOW, 14)).toBe(true);
    expect(ageDays("not-a-date", NOW)).toBeNull();
  });
});

describe("파서: 형식 확인·잘못된 값 제외", () => {
  it("FINRA 공매도 잔고: 수량 음수·숫자 아님·날짜 없음은 버리고, 평균 거래량 0 은 '없음'", () => {
    const rows = parseShortInterest([
      { symbolCode: "aapl", settlementDate: "2026-09-30", currentShortPositionQuantity: 120763539, previousShortPositionQuantity: 128753092, averageDailyVolumeQuantity: 0, daysToCoverQuantity: 0, changePercent: -6.2, revisionFlag: "R", stockSplitFlag: null },
      { symbolCode: "BAD", settlementDate: "2026-09-30", currentShortPositionQuantity: -5 },
      { symbolCode: "BAD2", settlementDate: "x", currentShortPositionQuantity: 5 },
      { symbolCode: "BAD3", settlementDate: "2026-09-30", currentShortPositionQuantity: "abc" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "AAPL", shortQty: 120763539, avgDailyVolume: null, daysToCoverReported: null, revised: true, split: false });
    expect(() => parseShortInterest({ error: "x" })).toThrow(ProviderError);
  });

  it("FINRA 공매도 거래량 파일: 머리글 확인, 공매도 > 전체 등 이상한 행 제외, 원하는 종목만", () => {
    const text = ["Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market", "20261014|AAPL|9631783.5|35528|16757126.5|B,Q,N", "20261014|QQQ|200|0|100|Q", "20261014|SPY|abc|0|100|Q", "20261014|ZZZZ|1|0|2|Q", "4"].join("\n");
    const p = parseShortVolumeFile(text, new Set(["AAPL", "QQQ", "SPY"]));
    expect(p.date).toBe("2026-10-14");
    expect(p.declared).toBe(4);
    expect(p.rows.map((r) => r.symbol)).toEqual(["AAPL"]);
    expect(p.rows[0].shortVolume / p.rows[0].totalVolume).toBeCloseTo(0.5748, 3);
    expect(() => parseShortVolumeFile("<html>error</html>")).toThrow(ProviderError);
  });

  it("Cboe: 상품군별 콜·풋 거래량·미결제약정과 공표 비율", () => {
    const r = parseCboeDaily({
      ratios: [{ name: "TOTAL PUT/CALL RATIO", value: "0.88" }, { name: "EQUITY PUT/CALL RATIO", value: "0.61" }],
      "SUM OF ALL PRODUCTS": [{ name: "VOLUME", call: 9084651, put: 7998416 }, { name: "OPEN INTEREST", call: 398430059, put: 297033510 }],
      "EQUITY OPTIONS": [{ name: "VOLUME", call: 2931155, put: 1799662 }, { name: "OPEN INTEREST", call: -1, put: 5 }],
    });
    const total = r.find((x) => x.product === "total")!;
    expect(total).toMatchObject({ callVolume: 9084651, putVolume: 7998416, publishedRatio: 0.88 });
    expect(r.find((x) => x.product === "equity")!.callOI).toBeNull(); // 음수는 버림
    expect(() => parseCboeDaily({ ratios: [] })).toThrow(ProviderError);
  });

  it("Nasdaq 옵션 체인: '--' 는 거래 없음(0), 옵션 없는 종목은 null, 숫자 형식이 많이 깨지면 오류", () => {
    const rows = [
      { expirygroup: "October 16, 2026", strike: null },
      { expirygroup: "", strike: "130.00", c_Volume: "--", p_Volume: "4", c_Openinterest: "1,038", p_Openinterest: "166" },
      { expirygroup: "", strike: "135.00", c_Volume: "4", p_Volume: "--", c_Openinterest: "63", p_Openinterest: "70" },
    ];
    const t = parseOptionChain({ data: { totalRecord: 3, lastTrade: "LAST TRADE: $342.96 (AS OF OCT 15, 2026)", table: { rows } } })!;
    expect(t).toMatchObject({ callVolume: 4, putVolume: 4, callOI: 1101, putOI: 236, contracts: 2, expiries: 1, asOf: "2026-10-15" });
    expect(parseOptionChain({ data: { totalRecord: 0, table: { rows: [] } }, message: "Options are not available for this symbol" })).toBeNull();
    const bad = Array.from({ length: 10 }, () => ({ expirygroup: "", strike: "1", c_Volume: "x", p_Volume: "1", c_Openinterest: "1", p_Openinterest: "1" }));
    expect(() => parseOptionChain({ data: { table: { rows: bad } } })).toThrow(ProviderError);
  });

  it("AAII: 메인 페이지 표·장기 평균, 결과 페이지의 연도 없는 날짜는 기준일부터 거꾸로 (연말 넘김)", () => {
    const main = parseSurveyPage(
      "<div>Week ending January 6, 2027 Bullish 38.7% Avg 37.5%</div><h2>Recent weekly results</h2><table><tr><th>Week Ending</th><th>Sentiment Votes</th></tr><tr><th>Bullish</th><th>Neutral</th><th>Bearish</th></tr><tr><td>1/6/2027</td><td>38.7%</td><td>19.7%</td><td>41.6%</td></tr><tr><td>12/30/2026</td><td>40.3%</td><td>20.8%</td><td>39.0%</td></tr></table><p>Historical view</p><p>Historical Averages 37.5% 31.0% 31.5%</p>",
    );
    expect(main.weeks.map((w) => w.weekEnding)).toEqual(["2027-01-06", "2026-12-30"]);
    expect(main.averages).toEqual({ bullish: 37.5, neutral: 31, bearish: 31.5 });
    const more = parseResultsPage("<table><tr><th>Reported Date</th><th>Bullish</th><th>Neutral</th><th>Bearish</th></tr><tr><td>Jan 6</td><td>38.7%</td><td>19.7%</td><td>41.6%</td></tr><tr><td>Dec 30</td><td>40.3%</td><td>20.8%</td><td>39.0%</td></tr><tr><td>Dec 23</td><td>34.6%</td><td>18.9%</td><td>46.5%</td></tr><tr><td>Bad</td><td>x</td></tr></table>", "2027-01-06");
    expect(more.map((w) => w.weekEnding)).toEqual(["2027-01-06", "2026-12-30", "2026-12-23"]);
    expect(parseSurveyPage("<html>no table</html>").weeks).toEqual([]);
  });

  it("13F: 옵션 행 구분·잘못된 CUSIP·음수 제외, 표지의 보고 기간과 정정 종류", () => {
    const xml = `<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>2893600</value><shrsOrPrnAmt><sshPrnamt>10000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
      <ns1:infoTable><ns1:nameOfIssuer>S&amp;P TRUST</ns1:nameOfIssuer><ns1:titleOfClass>PUT</ns1:titleOfClass><ns1:cusip>78462f103</ns1:cusip><ns1:value>100</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>5</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Put</ns1:putCall></ns1:infoTable>
      <infoTable><cusip>BAD</cusip><value>1</value><sshPrnamt>1</sshPrnamt></infoTable><infoTable><cusip>594918104</cusip><value>-1</value><sshPrnamt>1</sshPrnamt></infoTable></informationTable>`;
    const rows = parse13fInfoTable(xml);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ cusip: "78462F103", putCall: "PUT", issuer: "S&P TRUST" });
    const cover = parse13fCover("<coverPage><reportCalendarOrQuarter>06-30-2026</reportCalendarOrQuarter><isAmendment>true</isAmendment><amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo></coverPage><tableEntryTotal>89</tableEntryTotal><tableValueTotal>299253556246</tableValueTotal>");
    expect(cover).toEqual({ period: "2026-06-30", isAmendment: true, amendmentType: "NEW HOLDINGS", tableValueTotal: 299253556246, entryTotal: 89 });
  });
});

describe("저장·조회 (임시 DB)", async () => {
  const pos = await import("@/lib/data/positioning");
  const { run } = await import("@/lib/db");

  it("같은 자료를 여러 번 받아도 중복되지 않고, 정정 값은 덮어씀", () => {
    const si = [{ symbol: "AAPL", settlementDate: "2026-09-30", shortQty: 100, prevQty: 90, avgDailyVolume: 50, daysToCoverReported: 2, changePct: 11, revised: false, split: false, issueName: null }];
    pos.saveShortInterest(si);
    pos.saveShortInterest([{ ...si[0], shortQty: 110, revised: true }]);
    const d = pos.readSymbolPositioning("AAPL");
    expect(d.shortInterest?.points).toHaveLength(1);
    expect(d.shortInterest?.points[0].shortQty).toBe(110);
    pos.saveSentiment("AAII", [{ weekEnding: "2026-10-14", bullish: 38.7, neutral: 19.7, bearish: 41.6 }]);
    pos.saveSentiment("AAII", [{ weekEnding: "2026-10-14", bullish: 38.7, neutral: 19.7, bearish: 41.6 }]);
    expect(pos.readMarketSentiment().sentiment?.rows).toHaveLength(1);
  });

  it("공매도 잔고와 공매도 거래량은 다른 표·다른 항목·다른 출처로 저장·표시", () => {
    pos.saveShortVolume([{ symbol: "AAPL", date: "2026-10-14", shortVolume: 60, shortExemptVolume: 1, totalVolume: 100, markets: "Q" }]);
    const d = pos.readSymbolPositioning("AAPL");
    expect(d.shortVolume?.points).toEqual([{ date: "2026-10-14", shortVolume: 60, totalVolume: 100 }]);
    expect(d.shortInterest?.points[0].shortQty).toBe(110); // 거래량이 잔고를 덮어쓰지 않음
    expect(d.shortVolume?.info.source).toContain("장외");
    expect(d.shortInterest?.info.source).toContain("공매도 잔고");
  });

  it("시장 전체 옵션 통계를 종목 값으로 쓰지 않음 (종목 옵션 자료가 없으면 null)", () => {
    pos.saveMarketOptions("2026-10-14", [{ product: "equity", callVolume: 100, putVolume: 60, callOI: 1, putOI: 1, publishedRatio: 0.6 }]);
    expect(pos.readSymbolPositioning("GLDM").options).toBeNull();
    expect(pos.readMarketSentiment().marketOptions?.rows).toHaveLength(1);
    pos.saveOptionStats("AAPL", "2026-10-14", { callVolume: 10, putVolume: 5, callOI: 100, putOI: 50, contracts: 2, expiries: 1, asOf: "2026-10-14", totalRecord: 3 });
    pos.saveOptionStats("AAPL", "2026-10-14", { callVolume: 20, putVolume: 5, callOI: 100, putOI: 50, contracts: 2, expiries: 1, asOf: "2026-10-14", totalRecord: 3 });
    const o = pos.readSymbolPositioning("AAPL").options!;
    expect(o.points).toHaveLength(1);
    expect(o.points[0].callVolume).toBe(20);
  });

  it("13F: 보고 기간 말과 제출일을 따로 저장, 같은 제출을 다시 저장해도 행이 늘지 않음, 직전 공시 대비 변화", () => {
    const cover = { period: null, isAmendment: false, amendmentType: null, tableValueTotal: 1e9, entryTotal: 3 };
    const rowsQ1 = [
      { issuer: "APPLE INC", title: "COM", cusip: "037833100", value: 1_000_000, shares: 4000, shType: "SH", putCall: "" as const },
      { issuer: "APPLE INC", title: "COM", cusip: "037833100", value: 1_000_000, shares: 4000, shType: "SH", putCall: "" as const }, // 같은 CUSIP 여러 행 → 합산
      { issuer: "BOND CO", title: "NOTE", cusip: "123456AB1", value: 5, shares: 5, shType: "PRN", putCall: "" as const }, // 채권 원금 제외
    ];
    pos.save13fFiling(1067983, "TEST FILER", { accession: "x-1", form: "13F-HR", period: "2026-03-31", filed: "2026-05-15" }, { cover, rows: rowsQ1 });
    const rowsQ2 = [{ issuer: "APPLE INC", title: "COM", cusip: "037833100", value: 3_000_000, shares: 10000, shType: "SH", putCall: "" as const }];
    pos.save13fFiling(1067983, "TEST FILER", { accession: "x-2", form: "13F-HR", period: "2026-06-30", filed: "2026-08-14" }, { cover, rows: rowsQ2 });
    pos.save13fFiling(1067983, "TEST FILER", { accession: "x-2", form: "13F-HR", period: "2026-06-30", filed: "2026-08-14" }, { cover, rows: rowsQ2 });
    // 가격 대조용 종가 (2026-06-30 = 300 → 신고 가치 ÷ 수량 = 300)
    run("INSERT INTO bars(symbol, interval, ts, open, high, low, close, volume) VALUES('AAPL','1d',?,300,300,300,300,1)", Date.parse("2026-06-30T13:30:00Z") / 1000);
    const inst = pos.readSymbolPositioning("AAPL").institutions!;
    expect(inst.holdings).toHaveLength(1);
    const h = inst.holdings[0];
    expect(h).toMatchObject({ period: "2026-06-30", filed: "2026-08-14", shares: 10000, prevShares: 8000, prevKnown: true, prevPeriod: "2026-03-31" });
    expect(h.priceCheck.ok).toBe(true);
    expect(holdingChange(h.shares, h.prevShares, h.prevKnown).status).toBe("increased");
    const top = pos.readMarketSentiment().institutions[0];
    expect(top.top[0]).toMatchObject({ cusip: "037833100", symbol: "AAPL", rank: 1 });
  });

  it("천 달러 단위 보고 13F 는 저장할 때 1000을 곱하고 안내를 남김 (가격 대조 통과)", () => {
    const cover = { period: null, isAmendment: false, amendmentType: null, tableValueTotal: 5000, entryTotal: 3 };
    const rows = [
      { issuer: "APPLE INC", title: "COM", cusip: "037833100", value: 300, shares: 1000, shType: "SH", putCall: "" as const }, // 실제 30만 달러 = 300 (천 달러)
      { issuer: "X", title: "COM", cusip: "11111A101", value: 100, shares: 1000, shType: "SH", putCall: "" as const },
      { issuer: "Y", title: "COM", cusip: "22222B102", value: 50, shares: 1000, shType: "SH", putCall: "" as const },
    ];
    pos.save13fFiling(1536411, "TEST THOUSANDS", { accession: "k-1", form: "13F-HR", period: "2026-06-30", filed: "2026-08-14" }, { cover, rows });
    const h = pos.readSymbolPositioning("AAPL").institutions!.holdings.find((x) => x.cik === 1536411)!;
    expect(h.value).toBe(300_000);
    expect(h.priceCheck.ok).toBe(true); // 300,000 ÷ 1,000 = 300 = 종가
    expect(h.valueNote).toContain("천 달러");
    const m = pos.readMarketSentiment().institutions.find((x) => x.cik === 1536411)!;
    expect(m.totalValue).toBe(5_000_000);
  });

  it("출처가 모두 실패해도 작업이 멈추지 않고 출처별로 실패를 남김", async () => {
    for (const k of ["FINRA_API_BASE", "FINRA_CDN_BASE", "CBOE_CDN_BASE", "AAII_BASE", "NASDAQ_API_BASE", "CNN_DATAVIZ_BASE"]) process.env[k] = "http://127.0.0.1:9";
    process.env.RATE_LIMIT_SCALE = "0";
    const close = Date.parse("2026-10-14T20:00:00Z");
    const parts = await pos.collectPositioning({ tradeDate: "2026-10-14", now: close + 3600_000, log: () => {}, symbols: ["AAPL"], skip13f: true });
    expect(Object.keys(parts).sort()).toEqual(["fear_greed", "market_options", "options", "sentiment", "short_interest", "short_volume"]);
    for (const k of ["short_interest", "short_volume", "options", "sentiment", "fear_greed"]) expect(parts[k].ok, k).toBe(false);
    // 기존에 저장한 값은 그대로
    expect(pos.readSymbolPositioning("AAPL").shortInterest?.points[0].shortQty).toBe(110);
  }, 60_000);
});
