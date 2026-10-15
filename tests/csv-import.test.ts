import { describe, expect, it } from "vitest";
import { buildHoldings, buildTxns, guessMapping, parseCsv, parseDate, parseNumber, parseType, TXN_FIELD_KO, HOLDING_FIELD_KO, type TxnField, type HoldingField } from "@/lib/portfolio/csv-import";
import { computeLedger } from "@/lib/portfolio/ledger";
import type { Txn } from "@/lib/portfolio/types";

const TF = Object.keys(TXN_FIELD_KO) as TxnField[];
const HF = Object.keys(HOLDING_FIELD_KO) as HoldingField[];
const opts = { today: "2026-10-14", batch: "b1", now: 1000 };

describe("CSV 읽기", () => {
  it("BOM·따옴표·쉼표 포함 값·세미콜론 구분", () => {
    expect(parseCsv('﻿날짜,종목,메모\n2026-01-02,SCHD,"a, ""b"""\n')).toEqual([["날짜", "종목", "메모"], ["2026-01-02", "SCHD", 'a, "b"']]);
    expect(parseCsv("date;symbol\n2026-01-02;QQQ")).toEqual([["date", "symbol"], ["2026-01-02", "QQQ"]]);
  });
  it("날짜·숫자·거래 종류 해석", () => {
    expect(parseDate("2026/1/2")).toBe("2026-01-02");
    expect(parseDate("01/02/2026")).toBe("2026-01-02");
    expect(parseDate("20260102")).toBe("2026-01-02");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("(12.5)")).toBe(-12.5);
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("")).toBeUndefined();
    expect(parseType("매수")).toBe("buy");
    expect(parseType("배당금입금")).toBe("dividend");
    expect(parseType("Dividend Reinvest")).toBe("reinvest");
    expect(parseType("옵션")).toBeNull();
  });
  it("한글·영문 열 이름 짐작", () => {
    const m = guessMapping(["거래일자", "구분", "종목코드", "수량", "체결단가", "거래금액", "수수료"], TF);
    expect(m).toMatchObject({ date: 0, type: 1, symbol: 2, shares: 3, price: 4, amount: 5, fee: 6, tax: null });
    expect(guessMapping(["Ticker", "Quantity", "Average Cost"], HF)).toMatchObject({ symbol: 0, shares: 1, avgCost: 2 });
  });
});

describe("거래 후보 만들기와 검증", () => {
  const rows = parseCsv(`date,type,symbol,shares,price,amount,fee,tax,currency
2026-01-02,입금,,,,10000,,,USD
2026-01-02,매수,SCHD,100,27,2700,1,,USD
2026-03-05,배당,SCHD,,,25,,3.75,USD
2026-03-05,배당,SCHD,,,25,,3.75,USD
2026-04-01,매수,ZZZZ,1,10,,,,USD
2026-04-02,매수,QQQ,1,500,,,,KRW
2027-01-01,매도,SCHD,1,30,,,,USD
2026-05-01,옵션,SCHD,1,1,,,,USD
2026-05-02,매수,QQQ,2,500,5000,,,USD`).slice(1);
  const map = guessMapping(["date", "type", "symbol", "shares", "price", "amount", "fee", "tax", "currency"], TF);
  const existing: Txn[] = [{ id: "x", type: "deposit", date: "2026-01-02", amount: 10000, createdAt: 0 }];
  const out = buildTxns(rows, map, existing, opts);

  it("정상 행은 거래로, 문제 행은 이유와 함께 제외", () => {
    expect(out[1].txn).toMatchObject({ type: "buy", symbol: "SCHD", shares: 100, price: 27, fee: 1 });
    expect(out[1].txn?.amount).toBeUndefined(); // 매수 금액은 수량×단가로 계산
    expect(out[2].txn).toMatchObject({ type: "dividend", amount: 25, tax: 3.75 });
    expect(out[4].problems.join()).toContain("지원하지 않는 종목");
    expect(out[5].problems.join()).toContain("달러가 아닌 통화");
    expect(out[6].problems.join()).toContain("미래 날짜");
    expect(out[7].problems.join()).toContain("지원하지 않는 거래 종류");
    expect(out[8].problems.join()).toContain("맞지 않음");
    for (const r of [out[4], out[5], out[6], out[7], out[8]]) expect(r.include).toBe(false);
  });

  it("기존 기록과 같은 거래·파일 안 중복은 기본으로 빼 둠 (다시 가져와도 두 번 들어가지 않음)", () => {
    expect(out[0].duplicate).toBe("existing");
    expect(out[3].duplicate).toBe("file");
    expect(out.filter((r) => r.include).length).toBe(2);
    // 가져온 뒤 같은 파일을 다시 읽으면 모두 기존 중복
    const merged = [...existing, ...out.filter((r) => r.include).map((r) => r.txn as Txn)];
    const again = buildTxns(rows, map, merged, { ...opts, batch: "b2" });
    expect(again.filter((r) => r.include)).toHaveLength(0);
    // 반영 결과: 현금 = 10000 − 2701 + 21.25
    expect(computeLedger(merged, {}).cash).toBeCloseTo(10000 - 2701 + 21.25, 9);
  });
});

describe("보유 종목 가져오기", () => {
  it("같은 종목은 덮어쓴다고 표시, 문제 행 제외", () => {
    const rows = parseCsv("ticker,quantity,avg cost,acquired\nSCHD,100,27,2025-01-02\nQQQ,0,500,\nZZZ,1,1,\nJEPI,5,55,2025-13-01").slice(1);
    const r = buildHoldings(rows, guessMapping(["ticker", "quantity", "avg cost", "acquired"], HF), [{ id: "h", symbol: "SCHD", shares: 1, avgCost: 1 }], opts);
    expect(r[0]).toMatchObject({ replaces: true, include: true });
    expect(r[0].holding).toMatchObject({ symbol: "SCHD", shares: 100, avgCost: 27, firstDate: "2025-01-02" });
    expect(r[1].problems).toContain("수량 없음");
    expect(r[2].problems.join()).toContain("지원하지 않는 종목");
    expect(r[3].problems.join()).toContain("최초 매수일");
  });
});
