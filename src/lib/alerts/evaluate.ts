/**
 * 알림 규칙 판단 (순수 함수)
 *
 * - '변경' 알림(금액·총보수·편입 종목·새 일정)은 규칙을 만든 뒤 처음 본 값을 기준으로 삼고, 그다음 수집된 값이
 *   달라졌을 때만 알린다. 처음 확인할 때는 알리지 않는다 (이전 값을 모르므로 '바뀌었다'고 하지 않음).
 * - '상태' 알림(배당락 임박·가격·손익률·목표 이탈)은 조건이 새로 맞게 되었을 때 한 번 알리고,
 *   조건이 풀렸다가 다시 맞으면 또 알린다.
 * - 판단에 필요한 데이터가 없으면 그 규칙은 건너뛴다 (없는 값을 추정하지 않음).
 */
import type { ExposureInfo } from "@/lib/exposure-types";
import type { IncomeInfo } from "@/lib/sim/income";
import { addDays } from "@/lib/time";
import type { AlertEvent, AlertRule } from "./types";

export interface AlertContext {
  today: string;
  income: Record<string, IncomeInfo> | null;
  exposure: Record<string, ExposureInfo> | null;
  prices: Record<string, { price: number | null; asOf: string | null }>;
  portfolio: {
    totalReturnPct: number | null;
    asOf: string | null;
    /** 저장한 목표 비중에서 벗어난 항목 (목표가 없으면 null) */
    drift: { symbol: string; currentPct: number; targetPct: number; diffPct: number }[] | null;
    driftPct: number | null;
  } | null;
}

export type NewEvent = Omit<AlertEvent, "id" | "read" | "at">;

const usd4 = (v: number) => `$${v.toFixed(4).replace(/0{1,2}$/, "")}`;
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export function evaluateAlerts(rules: AlertRule[], baseline: Record<string, unknown>, ctx: AlertContext): { events: NewEvent[]; baseline: Record<string, unknown> } {
  const next: Record<string, unknown> = { ...baseline };
  const events: NewEvent[] = [];
  const push = (r: AlertRule, key: string, title: string, body: string, dataAsOf: string | null) => events.push({ ruleId: r.id, kind: r.kind, key: `${r.id}:${key}`, title, body, dataAsOf });

  for (const r of rules) {
    if (!r.enabled) continue;
    const sym = r.symbol ?? "";
    const prev = baseline[r.id];
    switch (r.kind) {
      case "dividend_change": {
        const info = ctx.income?.[sym];
        const l = info?.latest;
        if (!info || !l) break;
        const cur = { ex: l.ex, amount: l.amount };
        const p = prev as { ex: string; amount: number } | undefined;
        // 새 지급이 같은 금액이면 알리지 않음 (금액이 달라졌을 때만)
        if (p && p.amount > 0 && Math.abs(p.amount - cur.amount) > 1e-9) {
          push(r, `${cur.ex}:${cur.amount}`, `${sym} ${info.word} 금액 변경`, `최근 정기 지급 주당 ${usd4(p.amount)} → ${usd4(cur.amount)} (${pct((cur.amount / p.amount - 1) * 100)}) · 배당락 ${cur.ex}`, info.asOf);
        }
        next[r.id] = cur;
        break;
      }
      case "new_schedule": {
        const info = ctx.income?.[sym];
        if (!info) break;
        const ann = info.upcoming.filter((d) => d.ex > ctx.today);
        const seen = new Set((prev as string[] | undefined) ?? []);
        if (prev !== undefined) {
          for (const d of ann) if (!seen.has(d.ex)) push(r, d.ex, `${sym} 새 ${info.word} 일정 발표`, `배당락 ${d.ex} · 지급 ${d.pay ?? "미제공"} · 주당 ${usd4(d.amount)}`, info.asOf);
        }
        next[r.id] = [...new Set([...seen, ...ann.map((d) => d.ex)])].sort().slice(-24);
        break;
      }
      case "ex_soon": {
        const info = ctx.income?.[sym];
        if (!info) break;
        const days = Math.max(0, Math.round(r.days ?? 3));
        const until = addDays(ctx.today, days);
        const sent = new Set((prev as string[] | undefined) ?? []);
        for (const d of info.upcoming) {
          if (d.ex < ctx.today || d.ex > until || sent.has(d.ex)) continue;
          push(r, d.ex, `${sym} 배당락일 ${d.ex === ctx.today ? "오늘" : "임박"}`, `배당락 ${d.ex} (전날까지 보유해야 받음) · 지급 ${d.pay ?? "미제공"} · 주당 ${usd4(d.amount)}`, info.asOf);
          sent.add(d.ex);
        }
        next[r.id] = [...sent].sort().slice(-24);
        break;
      }
      case "expense_change": {
        const er = ctx.exposure?.[sym]?.expenseRatio;
        if (er === null || er === undefined) break;
        const p = prev as number | undefined;
        const at = ctx.exposure?.[sym]?.fetchedAt;
        if (p !== undefined && Math.abs(p - er) > 1e-6) push(r, `${er}`, `${sym} 총보수 변경`, `${p.toFixed(2)}% → ${er.toFixed(2)}% (제공처 기준)`, at ? new Date(at).toISOString().slice(0, 10) : null);
        next[r.id] = er;
        break;
      }
      case "holdings_change": {
        const info = ctx.exposure?.[sym];
        if (!info || !info.holdings.length) break;
        const cur = info.holdings.slice(0, 10).map((h) => h.symbol ?? h.name).sort();
        const p = prev as string[] | undefined;
        if (p) {
          const added = cur.filter((x) => !p.includes(x));
          const removed = p.filter((x) => !cur.includes(x));
          if (added.length || removed.length)
            push(r, cur.join(","), `${sym} 상위 편입 종목 변경`, `${added.length ? `새로 들어옴: ${added.join(", ")}` : ""}${added.length && removed.length ? " · " : ""}${removed.length ? `빠짐: ${removed.join(", ")}` : ""}`, info.fetchedAt ? new Date(info.fetchedAt).toISOString().slice(0, 10) : null);
        }
        next[r.id] = cur;
        break;
      }
      case "target_drift": {
        const pf = ctx.portfolio;
        if (!pf || pf.drift === null) break;
        const was = new Set((prev as string[] | undefined) ?? []);
        const now = pf.drift.map((d) => d.symbol);
        for (const d of pf.drift)
          if (!was.has(d.symbol)) push(r, `${d.symbol}:${ctx.today}`, `목표 비중 이탈: ${d.symbol}`, `현재 ${d.currentPct.toFixed(1)}% / 목표 ${d.targetPct.toFixed(1)}% (${d.diffPct > 0 ? "+" : ""}${d.diffPct.toFixed(1)}%p, 기준 ${pf.driftPct}%p)`, pf.asOf);
        next[r.id] = now;
        break;
      }
      case "price": {
        const q = ctx.prices[sym];
        if (!q || q.price === null || r.value === undefined) break;
        const hit = r.op === "below" ? q.price <= r.value : q.price >= r.value;
        if (hit && prev !== true) push(r, `${q.asOf ?? ctx.today}`, `${sym} 가격 ${r.op === "below" ? "이하" : "이상"} 도달`, `현재 $${q.price.toFixed(2)} (설정 $${r.value})`, q.asOf);
        next[r.id] = hit;
        break;
      }
      case "pnl": {
        const v = ctx.portfolio?.totalReturnPct;
        if (v === null || v === undefined || r.value === undefined) break;
        const hit = r.op === "below" ? v <= r.value : v >= r.value;
        if (hit && prev !== true) push(r, `${ctx.today}`, `내 자산 손익률 ${r.op === "below" ? "이하" : "이상"} 도달`, `현재 총수익률 ${pct(v)} (설정 ${r.value}%)`, ctx.portfolio?.asOf ?? null);
        next[r.id] = hit;
        break;
      }
    }
  }
  return { events, baseline: next };
}
