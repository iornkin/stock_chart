/**
 * 백테스트 설정 파일 (내보내기·불러오기) — 같은 설정으로 다시 계산해 결과를 재현할 때 쓴다.
 * 개인 자산 정보는 들어가지 않는다 (포트폴리오 비중과 계산 조건만).
 */
import type { CostMethod } from "@/lib/portfolio/tax";
import type { ContributionTiming, Rebalance } from "./backtest";

export const SETTINGS_FORMAT = "usi-backtest-settings";

export interface BacktestSettings {
  format: typeof SETTINGS_FORMAT;
  version: 1;
  portfolios: { name: string; items: { symbol: string; weight: number }[] }[];
  start: string;
  end: string;
  initial: number;
  monthly: number;
  timing: ContributionTiming;
  reinvest: boolean;
  rebalance: Rebalance;
  costPct: number;
  taxPct: number;
  rfMode: "auto" | "manual";
  riskFreePct: number;
  benchmark: string | null;
  normalize: boolean;
  capitalGains: { method: CostMethod; fxMode: "historical" | "fixed"; fixedFx: number | null } | null;
  /** 내보낼 때의 재현 코드와 핵심 결과 (참고용 — 불러올 때 계산에 쓰지 않음) */
  check?: { configCodes: string[]; dataCode: string; summary: { name: string; finalValue: number; twrReturnPct: number }[]; exportedAt: string };
}

const REBAL: Rebalance[] = ["none", "monthly", "quarterly", "semiannual", "annual"];
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** 불러온 파일 확인 — 모르는 형식이나 범위를 벗어난 값은 적용하지 않는다 */
export function parseSettings(x: unknown): { ok: true; settings: BacktestSettings } | { ok: false; error: string } {
  if (!x || typeof x !== "object") return { ok: false, error: "JSON 객체가 아닙니다." };
  const o = x as Record<string, unknown>;
  if (o.format !== SETTINGS_FORMAT) return { ok: false, error: "이 사이트에서 내보낸 백테스트 설정 파일이 아닙니다." };
  if (o.version !== 1) return { ok: false, error: `지원하지 않는 설정 버전입니다 (${String(o.version)}).` };
  if (!Array.isArray(o.portfolios) || !o.portfolios.length || o.portfolios.length > 4) return { ok: false, error: "포트폴리오는 1~4개여야 합니다." };
  for (const p of o.portfolios as Record<string, unknown>[]) {
    if (!p || typeof p.name !== "string" || !Array.isArray(p.items) || !p.items.length) return { ok: false, error: "포트폴리오 형식이 올바르지 않습니다." };
    for (const it of p.items as Record<string, unknown>[]) if (!it || typeof it.symbol !== "string" || !num(it.weight)) return { ok: false, error: "종목·비중 형식이 올바르지 않습니다." };
  }
  if (!isDate(o.start) || !isDate(o.end)) return { ok: false, error: "시작일·종료일 형식이 올바르지 않습니다." };
  if (!num(o.initial) || !num(o.monthly) || !num(o.costPct) || !num(o.taxPct) || !num(o.riskFreePct)) return { ok: false, error: "금액·비율 값이 올바르지 않습니다." };
  if (o.timing !== "month_start" && o.timing !== "month_end") return { ok: false, error: "납입 시점 값이 올바르지 않습니다." };
  if (!REBAL.includes(o.rebalance as Rebalance)) return { ok: false, error: "리밸런싱 값이 올바르지 않습니다." };
  const cg = o.capitalGains as Record<string, unknown> | null | undefined;
  if (cg && ((cg.method !== "fifo" && cg.method !== "average") || (cg.fxMode !== "historical" && cg.fxMode !== "fixed"))) return { ok: false, error: "양도소득세 설정이 올바르지 않습니다." };
  return {
    ok: true,
    settings: {
      format: SETTINGS_FORMAT,
      version: 1,
      portfolios: (o.portfolios as { name: string; items: { symbol: string; weight: number }[] }[]).map((p) => ({ name: p.name.slice(0, 60), items: p.items.slice(0, 10).map((i) => ({ symbol: i.symbol.toUpperCase(), weight: i.weight })) })),
      start: o.start as string,
      end: o.end as string,
      initial: o.initial as number,
      monthly: o.monthly as number,
      timing: o.timing as ContributionTiming,
      reinvest: Boolean(o.reinvest),
      rebalance: o.rebalance as Rebalance,
      costPct: o.costPct as number,
      taxPct: o.taxPct as number,
      rfMode: o.rfMode === "manual" ? "manual" : "auto",
      riskFreePct: o.riskFreePct as number,
      benchmark: typeof o.benchmark === "string" && o.benchmark ? o.benchmark.toUpperCase() : null,
      normalize: Boolean(o.normalize),
      capitalGains: cg ? { method: cg.method as CostMethod, fxMode: cg.fxMode as "historical" | "fixed", fixedFx: num(cg.fixedFx) ? (cg.fixedFx as number) : null } : null,
      check: o.check as BacktestSettings["check"],
    },
  };
}
