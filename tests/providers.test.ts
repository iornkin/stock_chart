/**
 * 데이터 제공처 응답 파서 테스트.
 * 아래 응답은 각 제공처 문서의 응답 형식을 따른 '테스트용 고정 데이터'이며 실제 시장 데이터가 아니다.
 */
import { describe, expect, it } from "vitest";
import { normalizeV7Quote, parseChart, parseSearchNews } from "@/lib/providers/yahoo";
import { parseNasdaqDividends, mdyToIso } from "@/lib/providers/nasdaq";
import { parsePolygonDividends, parsePolygonNews } from "@/lib/providers/polygon";
import { parseEarnings, parseFinnhubNews } from "@/lib/providers/finnhub";
import { parseRss } from "@/lib/providers/googlenews";
import { parseEtfProfile } from "@/lib/providers/alphavantage";
import { dedupeNews } from "@/lib/news-utils";

describe("Yahoo", () => {
  it("chart: 결측 봉 제외, 배당·분할 이벤트 ET 날짜 변환", () => {
    const r = parseChart("JEPI", {
      chart: {
        result: [
          {
            meta: { currency: "USD", regularMarketPrice: 57.1 },
            timestamp: [1759325400, 1759411800, 1759498200],
            events: {
              dividends: { "1759325400": { amount: 0.4, date: 1759325400 } },
              splits: { "1759411800": { date: 1759411800, numerator: 2, denominator: 1 } },
            },
            indicators: {
              quote: [{ open: [57, null, 57.2], high: [57.5, null, 57.4], low: [56.8, null, 57], close: [57.1, null, 57.3], volume: [100, null, 120] }],
              adjclose: [{ adjclose: [56.9, null, 57.3] }],
            },
          },
        ],
        error: null,
      },
    });
    expect(r.bars).toHaveLength(2);
    expect(r.dividends).toEqual([{ date: "2025-10-01", amount: 0.4 }]);
    expect(r.splits[0]).toMatchObject({ date: "2025-10-02", numerator: 2, denominator: 1 });
  });
  it("chart: 오류 응답", () => {
    expect(() => parseChart("ZZZ", { chart: { result: null, error: { code: "Not Found", description: "No data found" } } })).toThrow(/No data found/);
  });
  it("v7 quote 정규화 ({raw} 형식과 숫자 모두 처리)", () => {
    const q = normalizeV7Quote(
      { symbol: "QQQ", longName: "Invesco QQQ Trust", regularMarketPrice: { raw: 600.5, fmt: "600.50" }, regularMarketChangePercent: 1.2, regularMarketTime: 1759435200, exchangeDataDelayedBy: 0, quoteSourceName: "Nasdaq Real Time Price", marketState: "REGULAR" },
      1,
    );
    expect(q.price).toBe(600.5);
    expect(q.changePct).toBe(1.2);
    expect(q.marketTime).toBe(1759435200000);
    expect(q.delayMinutes).toBe(0);
  });
  it("search 뉴스", () => {
    const n = parseSearchNews({ news: [{ uuid: "u", title: "Nasdaq rallies", publisher: "Reuters", link: "https://example.com/a?utm_source=x", providerPublishTime: 1759435200, relatedTickers: ["qqq"] }, { title: "no link" }] }, 5);
    expect(n).toHaveLength(1);
    expect(n[0].related).toEqual(["QQQ"]);
  });
});

describe("Nasdaq 배당", () => {
  it("날짜·금액 파싱, N/A 처리", () => {
    expect(mdyToIso("10/01/2025")).toBe("2025-10-01");
    expect(mdyToIso("N/A")).toBeNull();
    const rows = parseNasdaqDividends({
      data: { dividends: { rows: [{ exOrEffDate: "10/01/2025", type: "Cash", amount: "$0.40", declarationDate: "09/29/2025", recordDate: "10/01/2025", paymentDate: "10/03/2025", currency: "USD" }, { exOrEffDate: "N/A", amount: "$1" }] } },
      status: { rCode: 200 },
    });
    expect(rows).toEqual([{ exDate: "2025-10-01", amount: 0.4, type: "Cash", declaredDate: "2025-09-29", recordDate: "2025-10-01", payDate: "2025-10-03", currency: "USD" }]);
  });
  it("오류 코드", () => {
    expect(() => parseNasdaqDividends({ data: null, status: { rCode: 400, bCodeMessage: [{ errorMessage: "Symbol not exists" }] } })).toThrow(/Symbol not exists/);
  });
});

describe("Polygon / Finnhub / Alpha Vantage / Google News", () => {
  it("Polygon 배당·뉴스", () => {
    const d = parsePolygonDividends({ results: [{ ex_dividend_date: "2025-10-01", cash_amount: 0.4, pay_date: "2025-10-03", frequency: 12, dividend_type: "CD" }] });
    expect(d[0]).toMatchObject({ exDate: "2025-10-01", payDate: "2025-10-03", frequency: 12, type: "CD" });
    const n = parsePolygonNews({ results: [{ title: "t", article_url: "https://x.com/1", published_utc: "2025-10-01T12:00:00Z", publisher: { name: "Benzinga" }, tickers: ["jepi"], description: "desc" }] }, 1);
    expect(n[0]).toMatchObject({ publisher: "Benzinga", summary: "desc", related: ["JEPI"] });
  });
  it("Finnhub 뉴스·실적", () => {
    const n = parseFinnhubNews([{ headline: "Apple beats", url: "https://x.com/2", datetime: 1759435200, source: "CNBC", summary: " s ", related: "AAPL" }], 1);
    expect(n[0]).toMatchObject({ summary: "s", related: ["AAPL"], publisher: "CNBC" });
    const e = parseEarnings({ earningsCalendar: [{ date: "2025-10-30", symbol: "aapl", hour: "amc", epsEstimate: 1.7, epsActual: null, quarter: 4, year: 2025 }] });
    expect(e[0]).toMatchObject({ symbol: "AAPL", hour: "amc", epsActual: null, quarter: 4 });
  });
  it("Alpha Vantage ETF 프로필과 호출 한도 응답", () => {
    const p = parseEtfProfile({ net_assets: "300000000000", net_expense_ratio: "0.002", holdings: [{ symbol: "NVDA", description: "NVIDIA CORP", weight: "0.09" }], sectors: [{ sector: "INFORMATION TECHNOLOGY", weight: "0.5" }] });
    expect(p.netExpenseRatio).toBe(0.002);
    expect(p.holdings[0]).toEqual({ symbol: "NVDA", name: "NVIDIA CORP", weight: 0.09 });
    expect(() => parseEtfProfile({ Information: "rate limit" })).toThrow(/호출 한도/);
  });
  it("Google News RSS", () => {
    const xml = `<rss><channel><item><title>Gold hits record - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Wed, 01 Oct 2025 12:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Gold hits record&lt;/a&gt;</description><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
    const n = parseRss(xml, 1);
    expect(n[0]).toMatchObject({ title: "Gold hits record", publisher: "Reuters", summary: null });
  });
});

describe("뉴스 중복 통합", () => {
  const base = { summary: null, provider: "p", fetchedAt: 0, related: [] as string[] };
  it("유사 제목·같은 URL 통합, 다른 기사는 유지", () => {
    const items = [
      { ...base, id: "1", title: "Nvidia shares jump after record quarterly revenue", url: "https://a.com/1", publisher: "A", publishedAt: 1000 },
      { ...base, id: "2", title: "Nvidia shares jump after record quarterly revenue report", url: "https://b.com/2", publisher: "B", publishedAt: 2000 },
      { ...base, id: "3", title: "Gold prices slip as dollar firms", url: "https://c.com/3", publisher: "C", publishedAt: 3000 },
      { ...base, id: "4", title: "dup url", url: "https://a.com/1?utm_source=x", publisher: "A", publishedAt: 4000 },
    ];
    const out = dedupeNews(items);
    expect(out).toHaveLength(2);
    const nv = out.find((x) => x.title.startsWith("Nvidia"));
    expect(nv?.duplicates?.map((d) => d.publisher)).toEqual(["B"]);
  });
});
