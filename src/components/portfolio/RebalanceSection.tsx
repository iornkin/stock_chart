"use client";
/** 내 자산 → 목표 비중: 목표 비중 저장, 이탈 알림, 매도 포함 / 추가 투자금 / 보유 현금·분배금으로 맞추는 거래 금액 계산 */
import { useEffect, useMemo, useState } from "react";
import { QUOTE_OLD_MS, useQuotes, useStrategies } from "@/lib/client/user-data";
import type { PortfolioSummary } from "@/lib/client/portfolio-summary";
import { driftAlerts, fullRebalance, newMoneyRebalance, type RebalPlan, type RebalPosition, type RebalResult } from "@/lib/portfolio/rebalance";
import type { PortfolioData, PortfolioTargets } from "@/lib/portfolio/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { formatEt, relativeTime } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import { Field, KV, parseNum, pct, Seg, signedUsd, SymbolField, usd } from "@/components/sim/common";

type Mode = "full" | "new" | "cash";
interface Row {
  symbol: string;
  weight: string;
}

const DEFAULT_DRIFT = 5;
const r2 = (v: number) => Math.round(v * 100) / 100;

export default function RebalanceSection({ p, s, save }: { p: PortfolioData; s: PortfolioSummary; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void> }) {
  const saved = p.targets;
  const strategies = useStrategies();
  const [rows, setRows] = useState<Row[]>(() => (saved?.items ?? []).map((i) => ({ symbol: i.symbol, weight: String(r2(i.weight)) })));
  const [drift, setDrift] = useState(String(saved?.driftPct ?? DEFAULT_DRIFT));
  const [fee, setFee] = useState(String(saved?.feePct ?? 0));
  const [mode, setMode] = useState<Mode>("full");
  const [amount, setAmount] = useState("");
  const [whole, setWhole] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 다른 탭에서 바뀐 저장값을 따라감 (편집 중이 아닐 때)
  const savedKey = JSON.stringify(saved ?? null);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  useEffect(() => {
    if (savedKey === syncedKey) return;
    setSyncedKey(savedKey);
    setRows((saved?.items ?? []).map((i) => ({ symbol: i.symbol, weight: String(r2(i.weight)) })));
    setDrift(String(saved?.driftPct ?? DEFAULT_DRIFT));
    setFee(String(saved?.feePct ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const items = rows.filter((r) => r.symbol.trim()).map((r) => ({ symbol: normalizeSymbol(r.symbol), weight: parseNum(r.weight) }));
  const targetSyms = items.map((i) => i.symbol).filter((x) => getInstrument(x));
  const held = s.holdings.filter((h) => h.shares > 0);
  // 보유하지 않은 목표 종목의 현재가
  const extra = targetSyms.filter((x) => !held.some((h) => h.symbol === x));
  const q = useQuotes(extra);
  const positions: RebalPosition[] = [...held.map((h) => ({ symbol: h.symbol, shares: h.shares, price: h.price })), ...extra.map((x) => ({ symbol: x, shares: 0, price: q.prices[x] ?? null }))];
  const sum = items.reduce((a, i) => a + (Number.isFinite(i.weight) ? i.weight : 0), 0);
  const cash = s.cash;
  const feePct = parseNum(fee);
  const driftPct = parseNum(drift);

  const problem = (() => {
    for (const i of items) {
      if (!getInstrument(i.symbol)) return `${i.symbol}: 지원하지 않는 종목입니다.`;
      if (!(i.weight >= 0)) return `${i.symbol}: 비중을 0% 이상으로 입력하세요.`;
    }
    if (new Set(items.map((i) => i.symbol)).size !== items.length) return "같은 종목이 두 번 들어 있습니다.";
    if (sum > 100 + 1e-9) return `목표 비중 합계가 ${r2(sum)}%입니다. 100% 이하로 맞추세요 (남는 비중은 현금 목표).`;
    if (!(feePct >= 0) || feePct > 5) return "수수료율은 0~5% 사이로 넣으세요.";
    if (!(driftPct > 0) || driftPct > 50) return "이탈 알림 기준은 0보다 크고 50%p 이하로 넣으세요.";
    return null;
  })();
  const dirty = JSON.stringify({ items, d: driftPct, f: feePct }) !== JSON.stringify({ items: saved?.items ?? [], d: saved?.driftPct ?? DEFAULT_DRIFT, f: saved?.feePct ?? 0 });

  const fillCurrent = () => {
    const total = s.totalAssets;
    if (!(total > 0) || s.missingPrices.length) {
      setMsg("현재가가 없는 종목이 있어 현재 비중을 계산할 수 없습니다.");
      return;
    }
    setRows(held.map((h) => ({ symbol: h.symbol, weight: String(r2(((h.value ?? 0) / total) * 100)) })));
    setMsg("현재 비중으로 채웠습니다 (현금 비중은 남는 비중). 원하는 목표로 고친 뒤 저장하세요.");
  };
  const loadStrategy = (id: string) => {
    const st = strategies.value.find((x) => x.id === id);
    if (!st) return;
    setRows(st.items.map((i) => ({ symbol: i.symbol, weight: String(r2(i.weight)) })));
    setMsg(`전략 '${st.name}'의 비중을 불러왔습니다. 저장해야 목표로 쓰입니다.`);
  };
  const doSave = async () => {
    if (problem) return;
    const t: PortfolioTargets = { items: items.filter((i) => i.weight > 0), driftPct, feePct, updatedAt: Date.now() };
    await save((cur) => ({ ...cur, targets: t }));
    setMsg("목표 비중을 이 브라우저에 저장했습니다.");
  };

  const pricesReady = !q.loading && !s.loading;
  const itemsKey = JSON.stringify(items);
  const calc = useMemo((): { base: RebalResult; withFee: RebalResult } | null => {
    if (problem || !items.length || !pricesReady) return null;
    const run = (f: number): RebalResult => {
      if (mode === "full") return fullRebalance(positions, cash, items, f, whole);
      const amt = parseNum(amount);
      return newMoneyRebalance(positions, cash, items, amt, { feePct: f, wholeShares: whole, fromCash: mode === "cash" });
    };
    return { base: run(0), withFee: run(feePct) };
    // positions 는 s·q 에서 나온 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, itemsKey, pricesReady, mode, amount, whole, feePct, cash, s.holdings, q.prices]);

  const alerts = saved?.items.length && pricesReady ? driftAlerts(positions, cash, saved.items, saved.driftPct) : [];

  // 시세 기준 (가장 오래된 시세)
  const quoteList = [...held.map((h) => s.quotes[h.symbol]), ...extra.map((x) => q.quotes[x])].filter(Boolean);
  const oldest = quoteList.reduce<(typeof quoteList)[number] | null>((a, x) => {
    const t = x.marketTime ?? x.fetchedAt;
    return !a || t < (a.marketTime ?? a.fetchedAt) ? x : a;
  }, null);

  return (
    <div className="flex flex-col gap-5">
      {saved?.items.length ? (
        alerts.length ? (
          <Notice tone="warn" title={`목표 비중에서 ${saved.driftPct}%p 넘게 벗어난 항목 ${alerts.length}개`}>
            {alerts.map((a) => `${a.symbol} 현재 ${pct(a.currentPct, 1).replace("+", "")} / 목표 ${pct(a.targetPct, 1).replace("+", "")} (${a.diffPct > 0 ? "+" : ""}${r2(a.diffPct)}%p)`).join(" · ")}
          </Notice>
        ) : pricesReady && !s.missingPrices.length ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">저장한 목표 비중에서 {saved.driftPct}%p 넘게 벗어난 종목이 없습니다.</p>
        ) : null
      ) : null}

      <Section title="목표 비중" description="종목별 목표 비중(%). 합이 100%보다 작으면 나머지는 현금 목표입니다.">
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={fillCurrent}>
            현재 비중으로 채우기
          </button>
          {strategies.value.length > 0 && (
            <select className="input max-w-56 py-1 text-sm" aria-label="저장한 전략 불러오기" value="" onChange={(e) => loadStrategy(e.target.value)}>
              <option value="">저장한 전략 불러오기…</option>
              {strategies.value.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-2" aria-label="목표 비중 입력">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-start gap-2">
              <SymbolField value={r.symbol} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, symbol: v } : x)))} label={`목표 종목 ${i + 1}`} />
              <div className="relative">
                <input value={r.weight} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, weight: e.target.value } : x)))} inputMode="decimal" aria-label={`목표 비중 ${i + 1}`} className="input w-full pr-6 text-right" />
                <span className="pointer-events-none absolute right-2 top-2 text-sm text-muted">%</span>
              </div>
              <button type="button" className="btn btn-sm mt-1" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`목표 ${r.symbol || i + 1} 삭제`}>
                삭제
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { symbol: "", weight: "" }])} disabled={rows.length >= 20}>
              + 종목 추가
            </button>
            <span className="num text-sm font-semibold" aria-live="polite">
              합계 {r2(sum)}% · 현금 목표 {r2(Math.max(0, 100 - sum))}%
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="이탈 알림 기준 (%p)" hint="현재 비중이 목표에서 이만큼 넘게 벗어나면 이 화면 위에 알립니다.">
            <input className="input" inputMode="decimal" value={drift} onChange={(e) => setDrift(e.target.value)} />
          </Field>
          <Field label="거래 수수료율 가정 (%)" hint="거래 금액에 곱하는 비용입니다. 쓰는 증권사의 수수료율을 넣으세요. 환전 비용·세금은 포함하지 않습니다.">
            <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </Field>
        </div>
        {problem && rows.length > 0 && <p className="mt-2 text-xs text-critical">{problem}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={doSave} disabled={!!problem || !dirty}>
            목표 저장
          </button>
          {saved && <span className="text-[11px] text-muted">저장: {formatEt(saved.updatedAt)}</span>}
          {msg && <span className="text-xs text-ink-2" role="status">{msg}</span>}
        </div>
      </Section>

      <Section
        title="맞추려면 얼마나 사고팔아야 하나"
        description="현재 보유 수량 × 현재가 기준 계산입니다. 주문은 직접 하세요."
        right={
          <Seg
            label="리밸런싱 방식"
            value={mode}
            onChange={(m) => {
              setMode(m);
              if (m === "cash") setAmount(String(r2(Math.max(0, cash))));
            }}
            options={[
              { v: "full", l: "매도 포함" },
              { v: "new", l: "추가 투자금만" },
              { v: "cash", l: "보유 현금·분배금만" },
            ]}
          />
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-ink-2">
          {mode === "full" && "지금 총자산 그대로 목표 비중에 맞춥니다. 많은 종목은 팔고 모자란 종목은 삽니다."}
          {mode === "new" && "팔지 않고, 새로 넣을 돈만으로 목표보다 모자란 종목을 모자란 금액 비율대로 삽니다. 모자란 금액을 다 채우고 남는 돈은 목표 비중대로 나눕니다."}
          {mode === "cash" && "팔지 않고, 계좌에 있는 현금(받은 분배금 포함)만으로 모자란 종목을 삽니다. 총자산은 그대로입니다."}
        </p>
        {mode !== "full" && (
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label={mode === "new" ? "새로 넣을 금액 (달러)" : "쓸 현금 (달러)"} hint={mode === "cash" ? `보유 현금 ${usd(cash)}` : undefined}>
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 1000" />
            </Field>
          </div>
        )}
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          정수 주로 계산 (소수점 거래를 못 하는 경우 — 사는 수량은 내림, 파는 수량은 올림)
        </label>
        {!items.length ? (
          <p className="text-sm text-muted">위에 목표 비중을 넣으면 계산합니다.</p>
        ) : problem ? (
          <p className="text-sm text-critical">{problem}</p>
        ) : !calc ? (
          <div className="skeleton h-40" aria-label="현재가 불러오는 중" />
        ) : !calc.withFee.ok ? (
          <Notice tone="warn" title="계산할 수 없습니다">{calc.withFee.error}</Notice>
        ) : (
          <PlanView plan={calc.withFee.plan} base={calc.base.ok ? calc.base.plan : null} feePct={feePct} mode={mode} />
        )}
        {oldest && (
          <p className={`mt-3 text-[11px] ${Date.now() - (oldest.marketTime ?? oldest.fetchedAt) > QUOTE_OLD_MS ? "text-warn" : "text-muted"}`}>
            계산에 쓴 시세: 가장 오래된 종목 {oldest.symbol} {formatEt(oldest.marketTime ?? oldest.fetchedAt)} ({relativeTime(oldest.marketTime ?? oldest.fetchedAt)}) · 출처 {oldest.source} · {oldest.delay?.text ?? "지연 데이터"}. 실제 체결 가격과 다를 수 있습니다.
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">매도하면 해외주식 양도소득세 대상이 될 수 있습니다(세금 탭 참고). 환전 비용·호가 차이는 반영하지 않았습니다. 계산 결과는 참고용이며 매매 권유가 아닙니다.</p>
      </Section>
    </div>
  );
}

function PlanView({ plan, base, feePct, mode }: { plan: RebalPlan; base: RebalPlan | null; feePct: number; mode: Mode }) {
  const cashAfterPct = (() => {
    const total = plan.rows.reduce((a, r) => a + r.afterValue, 0) + plan.cashAfter;
    return total > 0 ? (plan.cashAfter / total) * 100 : 0;
  })();
  return (
    <>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">현재가</th>
              <th className="r">평가금액</th>
              <th className="r">현재 비중</th>
              <th className="r">목표</th>
              <th className="r">차이</th>
              <th className="r">매수(+) / 매도(−)</th>
              <th className="r">수량</th>
              <th className="r">거래 후 비중</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={r.symbol}>
                <td className="font-semibold">{r.symbol}</td>
                <td className="r">{usd(r.price)}</td>
                <td className="r">{usd(r.value)}</td>
                <td className="r">{r2(r.currentPct)}%</td>
                <td className="r">{r2(r.targetPct)}%</td>
                <td className={`r ${Math.abs(r.diffPct) >= 0.005 ? (r.diffPct > 0 ? "text-warn" : "text-accent") : ""}`}>
                  {r.diffPct > 0 ? "+" : ""}
                  {r2(r.diffPct)}%p
                </td>
                <td className={`r font-semibold ${r.trade > 0.005 ? "text-good" : r.trade < -0.005 ? "text-critical" : "text-muted"}`}>{Math.abs(r.trade) < 0.005 ? "—" : signedUsd(r.trade)}</td>
                <td className="r">{Math.abs(r.shares) < 1e-9 ? "—" : `${r.shares > 0 ? "+" : ""}${Math.round(r.shares * 10000) / 10000}주`}</td>
                <td className="r">{r2(r.afterPct)}%</td>
              </tr>
            ))}
            <tr className="text-ink-2">
              <td>현금</td>
              <td />
              <td className="r">{usd(plan.cashBefore)}</td>
              <td className="r">{plan.total > 0 ? r2((plan.cashBefore / plan.total) * 100) : 0}%</td>
              <td className="r">{r2(plan.cashTargetPct)}%</td>
              <td className="r">{plan.total > 0 ? `${r2((plan.cashBefore / plan.total) * 100 - plan.cashTargetPct)}%p` : "-"}</td>
              <td className="r">{signedUsd(plan.cashAfter - plan.cashBefore)}</td>
              <td />
              <td className="r">{r2(cashAfterPct)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      {mode === "new" && <p className="mt-1 text-[11px] text-muted">현금 행의 현재 비중은 새로 넣을 금액을 더한 뒤 기준입니다.</p>}
      {plan.cashAfter < -0.005 && <Notice tone="warn" title="현금이 모자랍니다">거래 후 현금이 {usd(plan.cashAfter)}입니다. 목표 현금 비중을 늘리거나 금액을 줄이세요.</Notice>}
      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold text-ink-2">거래 비용 반영 전후</p>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th />
                <th className="r">매수 합계</th>
                <th className="r">매도 합계</th>
                <th className="r">거래 비용</th>
                <th className="r">거래 후 현금</th>
                <th className="r">목표와 최대 차이</th>
              </tr>
            </thead>
            <tbody>
              {base && (
                <tr>
                  <td>비용 없음</td>
                  <td className="r">{usd(base.buy)}</td>
                  <td className="r">{usd(base.sell)}</td>
                  <td className="r">{usd(0)}</td>
                  <td className="r">{usd(base.cashAfter)}</td>
                  <td className="r">{r2(base.maxDriftAfter)}%p</td>
                </tr>
              )}
              <tr className="font-semibold">
                <td>수수료 {feePct}% 가정</td>
                <td className="r">{usd(plan.buy)}</td>
                <td className="r">{usd(plan.sell)}</td>
                <td className="r">{usd(plan.fee)}</td>
                <td className="r">{usd(plan.cashAfter)}</td>
                <td className="r">{r2(plan.maxDriftAfter)}%p</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KV label="계산 기준 총자산" value={usd(plan.total)} sub="평가금액 + 현금" />
        <KV label="거래 금액 합계" value={usd(plan.buy + plan.sell)} />
        <KV label="거래 비용 (가정)" value={usd(plan.fee)} sub={`거래 금액 × ${feePct}%`} />
        <KV label="거래 후 목표와 최대 차이" value={`${r2(plan.maxDriftAfter)}%p`} sub="정수 주·비용 때문에 남는 차이" />
      </div>
    </>
  );
}
