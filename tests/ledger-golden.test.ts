/**
 * 내 자산 회계 기준값 테스트 — 기대값은 아래 주석의 손계산
 * + 속성 기반 테스트(시드 고정 난수로 만든 거래 수백 묶음): 항등식·결정성·순서·비중 합·규모 불변
 */
import { describe, expect, it } from "vitest";
import { computeLedger } from "@/lib/portfolio/ledger";
import { applySplitToHoldings, applySplitToTxns, detectUnadjustedHoldings, detectUnadjustedTrades, splitFactorAfter } from "@/lib/portfolio/splits";
import { mulberry32 } from "@/lib/sim/metrics";
import type { PriceSeries } from "@/lib/sim/series";
import type { Txn, TxnType } from "@/lib/portfolio/types";

let n = 0;
const tx = (type: TxnType, date: string, o: Partial<Txn> = {}): Txn => ({ id: `t${++n}`, type, date, createdAt: n, ...o });

describe("회계 기준값 (손계산)", () => {
  // 입금 10,000 → 매수 10@100(수수료 5) → 매수 10@120(5) → 매도 5@130(5) → 분배금 30(세금 4.5)
  // → 재투자 20(세금 3, 0.1주@170) → 출금 1,000, 현재가 150
  const L = [
    tx("deposit", "2024-01-02", { amount: 10_000 }),
    tx("buy", "2024-01-03", { symbol: "A", shares: 10, price: 100, fee: 5 }),
    tx("buy", "2024-02-01", { symbol: "A", shares: 10, price: 120, fee: 5 }),
    tx("sell", "2024-03-01", { symbol: "A", shares: 5, price: 130, fee: 5 }),
    tx("dividend", "2024-03-15", { symbol: "A", amount: 30, tax: 4.5 }),
    tx("reinvest", "2024-06-15", { symbol: "A", amount: 20, tax: 3, shares: 0.1, price: 170 }),
    tx("withdraw", "2024-07-01", { amount: 1_000 }),
  ];
  const r = computeLedger(L, { A: 150 });
  const a = r.positions[0];

  it("이동평균 단가·실현 손익 (수수료 포함)", () => {
    // 원가 1005 + 1205 = 2210, 20주 → 평균 110.5. 매도 5주: 대금 650 − 5 = 645, 원가 552.5 → 실현 92.5
    expect(a.realized).toBeCloseTo(92.5, 10);
    // 남은 원가 1657.5 + 재투자 17 = 1674.5, 수량 15.1
    expect(a.shares).toBeCloseTo(15.1, 10);
    expect(a.cost).toBeCloseTo(1674.5, 10);
    expect(a.avgCost).toBeCloseTo(1674.5 / 15.1, 10);
  });
  it("현금·원금·분배금·수수료", () => {
    // 10000 − 1005 − 1205 + 645 + 25.5 + (17 − 17) − 1000
    expect(r.cash).toBeCloseTo(7_460.5, 10);
    expect(r.netContributions).toBe(9_000);
    expect(r.dividendsGross).toBe(50);
    expect(r.dividendsTax).toBe(7.5);
    expect(r.dividendsNet).toBe(42.5);
    expect(r.fees).toBe(15);
  });
  it("평가·총수익률과 항등식 (총자산 − 원금 = 미실현 + 실현 + 세후 분배금)", () => {
    expect(r.marketValue).toBeCloseTo(2_265, 10);
    expect(r.unrealized).toBeCloseTo(590.5, 10);
    expect(r.totalAssets).toBeCloseTo(9_725.5, 10);
    expect(r.totalPnl).toBeCloseTo(725.5, 10);
    expect(r.totalPnl).toBeCloseTo(r.unrealized + r.realized + r.dividendsNet, 10);
    expect(r.totalReturnPct).toBeCloseTo((725.5 / 9_000) * 100, 10);
    expect(r.issues).toEqual([]);
  });
  it("전량 매도 → 수량·원가 0, 실현에 합산", () => {
    const r2 = computeLedger([...L, tx("sell", "2024-08-01", { symbol: "A", shares: 15.1, price: 150 })], { A: 150 });
    expect(r2.positions[0].shares).toBe(0);
    expect(r2.positions[0].cost).toBe(0);
    expect(r2.realized).toBeCloseTo(92.5 + 590.5, 8);
    expect(r2.marketValue).toBe(0);
    expect(r2.totalPnl).toBeCloseTo(725.5, 8);
  });
  it("기준일(asOf) 이후 거래는 빼고 계산", () => {
    const r3 = computeLedger(L, { A: 150 }, "2024-02-15");
    expect(r3.positions[0].shares).toBe(20);
    expect(r3.cash).toBeCloseTo(7_790, 10);
  });
});

describe("잘못된 입력·빈 포트폴리오", () => {
  it("보유보다 많은 매도는 반영하지 않고 오류로 남김 (현금 변화 없음)", () => {
    const r = computeLedger([tx("deposit", "2024-01-02", { amount: 1000 }), tx("buy", "2024-01-03", { symbol: "A", shares: 2, price: 100 }), tx("sell", "2024-01-04", { symbol: "A", shares: 3, price: 110 })], { A: 100 });
    expect(r.cash).toBe(800);
    expect(r.positions[0].shares).toBe(2);
    expect(r.issues.some((i) => i.level === "error" && i.message.includes("반영하지 않았습니다"))).toBe(true);
  });
  it("수량 0·음수 입금·세금 > 분배금·재투자 수량 없음은 오류", () => {
    const r = computeLedger(
      [
        tx("buy", "2024-01-03", { symbol: "A", shares: 0, price: 100 }),
        tx("deposit", "2024-01-03", { amount: -5 }),
        tx("dividend", "2024-01-03", { symbol: "A", amount: 10, tax: 11 }),
        tx("reinvest", "2024-01-03", { symbol: "A", amount: 10, tax: 1 }),
        tx("buy", "2024-01-03", { symbol: "A", shares: Number.NaN, price: 100 }),
      ],
      { A: 100 },
    );
    expect(r.issues.filter((i) => i.level === "error")).toHaveLength(5);
    expect(Number.isFinite(r.totalAssets)).toBe(true);
  });
  it("현금이 음수가 되는 매수는 경고 (입금 누락 가능성)", () => {
    const r = computeLedger([tx("buy", "2024-01-03", { symbol: "A", shares: 1, price: 100 })], { A: 100 });
    expect(r.issues[0].level).toBe("warn");
  });
  it("빈 포트폴리오: 0과 계산 불가(null)를 구분", () => {
    const r = computeLedger([], {});
    expect(r.totalAssets).toBe(0);
    expect(r.totalReturnPct).toBeNull();
    expect(r.positions).toEqual([]);
  });
  it("시세가 없는 종목이 있으면 총수익률을 계산하지 않음", () => {
    const r = computeLedger([tx("deposit", "2024-01-02", { amount: 1000 }), tx("buy", "2024-01-03", { symbol: "A", shares: 1, price: 100 })], {});
    expect(r.missingPrices).toEqual(["A"]);
    expect(r.totalReturnPct).toBeNull();
  });
  it("환율: 입력 환율 → 없으면 그날 종가로 근사", () => {
    const r = computeLedger([tx("deposit", "2024-01-02", { amount: 1000, fx: 1300 }), tx("buy", "2024-01-03", { symbol: "A", shares: 5, price: 100 })], { A: 100 }, undefined, { fxOn: () => 1350 });
    expect(r.netContributionsKrw).toBe(1_300_000);
    expect(r.positions[0].costKrw).toBe(675_000);
    expect(r.fxEstimated).toBe(1);
  });
});

describe("주식분할 (기업행위)", () => {
  // 3:1 분할 2024-10-11. 일봉은 분할 반영 (분할 전 날짜의 종가도 ÷3)
  const s: PriceSeries = {
    symbol: "S",
    kind: "etf",
    dates: ["2024-06-03", "2024-10-10", "2024-10-11", "2025-01-02"],
    close: [26.5, 28, 28.1, 27],
    divs: [],
    splits: [{ date: "2024-10-11", ratio: 3 }],
    source: "t",
    fetchedAt: 0,
  };
  it("분할 비율: 분할일 전 거래만 해당", () => {
    expect(splitFactorAfter(s.splits, "2024-06-03")).toBe(3);
    expect(splitFactorAfter(s.splits, "2024-10-11")).toBe(1);
    expect(splitFactorAfter([{ date: "2020-01-01", ratio: 2 }, { date: "2022-01-01", ratio: 3 }], "2019-05-01")).toBe(6);
  });
  it("분할 전 가격으로 넣은 거래만 찾고, 이미 반영한 거래는 그대로", () => {
    const L = [tx("buy", "2024-06-03", { symbol: "S", shares: 10, price: 79.5 }), tx("buy", "2024-06-03", { symbol: "S", shares: 30, price: 26.6 }), tx("buy", "2025-01-02", { symbol: "S", shares: 1, price: 27 })];
    const sus = detectUnadjustedTrades(L, { S: s });
    expect(sus.map((x) => x.id)).toEqual([L[0].id]);
    expect(sus[0].factor).toBe(3);
    const fixed = applySplitToTxns(L, sus);
    expect(fixed[0].shares).toBe(30);
    expect(fixed[0].price).toBeCloseTo(26.5, 10);
    expect((fixed[0].shares ?? 0) * (fixed[0].price ?? 0)).toBeCloseTo(795, 10); // 거래 금액 그대로
    expect(fixed[0].memo).toContain("분할 ×3 반영");
    expect(fixed[1]).toBe(L[1]);
  });
  it("고친 뒤에는 분할 후 수량으로 매도 가능", () => {
    const L = [tx("deposit", "2024-06-01", { amount: 1000 }), tx("buy", "2024-06-03", { symbol: "S", shares: 10, price: 79.5 }), tx("sell", "2025-01-02", { symbol: "S", shares: 30, price: 27 })];
    expect(computeLedger(L, { S: 27 }).issues.some((i) => i.level === "error")).toBe(true);
    const fixed = applySplitToTxns(L, detectUnadjustedTrades(L, { S: s }));
    const r = computeLedger(fixed, { S: 27 });
    expect(r.issues).toEqual([]);
    expect(r.realized).toBeCloseTo(30 * 27 - 795, 8);
  });
  it("간편 입력 보유: 최초 매수일이 분할 전이고 평균 단가가 분할 전 기준", () => {
    const H = [
      { id: "h1", symbol: "S", shares: 100, avgCost: 80, firstDate: "2024-06-03" },
      { id: "h2", symbol: "S", shares: 300, avgCost: 27, firstDate: "2024-06-03" },
      { id: "h3", symbol: "S", shares: 100, avgCost: 80 },
    ];
    const sus = detectUnadjustedHoldings(H, { S: s });
    expect(sus.map((x) => x.id)).toEqual(["h1"]);
    const fixed = applySplitToHoldings(H, sus);
    expect(fixed[0]).toMatchObject({ shares: 300 });
    expect(fixed[0].avgCost).toBeCloseTo(80 / 3, 10);
  });
});

describe("속성 기반 (시드 고정 무작위 거래 300묶음)", () => {
  const SYMS = ["A", "B", "C"];
  function randomLedger(seed: number) {
    const rnd = mulberry32(seed);
    const L: Txn[] = [];
    let cash = 0;
    const held: Record<string, number> = {};
    let day = 0;
    let k = 0;
    const date = () => `2024-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`;
    const push = (t: Omit<Txn, "id" | "createdAt">) => L.push({ ...t, id: `r${seed}-${k}`, createdAt: k++ });
    for (let i = 0; i < 40; i++) {
      day = Math.min(330, day + Math.floor(rnd() * 8));
      const u = rnd();
      const sym = SYMS[Math.floor(rnd() * SYMS.length)];
      const price = Math.round((20 + rnd() * 300) * 100) / 100;
      if (u < 0.2 || cash < 50) {
        const amt = Math.round(rnd() * 5000 * 100) / 100 + 100;
        cash += amt;
        push({ type: "deposit", date: date(), amount: amt });
      } else if (u < 0.55) {
        const sh = Math.floor(((cash * 0.5) / price) * 1000) / 1000;
        if (sh <= 0) continue;
        const fee = Math.round(rnd() * 3 * 100) / 100;
        cash -= sh * price + fee;
        held[sym] = (held[sym] ?? 0) + sh;
        push({ type: "buy", date: date(), symbol: sym, shares: sh, price, fee });
      } else if (u < 0.75 && (held[sym] ?? 0) > 0) {
        const sh = Math.floor(held[sym] * rnd() * 1000) / 1000;
        if (sh <= 0) continue;
        held[sym] -= sh;
        cash += sh * price;
        push({ type: "sell", date: date(), symbol: sym, shares: sh, price, fee: 0 });
      } else if (u < 0.9 && (held[sym] ?? 0) > 0) {
        const amt = Math.round(held[sym] * rnd() * 2 * 100) / 100 + 0.01;
        const tax = Math.round(amt * 0.15 * 100) / 100;
        if (rnd() < 0.5) {
          cash += amt - tax;
          push({ type: "dividend", date: date(), symbol: sym, amount: amt, tax });
        } else {
          const sh = Math.floor(((amt - tax) / price) * 10000) / 10000;
          if (sh <= 0) continue;
          held[sym] += sh;
          cash += amt - tax - sh * price;
          push({ type: "reinvest", date: date(), symbol: sym, amount: amt, tax, shares: sh, price });
        }
      } else if (cash > 100) {
        const amt = Math.round(cash * 0.2 * 100) / 100;
        cash -= amt;
        push({ type: "withdraw", date: date(), amount: amt });
      }
    }
    const prices = Object.fromEntries(SYMS.map((s) => [s, Math.round((20 + rnd() * 300) * 100) / 100]));
    return { L, prices };
  }
  const shuffle = <T,>(xs: T[], seed: number) => {
    const rnd = mulberry32(seed);
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  it("항등식·결정성·입력 순서·비중 합·규모 불변", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { L, prices } = randomLedger(seed);
      const r = computeLedger(L, prices);
      expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
      // 총자산 − 순납입 원금 = 미실현 + 실현 + 세후 분배금
      expect(r.totalPnl).toBeCloseTo(r.unrealized + r.realized + r.dividendsNet, 6);
      // 같은 입력 → 같은 결과, 배열 순서를 섞어도(날짜·입력 순서로 정렬) 같은 결과
      expect(computeLedger(L, prices)).toEqual(r);
      expect(computeLedger(shuffle(L, seed), prices).totalAssets).toBeCloseTo(r.totalAssets, 9);
      // 평가금액 = Σ 수량 × 가격, 비중 합 = 100%
      const held = r.positions.filter((p) => p.shares > 0);
      expect(r.marketValue).toBeCloseTo(held.reduce((a, p) => a + p.shares * prices[p.symbol], 0), 8);
      if (r.marketValue > 0) expect(held.reduce((a, p) => a + (p.value as number) / r.marketValue, 0)).toBeCloseTo(1, 10);
      // 모든 금액·가격 ×7 → 수익률은 그대로
      const k = 7;
      const scaled = L.map((t) => ({ ...t, price: t.price !== undefined ? t.price * k : undefined, amount: t.amount !== undefined ? t.amount * k : undefined, fee: t.fee !== undefined ? t.fee * k : undefined, tax: t.tax !== undefined ? t.tax * k : undefined }));
      const r2 = computeLedger(scaled, Object.fromEntries(Object.entries(prices).map(([s, p]) => [s, p * k])));
      if (r.totalReturnPct !== null) expect(r2.totalReturnPct as number).toBeCloseTo(r.totalReturnPct, 6);
      for (const v of [r.cash, r.totalAssets, r.unrealized, r.realized]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
