"use client";
/**
 * 알림 확인기 — 이 사이트가 열려 있는 동안만 동작한다 (브라우저를 닫으면 확인하지 않음).
 * - 여러 탭이 열려 있으면 한 탭만 확인한다 (Web Locks).
 * - 15분마다, 화면으로 돌아왔을 때, 알림 화면의 '지금 확인'을 눌렀을 때 확인한다.
 * - 규칙·기준값·기록은 이 브라우저에만 저장하고 서버로 보내지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { useAlerts, usePortfolio, useQuotes, etToday } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { fetchExposure, fetchIncome } from "@/lib/client/data-api";
import { evaluateAlerts, type AlertContext } from "@/lib/alerts/evaluate";
import type { AlertRule, AlertsData } from "@/lib/alerts/types";
import { driftAlerts } from "@/lib/portfolio/rebalance";
import { EMPTY_PORTFOLIO, newId } from "@/lib/portfolio/types";
import { formatEt } from "@/lib/time";
import { BASE_PATH } from "@/lib/static-mode";

export const ALERT_CHECK_EVENT = "usi-alerts-check";
const INTERVAL_MS = 15 * 60_000;
const INCOME_KINDS = new Set(["dividend_change", "new_schedule", "ex_soon"]);
const EXPOSURE_KINDS = new Set(["expense_change", "holdings_change"]);

export default function AlertRunner() {
  const a = useAlerts();
  const [tick, setTick] = useState(0);
  const [leader, setLeader] = useState(false);

  // 한 탭만 확인 (먼저 연 탭이 닫히면 다음 탭이 이어받음)
  useEffect(() => {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) {
      setLeader(true);
      return;
    }
    let release: (() => void) | null = null;
    let alive = true;
    locks
      .request("usi-alerts", () => {
        if (!alive) return;
        setLeader(true);
        return new Promise<void>((res) => (release = res));
      })
      .catch(() => setLeader(true));
    return () => {
      alive = false;
      release?.();
    };
  }, []);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const id = window.setInterval(bump, INTERVAL_MS);
    const onVis = () => document.visibilityState === "visible" && bump();
    window.addEventListener(ALERT_CHECK_EVENT, bump);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(ALERT_CHECK_EVENT, bump);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const rules = a.value.rules.filter((r) => r.enabled);
  if (!leader || !a.loaded || !rules.length) return null;
  const rulesKey = rules.map((r) => `${r.id}:${r.kind}:${r.symbol ?? ""}:${r.op ?? ""}:${r.value ?? ""}:${r.days ?? ""}`).join("|");
  return <AlertEvaluator key={`${tick}:${rulesKey}`} rules={rules} set={a.set} />;
}

function AlertEvaluator({ rules, set }: { rules: AlertRule[]; set: (fn: (cur: AlertsData) => AlertsData) => Promise<void> }) {
  const needIncome = rules.some((r) => INCOME_KINDS.has(r.kind));
  const needExposure = rules.some((r) => EXPOSURE_KINDS.has(r.kind));
  const needPf = rules.some((r) => r.kind === "target_drift" || r.kind === "pnl");
  const priceSyms = [...new Set(rules.filter((r) => r.kind === "price" && r.symbol).map((r) => r.symbol as string))];
  const pf = usePortfolio();
  const s = usePortfolioSummary(needPf && pf.loaded ? pf.value : EMPTY_PORTFOLIO);
  const q = useQuotes(priceSyms);
  const [ext, setExt] = useState<{ done: boolean; income: AlertContext["income"]; exposure: AlertContext["exposure"] }>({ done: false, income: null, exposure: null });
  const ran = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([needIncome ? fetchIncome().then((r) => r.items).catch(() => null) : null, needExposure ? fetchExposure().then((r) => r.items).catch(() => null) : null]).then(([income, exposure]) => {
      if (alive) setExt({ done: true, income, exposure });
    });
    return () => {
      alive = false;
    };
  }, [needIncome, needExposure]);

  const ready = ext.done && (!priceSyms.length || !q.loading) && (!needPf || (pf.loaded && !s.loading));
  useEffect(() => {
    if (!ready || ran.current) return;
    ran.current = true;
    const p = pf.value;
    let portfolio: AlertContext["portfolio"] = null;
    if (needPf && !s.empty) {
      const priced = !s.missingPrices.length && !s.quotesError;
      const t = p.targets;
      portfolio = {
        totalReturnPct: priced ? s.totalReturnPct : null,
        asOf: s.oldestQuote ? formatEt(s.oldestQuote.marketTime ?? s.oldestQuote.fetchedAt) : null,
        drift: priced && t?.items.length ? driftAlerts(s.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, price: h.price })), s.cash, t.items, t.driftPct) : null,
        driftPct: t?.driftPct ?? null,
      };
    }
    const prices: AlertContext["prices"] = {};
    for (const sym of priceSyms) {
      const qq = q.quotes[sym];
      prices[sym] = { price: q.prices[sym] ?? null, asOf: qq ? formatEt(qq.marketTime ?? qq.fetchedAt) : null };
    }
    const now = Date.now();
    void set((cur) => {
      const out = evaluateAlerts(rules, cur.baseline, { today: etToday(), income: ext.income, exposure: ext.exposure, prices, portfolio });
      const seen = new Set(cur.log.map((e) => e.key));
      const fresh = out.events.filter((e) => !seen.has(e.key)).map((e) => ({ ...e, id: newId(), at: now, read: false }));
      if (fresh.length && cur.notify) void showNotifications(fresh);
      const ids = new Set(cur.rules.map((r) => r.id));
      const baseline = Object.fromEntries(Object.entries({ ...cur.baseline, ...out.baseline }).filter(([k]) => ids.has(k)));
      return { ...cur, baseline, log: [...fresh, ...cur.log].slice(0, 200), lastCheck: now };
    }).catch(() => {
      /* 저장 실패는 알림 화면에서 보임 */
    });
    // 한 번 마운트될 때 한 번만 확인 (다시 확인은 부모가 key 를 바꿔 새로 마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return null;
}

async function showNotifications(events: { title: string; body: string; key: string }[]) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    for (const e of events.slice(0, 5)) {
      const opts = { body: e.body, tag: e.key, icon: `${BASE_PATH}/icons/icon-192.png`, data: { url: `${BASE_PATH}/alerts` } };
      if (reg) await reg.showNotification(e.title, opts);
      else new Notification(e.title, opts);
    }
  } catch {
    /* 알림을 띄우지 못해도 기록은 남음 */
  }
}
