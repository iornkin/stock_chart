import { describe, expect, it } from "vitest";
import { checkPortfolioData, missingDividendRecords, type DataCheckInput } from "@/lib/portfolio/data-check";
import { EMPTY_PORTFOLIO, type PortfolioData, type Txn } from "@/lib/portfolio/types";
import type { PriceSeries } from "@/lib/sim/series";

const NOW = Date.UTC(2026, 9, 14);
const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });
const series = (symbol: string, close: number, divs: PriceSeries["divs"] = []): PriceSeries => ({
  symbol,
  kind: "etf",
  dates: ["2026-01-02", "2026-03-02", "2026-06-01", "2026-09-01", "2026-10-13"],
  close: [close, close, close, close, close],
  divs,
  source: "t",
  fetchedAt: 0,
});
const base = (p: PortfolioData, over: Partial<DataCheckInput> = {}): DataCheckInput => ({
  p,
  today: "2026-10-14",
  now: NOW,
  quotes: [{ symbol: "SCHD", time: NOW - 3600_000, source: "t" }],
  quotesError: null,
  fx: { time: NOW - 3600_000 },
  series: { SCHD: series("SCHD", 27) },
  income: {},
  staleQuoteMs: 4 * 86400_000,
  ...over,
});
const ledger = (txns: Txn[]): PortfolioData => ({ ...EMPTY_PORTFOLIO, mode: "ledger", ledger: txns });

describe("데이터 점검", () => {
  it("문제가 없으면 '정상' 하나", () => {
    const r = checkPortfolioData(base(ledger([t({ type: "deposit", date: "2026-01-02", amount: 1000 }, 1), t({ type: "buy", date: "2026-01-02", symbol: "SCHD", shares: 10, price: 27 }, 2)])));
    expect(r.map((x) => x.status)).toEqual(["ok"]);
  });

  it("같은 거래 중복 → 확인 필요, 지울 후보는 하나만 남기도록", () => {
    const buy = { type: "buy" as const, date: "2026-01-02", symbol: "SCHD", shares: 10, price: 27 };
    const r = checkPortfolioData(base(ledger([t({ type: "deposit", date: "2026-01-02", amount: 1000 }, 1), t(buy, 2), t(buy, 3)])));
    const d = r.find((x) => x.title === "같은 거래가 두 번 기록됨")!;
    expect(d.status).toBe("check");
    expect(d.removable).toEqual(["t3"]);
  });

  it("보유보다 많은 매도는 오류 확정, 현금 음수는 확인 필요", () => {
    const r = checkPortfolioData(base(ledger([t({ type: "buy", date: "2026-01-02", symbol: "SCHD", shares: 10, price: 27 }, 1), t({ type: "sell", date: "2026-03-02", symbol: "SCHD", shares: 20, price: 27 }, 2)])));
    expect(r.some((x) => x.status === "error" && x.cause.includes("보유 수량"))).toBe(true);
    expect(r.some((x) => x.status === "check" && x.cause.includes("음수"))).toBe(true);
  });

  it("거래 가격이 그날 종가와 크게 다르면 분할 전 가격 가능성 안내", () => {
    const r = checkPortfolioData(base(ledger([t({ type: "deposit", date: "2026-01-02", amount: 10000 }, 1), t({ type: "buy", date: "2026-01-02", symbol: "SCHD", shares: 10, price: 81 }, 2)])));
    expect(r.find((x) => x.title.includes("실제 종가와 크게 다름"))?.status).toBe("check");
  });

  it("같은 분배금을 수령·재투자로 모두 적은 경우와 기록 누락", () => {
    const divs = [{ ex: "2026-03-02", pay: "2026-03-05", amount: 0.25, kind: "regular" }, { ex: "2026-06-01", pay: "2026-06-04", amount: 0.26, kind: "regular" }];
    const p = ledger([
      t({ type: "deposit", date: "2026-01-02", amount: 1000 }, 1),
      t({ type: "buy", date: "2026-01-02", symbol: "SCHD", shares: 10, price: 27 }, 2),
      t({ type: "dividend", date: "2026-03-05", symbol: "SCHD", amount: 2.5, tax: 0.38 }, 3),
      t({ type: "reinvest", date: "2026-03-06", symbol: "SCHD", amount: 2.5, tax: 0.38, shares: 0.08, price: 26.5 }, 4),
    ]);
    const s = { SCHD: series("SCHD", 27, divs) };
    const r = checkPortfolioData(base(p, { series: s }));
    expect(r.some((x) => x.title.includes("'수령'과 '재투자'"))).toBe(true);
    const miss = missingDividendRecords(p.ledger, s, "2026-10-14");
    expect(miss.map((m) => m.ex)).toEqual(["2026-06-01"]);
    expect(r.some((x) => x.title.includes("기록에 없음"))).toBe(true);
  });

  it("시세·환율이 오래되면 업데이트 지연, 없으면 데이터 부족", () => {
    const p = ledger([t({ type: "deposit", date: "2026-01-02", amount: 1000 }, 1), t({ type: "buy", date: "2026-01-02", symbol: "SCHD", shares: 10, price: 27 }, 2), t({ type: "buy", date: "2026-01-02", symbol: "JEPI", shares: 1, price: 55 }, 3)]);
    const r = checkPortfolioData(base(p, { quotes: [{ symbol: "SCHD", time: NOW - 10 * 86400_000, source: "t" }], fx: { time: null } }));
    expect(r.find((x) => x.key === "quote:SCHD:stale")?.status).toBe("stale");
    expect(r.find((x) => x.key === "quote:JEPI:none")?.status).toBe("missing");
    expect(r.find((x) => x.key === "fx:none")?.status).toBe("missing");
    expect(r.find((x) => x.key === "series:JEPI")?.status).toBe("missing");
  });

  it("간편 입력: 평균 단가가 실제 가격 범위 밖이면 확인 필요, 분배금 기록이 오래되면 지연", () => {
    const p: PortfolioData = { ...EMPTY_PORTFOLIO, simple: { holdings: [{ id: "h1", symbol: "SCHD", shares: 10, avgCost: 80, firstDate: "2026-01-02" }], cash: 0 } };
    const r = checkPortfolioData(base(p, { income: { SCHD: { perYear: 4, latestEx: "2026-03-01" } } }));
    expect(r.find((x) => x.key === "avg:h1")?.status).toBe("check");
    expect(r.find((x) => x.key.startsWith("div:SCHD"))?.status).toBe("stale");
  });
});
