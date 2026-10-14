import { describe, expect, it } from "vitest";
import { evaluateAlerts, type AlertContext } from "@/lib/alerts/evaluate";
import type { AlertRule } from "@/lib/alerts/types";
import type { IncomeInfo } from "@/lib/sim/income";
import type { ExposureInfo } from "@/lib/exposure-types";

const rule = (o: Partial<AlertRule> & Pick<AlertRule, "kind">): AlertRule => ({ id: o.kind, enabled: true, createdAt: 0, symbol: "SCHD", ...o });
const income = (latest: { ex: string; amount: number }, upcoming: { ex: string; pay: string | null; amount: number }[] = []): Record<string, IncomeInfo> => ({
  SCHD: {
    symbol: "SCHD",
    kind: "etf",
    word: "분배금",
    asOf: "2026-10-14",
    price: 27,
    ttmPerShare: 1,
    ttmCount: 4,
    ttmSpecialPerShare: 0,
    ttmYield: 3.7,
    latest: { ...latest, pay: null, kind: "regular" },
    frequency: "quarterly",
    frequencyKo: "분기",
    perYear: 4,
    annualizedLatest: null,
    annualizedLatestYield: null,
    monthWeights: [],
    upcoming: upcoming.map((u) => ({ ...u, kind: "regular", status: "announced" as const })),
    recent: [],
  },
});
const ctx = (o: Partial<AlertContext> = {}): AlertContext => ({ today: "2026-10-14", income: null, exposure: null, prices: {}, portfolio: null, ...o });

describe("알림 판단", () => {
  it("변경 알림: 처음 확인할 때는 기준만 저장하고 알리지 않음, 금액이 바뀌면 알림", () => {
    const r = [rule({ kind: "dividend_change" })];
    const first = evaluateAlerts(r, {}, ctx({ income: income({ ex: "2026-09-24", amount: 0.26 }) }));
    expect(first.events).toHaveLength(0);
    const same = evaluateAlerts(r, first.baseline, ctx({ income: income({ ex: "2026-12-10", amount: 0.26 }) }));
    expect(same.events).toHaveLength(0);
    const changed = evaluateAlerts(r, same.baseline, ctx({ income: income({ ex: "2027-03-25", amount: 0.28 }) }));
    expect(changed.events).toHaveLength(1);
    expect(changed.events[0].body).toContain("+7.7%");
  });

  it("새 지급 일정: 기준 이후 처음 보는 배당락일만 알림", () => {
    const r = [rule({ kind: "new_schedule" })];
    const a = evaluateAlerts(r, {}, ctx({ income: income({ ex: "2026-09-24", amount: 0.26 }, [{ ex: "2026-12-10", pay: "2026-12-15", amount: 0.27 }]) }));
    expect(a.events).toHaveLength(0);
    const b = evaluateAlerts(r, a.baseline, ctx({ income: income({ ex: "2026-09-24", amount: 0.26 }, [{ ex: "2026-12-10", pay: "2026-12-15", amount: 0.27 }, { ex: "2027-03-20", pay: null, amount: 0.28 }]) }));
    expect(b.events.map((e) => e.key)).toEqual(["new_schedule:2027-03-20"]);
  });

  it("배당락 임박: 기간 안에 들면 한 번만 알림", () => {
    const r = [rule({ kind: "ex_soon", days: 3 })];
    const c = ctx({ income: income({ ex: "2026-09-24", amount: 0.26 }, [{ ex: "2026-10-16", pay: null, amount: 0.27 }, { ex: "2026-12-10", pay: null, amount: 0.27 }]) });
    const a = evaluateAlerts(r, {}, c);
    expect(a.events).toHaveLength(1);
    expect(a.events[0].key).toBe("ex_soon:2026-10-16");
    expect(evaluateAlerts(r, a.baseline, c).events).toHaveLength(0);
  });

  it("총보수·상위 편입 종목 변경", () => {
    const ex = (er: number, hs: string[]): Record<string, ExposureInfo> => ({
      SCHD: { symbol: "SCHD", kind: "etf", category: "dividend_growth", leverage: null, strategy: "dividend", holdings: hs.map((s) => ({ symbol: s, name: s, weight: 4, fund: false })), holdingsSource: "t", sectors: [], sectorsSource: null, stockSector: null, expenseRatio: er, fetchedAt: Date.UTC(2026, 9, 14) },
    });
    const rules = [rule({ kind: "expense_change", id: "e" }), rule({ kind: "holdings_change", id: "h" })];
    const a = evaluateAlerts(rules, {}, ctx({ exposure: ex(0.06, ["KO", "PEP"]) }));
    expect(a.events).toHaveLength(0);
    const b = evaluateAlerts(rules, a.baseline, ctx({ exposure: ex(0.07, ["KO", "MRK"]) }));
    expect(b.events.map((e) => e.kind).sort()).toEqual(["expense_change", "holdings_change"]);
    expect(b.events.find((e) => e.kind === "holdings_change")!.body).toBe("새로 들어옴: MRK · 빠짐: PEP");
  });

  it("가격·손익률: 조건이 새로 맞을 때만, 풀렸다 다시 맞으면 또 알림", () => {
    const r = [rule({ kind: "price", op: "above", value: 30 })];
    const at = (p: number) => ctx({ prices: { SCHD: { price: p, asOf: "2026-10-14" } } });
    const a = evaluateAlerts(r, {}, at(29));
    expect(a.events).toHaveLength(0);
    const b = evaluateAlerts(r, a.baseline, at(30.5));
    expect(b.events).toHaveLength(1);
    expect(evaluateAlerts(r, b.baseline, at(31)).events).toHaveLength(0);
    const down = evaluateAlerts(r, b.baseline, at(29));
    expect(evaluateAlerts(r, down.baseline, at(30)).events).toHaveLength(1);

    const pnl = [rule({ kind: "pnl", op: "below", value: -10, symbol: undefined })];
    const pf = (v: number) => ctx({ portfolio: { totalReturnPct: v, asOf: "x", drift: null, driftPct: null } });
    expect(evaluateAlerts(pnl, {}, pf(-12)).events).toHaveLength(1);
  });

  it("목표 비중 이탈: 새로 벗어난 종목만 알림", () => {
    const r = [rule({ kind: "target_drift", symbol: undefined })];
    const pf = (syms: string[]) => ctx({ portfolio: { totalReturnPct: 0, asOf: "x", driftPct: 5, drift: syms.map((s) => ({ symbol: s, currentPct: 60, targetPct: 50, diffPct: 10 })) } });
    const a = evaluateAlerts(r, {}, pf(["QQQ"]));
    expect(a.events).toHaveLength(1);
    expect(evaluateAlerts(r, a.baseline, pf(["QQQ"])).events).toHaveLength(0);
    expect(evaluateAlerts(r, a.baseline, pf(["QQQ", "SCHD"])).events.map((e) => e.title)).toEqual(["목표 비중 이탈: SCHD"]);
  });

  it("데이터가 없거나 꺼진 규칙은 건너뛰고 기준도 바꾸지 않음", () => {
    const r = [rule({ kind: "dividend_change" }), rule({ kind: "price", id: "p", op: "above", value: 1, enabled: false })];
    const out = evaluateAlerts(r, { dividend_change: { ex: "2026-09-24", amount: 0.26 } }, ctx({ prices: { SCHD: { price: 5, asOf: null } } }));
    expect(out.events).toHaveLength(0);
    expect(out.baseline).toEqual({ dividend_change: { ex: "2026-09-24", amount: 0.26 } });
  });
});
