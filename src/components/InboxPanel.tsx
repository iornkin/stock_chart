"use client";
/** 확인함: 알림 기록 + 데이터 점검 + 투자 기록 재검토 + 목표 비중 이탈 + 비중 집중을 한곳에 (이 브라우저에서만 계산) */
import Link from "next/link";
import { useMemo } from "react";
import { etToday, useAlerts, useJournal, usePortfolio } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { useDataCheck } from "@/components/portfolio/DataCheckSection";
import { CHECK_STATUS_KO } from "@/lib/portfolio/data-check";
import { driftAlerts } from "@/lib/portfolio/rebalance";
import { EMPTY_INBOX, INBOX_CATEGORY_KO, PRIORITY_KO, pruneInbox, visibleInbox, type InboxCategory, type InboxItem } from "@/lib/alerts/inbox";
import { formatEt } from "@/lib/time";
import { Section } from "@/components/ui";

const CONC_PCT = 35;
const SNOOZE_DAYS = 7;

export default function InboxPanel() {
  const a = useAlerts();
  const pf = usePortfolio();
  const s = usePortfolioSummary(pf.value);
  const j = useJournal();
  const check = useDataCheck(pf.value, s);
  const today = etToday();
  const st = a.value.inbox ?? EMPTY_INBOX;

  const items = useMemo((): InboxItem[] | null => {
    if (!a.loaded || !pf.loaded || !j.loaded) return null;
    const out: InboxItem[] = [];
    for (const e of a.value.log.filter((x) => !x.read)) out.push({ key: `alert:${e.id}`, category: "alert", priority: e.kind === "pnl" || e.kind === "target_drift" ? "high" : "medium", title: e.title, body: e.body, href: "/alerts", at: e.at });
    for (const c of check.items ?? []) {
      if (c.status === "ok") continue;
      out.push({ key: `data:${c.key}`, category: "data", priority: c.status === "error" ? "high" : c.status === "check" ? "medium" : "low", title: `${CHECK_STATUS_KO[c.status]} · ${c.title}`, body: c.cause, href: "/portfolio", at: null });
    }
    for (const e of j.value) {
      if (!e.reviewDate || e.reviewDate > today || e.reviews.some((r) => r.date >= (e.reviewDate as string))) continue;
      out.push({ key: `journal:${e.id}:${e.reviewDate}`, category: "journal", priority: "high", title: `${e.symbol} 투자 기록을 다시 볼 날 (${e.reviewDate})`, body: `${e.date} 기록: ${e.reason.slice(0, 80)}${e.reason.length > 80 ? "…" : ""}`, href: "/journal", at: null });
    }
    const t = pf.value.targets;
    if (t?.items.length && !s.loading && !s.missingPrices.length && !s.empty) {
      for (const d of driftAlerts(s.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, price: h.price })), s.cash, t.items, t.driftPct))
        out.push({ key: `drift:${d.symbol}:${d.diffPct > 0 ? "over" : "under"}`, category: "drift", priority: "medium", title: `목표 비중 이탈: ${d.symbol}`, body: `현재 ${d.currentPct.toFixed(1)}% / 목표 ${d.targetPct.toFixed(1)}% (${d.diffPct > 0 ? "+" : ""}${d.diffPct.toFixed(1)}%p, 기준 ${t.driftPct}%p)`, href: "/portfolio", at: null });
    }
    if (!s.loading && !s.missingPrices.length && s.totalAssets > 0)
      for (const h of s.holdings) {
        const w = ((h.value ?? 0) / s.totalAssets) * 100;
        if (w >= CONC_PCT) out.push({ key: `conc:${h.symbol}`, category: "concentration", priority: "low", title: `${h.symbol} 한 종목 비중 ${w.toFixed(1)}%`, body: `총자산의 ${CONC_PCT}% 이상이 한 종목입니다. 의도한 비중인지 확인하세요. (ETF 안의 간접 노출은 내 자산 → 노출 분석)`, href: "/portfolio", at: null });
      }
    return out;
  }, [a.loaded, a.value.log, pf.loaded, pf.value.targets, j.loaded, j.value, check.items, s, today]);

  if (!items) return <div className="skeleton h-32" aria-label="확인함 불러오는 중" />;
  const now = Date.now();
  const vis = visibleInbox(items, st, now);
  const setSt = (fn: (cur: typeof st) => typeof st) => void a.set((cur) => ({ ...cur, inbox: pruneInbox(fn(cur.inbox ?? EMPTY_INBOX), items.map((i) => i.key), now) }));
  const done = (i: InboxItem) => {
    if (i.category === "alert") void a.set((cur) => ({ ...cur, log: cur.log.map((e) => (`alert:${e.id}` === i.key ? { ...e, read: true } : e)) }));
    else setSt((cur) => ({ ...cur, done: { ...cur.done, [i.key]: now } }));
  };
  const snooze = (i: InboxItem) => setSt((cur) => ({ ...cur, snooze: { ...cur.snooze, [i.key]: now + SNOOZE_DAYS * 86400_000 } }));
  const mute = (c: InboxCategory) => window.confirm(`'${INBOX_CATEGORY_KO[c]}' 항목을 확인함에서 더 이상 보이지 않게 할까요? (아래 '끈 종류'에서 다시 켤 수 있음)`) && setSt((cur) => ({ ...cur, muted: [...new Set([...cur.muted, c])] }));
  const tone = { high: "border-critical/50", medium: "border-warn/50", low: "border-line" } as const;

  return (
    <Section title={`확인할 일 ${vis.length}건`} description="알림을 쌓아 두지 않고, 지금 확인할 것만 중요도 순으로 모았습니다. 같은 문제는 한 항목으로 갱신됩니다.">
      {vis.length ? (
        <ul className="flex flex-col gap-2">
          {vis.map((i) => (
            <li key={i.key} className={`rounded-lg border p-3 ${tone[i.priority]}`}>
              <p className="text-sm font-semibold">
                <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{PRIORITY_KO[i.priority]}</span>
                <span className="mr-1.5 text-[11px] font-normal text-muted">{INBOX_CATEGORY_KO[i.category]}</span>
                {i.title}
              </p>
              <p className="mt-0.5 text-xs text-ink-2">{i.body}</p>
              {i.at && <p className="text-[11px] text-muted">{formatEt(i.at)}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-sm" onClick={() => done(i)}>
                  확인 완료
                </button>
                {i.category !== "alert" && (
                  <button type="button" className="btn btn-sm" onClick={() => snooze(i)}>
                    {SNOOZE_DAYS}일 뒤 다시
                  </button>
                )}
                <Link className="btn btn-sm" href={i.href}>
                  관련 화면 열기
                </Link>
                {i.category !== "alert" && (
                  <button type="button" className="btn btn-sm" onClick={() => mute(i.category)}>
                    이 종류 끄기
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">지금 확인할 일이 없습니다.</p>
      )}
      {st.muted.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          끈 종류:{" "}
          {st.muted.map((c) => (
            <button key={c} type="button" className="btn btn-sm ml-1" onClick={() => setSt((cur) => ({ ...cur, muted: cur.muted.filter((x) => x !== c) }))}>
              {INBOX_CATEGORY_KO[c]} 다시 켜기
            </button>
          ))}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted">백테스트 결과와 실제 계좌의 차이, 공시·뉴스 알림은 아직 확인함에 넣지 않았습니다 (판단 기준을 정하기 어렵거나 사용자별 뉴스 판별이 필요해서).</p>
    </Section>
  );
}
