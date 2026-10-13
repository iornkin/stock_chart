"use client";
/** 내 자산 — 간편 입력 / 거래 내역 관리, 수익률(달러 기준·원화 기준), 비중, 분배금, 세금, 자산 가치 변화 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePortfolio, useSeriesMap, etToday, QUOTE_OLD_MS } from "@/lib/client/user-data";
import { usePortfolioReturns } from "@/lib/client/portfolio-returns";
import type { PortfolioReturns, ReturnFigures } from "@/lib/portfolio/returns";
import { usePortfolioSummary, type PortfolioSummary } from "@/lib/client/portfolio-summary";
import { computeLedger, convertSimpleToLedger, ledgerTimeline } from "@/lib/portfolio/ledger";
import { newId, TXN_KO, type PortfolioData, type SimpleHolding, type Txn, type TxnType } from "@/lib/portfolio/types";
import { closeOn, type PriceSeries } from "@/lib/sim/series";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { formatEt, relativeTime, addDays } from "@/lib/time";
import { Notice, Section, Empty } from "@/components/ui";
import { categoryOf, Field, KV, LocalOnlyNote, parseNum, pct, Seg, signedKrw, signedUsd, SymbolField, tone, usd, krw } from "@/components/sim/common";
import { SimLineChart, WeightBars } from "@/components/sim/charts";
import PanelTabs from "@/components/PanelTabs";
import TaxSection from "./TaxSection";
import { fetchSeries } from "@/lib/client/data-api";

export type Basis = "usd" | "krw";
const BASIS_KEY = "usi-portfolio-basis";

export default function PortfolioClient() {
  const store = usePortfolio();
  const p = store.value;
  const s = usePortfolioSummary(p);
  const ret = usePortfolioReturns(p, s);
  const today = etToday();
  // 달러 기준 / 원화 기준(환율 반영) — 이 브라우저에 기억
  const [basis, setBasisState] = useState<Basis>("usd");
  useEffect(() => {
    try {
      if (localStorage.getItem(BASIS_KEY) === "krw") setBasisState("krw");
    } catch {
      /* 무시 */
    }
  }, []);
  const setBasis = (b: Basis) => {
    setBasisState(b);
    try {
      localStorage.setItem(BASIS_KEY, b);
    } catch {
      /* 무시 */
    }
  };
  // 처음 열었을 때 비어 있었다면, 첫 종목을 넣은 뒤에도 입력 탭을 계속 보여 준다
  const [startedEmpty, setStartedEmpty] = useState<boolean | null>(null);
  useEffect(() => {
    if (store.loaded && startedEmpty === null) setStartedEmpty(s.empty);
  }, [store.loaded, s.empty, startedEmpty]);

  // 간편 입력: 하루 한 번 평가금액 기록 (시세가 모두 있을 때만)
  useEffect(() => {
    if (!store.loaded || p.mode !== "simple" || s.loading || s.missingPrices.length || !s.holdings.length) return;
    const last = p.snapshots?.[p.snapshots.length - 1];
    if (last?.date === today) return;
    store.set((cur) => ({ ...cur, snapshots: [...(cur.snapshots ?? []), { date: today, totalAssets: s.totalAssets, cost: s.totalCost }].slice(-1000) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, p.mode, s.loading, s.missingPrices.length, s.holdings.length, today]);

  if (!store.loaded) return <div className="skeleton h-64" aria-label="저장된 자산을 불러오는 중" />;

  const save = (fn: (cur: PortfolioData) => PortfolioData) => store.set((cur) => ({ ...fn(cur), updatedAt: Date.now() }));
  const view: View = { r: ret.r, basis };

  const tabs = [
    { key: "holdings", label: "보유 종목", content: <HoldingsSection s={s} v={view} /> },
    { key: "income", label: "분배금", content: <DividendSection s={s} /> },
    { key: "tax", label: "세금", content: <TaxSection p={p} s={s} /> },
    { key: "history", label: "자산 추이", content: <HistorySection p={p} s={s} /> },
    { key: "input", label: p.mode === "simple" ? "보유 종목 입력" : "거래 입력·내역", content: <InputSection p={p} save={save} s={s} v={view} /> },
  ];
  return (
    <div className="flex flex-col gap-5">
      {store.error && <Notice tone="critical" title="저장 오류">{store.error}</Notice>}
      <SummarySection s={s} v={view} setBasis={setBasis} fxTime={ret.fxTime} fxSource={ret.fxSource} loading={ret.loading} />
      {s.empty ? <InputSection p={p} save={save} s={s} v={view} /> : <PanelTabs label="내 자산 화면" tabs={tabs} initial={startedEmpty ? "input" : "holdings"} />}
      <LocalOnlyNote what="입력한 보유 종목·거래 내역·현금·메모" />
    </div>
  );
}

/** 화면 전체가 같은 기준(달러/원화)으로 보이도록 함께 넘기는 값 */
interface View {
  r: PortfolioReturns;
  basis: Basis;
}

/** 선택한 기준의 숫자 (원화 기준을 계산할 수 없으면 null) */
function pick<T extends { usd: ReturnFigures; krw: ReturnFigures | null }>(x: T, basis: Basis): ReturnFigures | null {
  return basis === "usd" ? x.usd : x.krw;
}
const money = (v: number | null | undefined, basis: Basis) => (basis === "usd" ? usd(v) : krw(v));
const signed = (v: number | null | undefined, basis: Basis) => (basis === "usd" ? signedUsd(v) : signedKrw(v));

// ─────────────────────────────── 요약 ───────────────────────────────

function QuoteBasis({ s }: { s: PortfolioSummary }) {
  const q = s.oldestQuote;
  if (s.quotesError) return <Notice tone="critical" title="시세를 불러오지 못했습니다">{s.quotesError} — 평가금액을 계산하지 않았습니다.</Notice>;
  if (!q) return null;
  const t = q.marketTime ?? q.fetchedAt;
  const old = Date.now() - t > QUOTE_OLD_MS;
  return (
    <p className={`text-[11px] ${old ? "text-warn" : "text-muted"}`}>
      평가 기준 시세: 가장 오래된 종목 {q.symbol} {formatEt(t)} ({relativeTime(t)}) · 출처 {q.source} · {q.delay?.text ?? "지연 데이터"}
      {old && " — 최근 시세가 아닙니다. 데이터 상태 화면에서 수집 상황을 확인하세요."}
    </p>
  );
}

function SummarySection({ s, v, setBasis, fxTime, fxSource, loading }: { s: PortfolioSummary; v: View; setBasis: (b: Basis) => void; fxTime: number | null; fxSource: string | null; loading: boolean }) {
  if (s.empty)
    return (
      <Notice title="아직 입력한 자산이 없습니다">
        아래에서 보유 종목을 입력하면 총자산·수익률·분배금을 계산합니다. 입력 전에는 어떤 금액도 표시하지 않습니다.
      </Notice>
    );
  const { r, basis } = v;
  const ledger = r.mode === "ledger";
  const a = basis === "usd" ? r.usd : r.krw;
  const missing = s.missingPrices.length > 0;
  return (
    <section className="card p-4 sm:p-6" aria-label="자산 요약">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold tracking-tight">내 투자 성과</h2>
        <Seg label="수익률 기준" value={basis} onChange={setBasis} options={[{ v: "usd", l: "달러 기준" }, { v: "krw", l: "원화 기준 (환율 반영)" }]} />
      </div>
      {missing && (
        <div className="mb-3">
          <Notice tone="warn" title="시세 없는 종목">
            {s.missingPrices.join(", ")}의 시세가 없어 평가금액·수익률을 계산하지 않았습니다 (0으로 간주하지 않음).
          </Notice>
        </div>
      )}
      {basis === "krw" && !r.krw ? (
        <Notice tone="warn" title="원화 기준으로 계산할 수 없습니다">
          {loading ? "환율 기록을 불러오는 중입니다." : r.krwUnavailable.join(" ") || "환율 정보가 부족합니다."}
        </Notice>
      ) : (
        a && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4">
            <BigStat label="총자산" value={money(a.totalAssets, basis)} sub={`현금 ${basis === "usd" ? usd(s.cash) : krw(r.fxNow ? s.cash * r.fxNow : null)} 포함`} />
            <BigStat
              label="총수익률"
              value={pct(a.totalReturnPct)}
              valueClass={tone(a.totalReturnPct)}
              sub={
                <>
                  <span className={tone(a.totalGain)}>{signed(a.totalGain, basis)}</span> · {ledger ? `투자 원금 ${money(a.invested, basis)} 대비` : r.dividendsEstimated ? "분배금(추정) 포함" : "매수 원가 대비"}
                </>
              }
            />
            <BigStat label="평가 수익률" value={pct(a.unrealizedPct)} valueClass={tone(a.unrealizedPct)} sub={<><span className={tone(a.unrealized)}>{signed(a.unrealized, basis)}</span> · 지금 보유한 종목만</>} />
            {basis === "krw" ? (
              <BigStat
                label="환율 효과"
                value={signed(a.fxEffect, basis)}
                valueClass={tone(a.fxEffect)}
                sub={a.fxEffect !== null && a.fxEffect !== undefined ? (a.fxEffect >= 0 ? "환차익 (원/달러가 오른 만큼)" : "환차손 (원/달러가 내린 만큼)") : undefined}
              />
            ) : (
              <BigStat
                label={ledger ? "받은 분배금 (세후)" : "받은 분배금 (추정)"}
                value={a.dividends !== null ? usd(a.dividends) : "-"}
                sub={ledger ? `실현 손익 ${signedUsd(a.realized)}` : r.dividendsEstimated ? "최초 매수일 이후 실제 지급 × 지금 수량 · 세후 15%" : "최초 매수일을 넣으면 추정합니다"}
              />
            )}
          </div>
        )
      )}
      {r.usd.totalReturnPct !== null && r.krw?.totalReturnPct !== null && r.krw && (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          총수익률 · 달러 기준 <b className={`num ${tone(r.usd.totalReturnPct)}`}>{pct(r.usd.totalReturnPct)}</b> → 원화 기준{" "}
          <b className={`num ${tone(r.krw.totalReturnPct)}`}>{pct(r.krw.totalReturnPct)}</b>
          <span className="text-xs text-muted"> (환율 효과 {signedKrw(r.krw.fxEffect)})</span>
        </p>
      )}
      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-2">
        <QuoteBasis s={s} />
        {basis === "krw" && r.fxNow && (
          <p className="text-[11px] text-muted">
            현재 환율 ₩{r.fxNow.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ({fxTime ? formatEt(fxTime) : "-"} · {fxSource ?? "-"}) · 매수·매도·분배금은 그때 환율
            {r.fxEstimated > 0 && ` (환율을 적지 않은 ${r.fxEstimated}건은 그날 원/달러 종가로 근사)`}
          </p>
        )}
      </div>
    </section>
  );
}

function BigStat({ label, value, sub, valueClass = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-0.5 text-xl font-bold leading-tight sm:text-2xl ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function HoldingsSection({ s, v }: { s: PortfolioSummary; v: View }) {
  const { r, basis } = v;
  const byType = new Map<string, number>();
  for (const h of s.holdings) byType.set(categoryOf(h.symbol), (byType.get(categoryOf(h.symbol)) ?? 0) + (h.value ?? 0));
  if (s.cash > 0) byType.set("현금", s.cash);
  const ledger = r.mode === "ledger";
  return (
    <div className="flex flex-col gap-5">
      <Section title="종목별 수익률" description={`${basis === "usd" ? "달러 기준" : "원화 기준 (환율 반영)"} · 총손익 = 평가손익 + 실현손익 + 받은 분배금(세후) · 총수익률 = 총손익 ÷ 총 매수 금액`}>
        {/* 휴대폰: 종목마다 핵심 숫자만 카드로 */}
        <ul className="flex flex-col divide-y divide-line sm:hidden">
          {r.holdings.map((h) => {
            const f = pick(h, basis);
            return (
              <li key={h.symbol} className="py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/stock/${h.symbol}`} className="font-semibold">
                    {h.symbol} <span className="text-[11px] font-normal text-muted">{h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}주</span>
                  </Link>
                  <span className="num text-sm">{f ? money(f.value, basis) : "-"}</span>
                </div>
                {f ? (
                  <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted">평가 수익률</dt>
                      <dd className={`num font-semibold ${tone(f.unrealizedPct)}`}>{pct(f.unrealizedPct)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">총수익률</dt>
                      <dd className={`num font-semibold ${tone(f.totalReturnPct)}`}>{pct(f.totalReturnPct)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{basis === "krw" ? "환율 효과" : ledger ? "받은 분배금" : "분배금 (추정)"}</dt>
                      <dd className={`num ${basis === "krw" ? tone(f.fxEffect) : ""}`}>{basis === "krw" ? signed(f.fxEffect, basis) : f.dividends !== null ? money(f.dividends, basis) : "-"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-xs text-muted">매수 환율을 알 수 없어 원화 기준으로 계산하지 않았습니다</p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th className="r">수량</th>
                <th className="r">평균 단가</th>
                <th className="r">현재가</th>
                {basis === "krw" && <th className="r">매수 환율</th>}
                <th className="r">평가금액</th>
                <th className="r">평가손익 (수익률)</th>
                <th className="r">{ledger ? "받은 분배금" : "분배금 (추정)"}</th>
                <th className="r">총손익 (총수익률)</th>
                {basis === "krw" && <th className="r">환율 효과</th>}
              </tr>
            </thead>
            <tbody>
              {r.holdings.map((h) => {
                const f = pick(h, basis);
                return (
                  <tr key={h.symbol}>
                    <td>
                      <Link href={`/stock/${h.symbol}`} className="font-semibold hover:text-accent">
                        {h.symbol}
                      </Link>
                      <span className="ml-1 text-[11px] text-muted">{getInstrument(h.symbol)?.nameKo}</span>
                    </td>
                    <td className="r">{h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="r">{usd(h.avgCost)}</td>
                    <td className="r">{usd(h.price)}</td>
                    {basis === "krw" && <td className="r">{h.krw?.cost && h.usd.cost ? `₩${(h.krw.cost / h.usd.cost).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}` : "-"}</td>}
                    {f ? (
                      <>
                        <td className="r">{money(f.value, basis)}</td>
                        <td className={`r ${tone(f.unrealized)}`}>
                          {signed(f.unrealized, basis)}
                          <span className="block text-[11px]">{pct(f.unrealizedPct)}</span>
                        </td>
                        <td className="r">{f.dividends !== null ? money(f.dividends, basis) : "-"}</td>
                        <td className={`r font-semibold ${tone(f.totalGain)}`}>
                          {signed(f.totalGain, basis)}
                          <span className="block text-[11px]">{pct(f.totalReturnPct)}</span>
                        </td>
                        {basis === "krw" && <td className={`r ${tone(f.fxEffect)}`}>{signed(f.fxEffect, basis)}</td>}
                      </>
                    ) : (
                      <td className="text-xs text-muted" colSpan={basis === "krw" ? 5 : 4}>
                        매수 환율을 알 수 없어 원화 기준으로 계산하지 않았습니다
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ledger && <p className="mt-2 text-[11px] text-muted">모두 매도한 종목의 실현손익·분배금은 위 &lsquo;총수익률&rsquo;(계좌 전체)에 들어 있습니다.</p>}
      </Section>
      {s.missingPrices.length ? (
        <Notice tone="warn">{s.missingPrices.join(", ")} 시세가 없어 비중을 계산하지 않았습니다.</Notice>
      ) : (
        <Section title="비중">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-2">종목별 (현금 포함)</p>
              <WeightBars items={[...s.holdings.map((h) => ({ label: h.symbol, value: h.value ?? 0 })), ...(s.cash > 0 ? [{ label: "현금", value: s.cash }] : [])].sort((a, b) => b.value - a.value)} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-2">ETF 유형·자산 분류별</p>
              <WeightBars items={[...byType.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} />
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function DividendSection({ s }: { s: PortfolioSummary }) {
  const ledger = s.mode === "ledger";
  return (
    <Section title="배당·분배금" description="실제 받은 금액과 추정치를 나눠 표시 (추정치는 확정 수입이 아님)">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KV label="실제 누적 수령 (세전)" value={ledger ? usd(s.dividendsActualTotal) : "기록 없음"} sub={ledger ? "입력한 분배금 수령·재투자 기록 합계" : "거래 내역 모드에서 기록"} />
        <KV label="최근 12개월 실제 수령" value={ledger ? usd(s.dividendsActualTtm) : "기록 없음"} sub={ledger ? `세후 ${usd(s.dividendsActualTtmNet)}` : undefined} />
        <KV label="예상 연간 분배금 (추정)" value={usd(s.expectedAnnual)} sub="현재 보유 수량 × 최근 12개월 실제 주당 지급액 — 확정 아님" />
        <KV label="최근 지급액 단순 연환산 (가정)" value={usd(s.expectedAnnualSimple)} sub="최근 1회 지급액 × 연 지급 횟수 — 같은 금액이 계속된다는 가정" />
      </div>
      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold text-ink-2">이번 달 지급 일정 (확인된 기록만)</p>
        {s.thisMonth.length ? (
          <ScheduleTable items={s.thisMonth} />
        ) : (
          <p className="text-sm text-muted">이번 달에 지급일(또는 배당락일)이 있는 확인된 지급 기록이 없습니다. 아직 발표되지 않은 지급은 표시하지 않습니다.</p>
        )}
      </div>
      {s.upcoming.filter((u) => !s.thisMonth.includes(u)).length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold text-accent">이후 발표된 지급 {s.upcoming.filter((u) => !s.thisMonth.includes(u)).length}건 보기</summary>
          <div className="mt-2">
            <ScheduleTable items={s.upcoming.filter((u) => !s.thisMonth.includes(u))} />
          </div>
        </details>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">금액 = 현재 보유 수량 × 발표된 주당 지급액. 배당락일 전날 보유 수량이 달랐다면 실제 금액과 다릅니다. 분배금은 바뀔 수 있으며, 분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다(분배만큼 가격이 내려가고 원금이 돌려받아지는 경우도 있음).</p>
    </Section>
  );
}

function ScheduleTable({ items }: { items: PortfolioSummary["thisMonth"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-basic">
        <thead>
          <tr>
            <th>종목</th>
            <th>배당락일</th>
            <th>지급일</th>
            <th className="r">주당</th>
            <th className="r">예상 금액(세전)</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={`${u.symbol}-${u.ex}`}>
              <td className="font-semibold">{u.symbol}</td>
              <td className="num">{u.ex}</td>
              <td className="num">{u.pay ?? <span className="text-muted">미제공</span>}</td>
              <td className="r">${u.perShare.toFixed(4)}</td>
              <td className="r">{usd(u.amount)}</td>
              <td className="text-xs">{u.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────── 자산 가치 변화 ───────────────────────────────

function HistorySection({ p, s }: { p: PortfolioData; s: PortfolioSummary }) {
  const symbols = p.mode === "ledger" ? [...new Set(p.ledger.map((t) => t.symbol).filter((x): x is string => !!x)), "SPY"] : [];
  const ser = useSeriesMap(symbols);
  const tl = useMemo(() => {
    if (p.mode !== "ledger" || ser.loading || !p.ledger.length) return null;
    const first = [...p.ledger].sort((a, b) => a.date.localeCompare(b.date))[0].date;
    const cal = (ser.series.SPY?.dates ?? []).filter((d) => d >= first);
    return ledgerTimeline(p.ledger, cal, (sym, d) => {
      const x = ser.series[sym];
      return x ? (closeOn(x, d)?.close ?? null) : null;
    });
  }, [p, ser]);
  if (p.mode === "simple") {
    const snaps = p.snapshots ?? [];
    return (
      <Section title="자산 가치 변화" description="간편 입력은 이 사이트를 연 날의 평가금액만 기록합니다 (과거를 추정해 채우지 않음)">
        {snaps.length >= 2 ? (
          <SimLineChart dates={snaps.map((x) => x.date)} lines={[{ key: "v", label: "총자산", values: snaps.map((x) => x.totalAssets), area: true }, { key: "c", label: "매수 원가", values: snaps.map((x) => x.cost), dashed: true, color: "--s2" }]} format="usd" ariaLabel="기록된 총자산 추이" />
        ) : (
          <Empty>기록이 {snaps.length}일치뿐입니다. 다른 날 다시 열면 그날의 평가금액이 쌓입니다.</Empty>
        )}
      </Section>
    );
  }
  return (
    <Section title="자산 가치 변화" description="거래 내역과 일별 종가로 다시 계산 · 점선은 순납입 원금">
      {ser.loading && <div className="skeleton h-56" />}
      {Object.keys(ser.errors).filter((k) => k !== "SPY").length > 0 && <Notice tone="warn">일별 가격을 불러오지 못한 종목: {Object.keys(ser.errors).join(", ")}</Notice>}
      {tl && tl.dates.length >= 2 ? (
        <SimLineChart dates={tl.dates} lines={[{ key: "v", label: "총자산", values: tl.value, area: true }, { key: "c", label: "순납입 원금", values: tl.contributed, dashed: true, color: "--s2" }]} format="usd" ariaLabel="총자산과 순납입 원금 추이" />
      ) : (
        !ser.loading && <Empty>거래일이 2일 이상 쌓이면 표시합니다.</Empty>
      )}
      {s.issues.length > 0 && <p className="mt-2 text-[11px] text-warn">거래 내역에 확인할 항목이 있어 일부 기록이 계산에서 빠졌을 수 있습니다.</p>}
    </Section>
  );
}

// ─────────────────────────────── 입력 ───────────────────────────────

function InputSection({ p, save, s, v }: { p: PortfolioData; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void>; s: PortfolioSummary; v: View }) {
  const convert = () => {
    const holdings = p.simple.holdings.filter((h) => h.shares > 0);
    const msg = `간편 입력을 거래 내역으로 전환합니다.\n\n- 보유 종목 ${holdings.length}개 → '기초 보유' 기록 (현금 이동 없음)\n- 현금 ${usd(p.simple.cash)} → '입금' 기록\n\n전환 후에는 거래 내역만 계산에 쓰므로 수량·원가가 두 번 계산되지 않습니다. 계속할까요?`;
    if (!window.confirm(msg)) return;
    const today = etToday();
    save((cur) => ({ ...cur, mode: "ledger", ledger: [...convertSimpleToLedger(cur.simple.holdings, cur.simple.cash, cur.simple.cashFx, today, newId), ...cur.ledger], simple: { holdings: [], cash: 0 }, convertedAt: Date.now() }));
  };
  return (
    <Section
      title={p.mode === "simple" ? "간편 입력" : "거래 내역"}
      id="input"
      description={
        p.mode === "simple"
          ? "보유 수량과 평균 매수 단가만 입력합니다. 나중에 거래 내역 관리로 전환할 수 있습니다."
          : "매수·매도·입출금·분배금 수령·재투자를 날짜별로 기록합니다. 외부 입출금은 투자 손익에서 빠집니다."
      }
      right={
        p.mode === "simple" ? (
          <button type="button" className="btn btn-sm" onClick={convert}>
            거래 내역 관리로 전환
          </button>
        ) : (
          <span className="text-xs text-muted">{p.convertedAt ? `간편 입력에서 전환됨 (${new Date(p.convertedAt).toLocaleDateString("ko-KR")})` : ""}</span>
        )
      }
    >
      {p.mode === "simple" ? <SimpleEditor p={p} save={save} v={v} /> : <LedgerEditor p={p} save={save} s={s} />}
    </Section>
  );
}

/** 입력 목록 옆에 바로 보여 주는 종목 수익률 (선택한 기준) */
function rowReturn(v: View, symbol: string): number | null {
  const h = v.r.holdings.find((x) => x.symbol === symbol);
  return h ? (pick(h, v.basis)?.totalReturnPct ?? null) : null;
}

function SimpleEditor({ p, save, v }: { p: PortfolioData; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void>; v: View }) {
  const blank = { symbol: "", shares: "", avgCost: "", firstDate: "", avgFx: "", memo: "" };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cash, setCash] = useState(String(p.simple.cash || ""));
  const [cashFx, setCashFx] = useState(p.simple.cashFx ? String(p.simple.cashFx) : "");
  useEffect(() => {
    setCash(String(p.simple.cash || ""));
    setCashFx(p.simple.cashFx ? String(p.simple.cashFx) : "");
  }, [p.simple.cash, p.simple.cashFx]);

  const submit = () => {
    const sym = normalizeSymbol(f.symbol);
    if (!getInstrument(sym)) return setErr(`${f.symbol || "티커"}: 지원하는 종목을 고르세요.`);
    const shares = parseNum(f.shares);
    const avgCost = parseNum(f.avgCost);
    if (!(shares > 0)) return setErr("보유 수량을 0보다 크게 입력하세요.");
    if (!(avgCost >= 0)) return setErr("평균 매수 단가를 입력하세요.");
    if (f.firstDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.firstDate)) return setErr("최초 매수일 형식이 올바르지 않습니다.");
    const fxv = f.avgFx ? parseNum(f.avgFx) : null;
    if (fxv !== null && !(fxv > 0)) return setErr("환율은 0보다 큰 숫자로 입력하세요.");
    const h: SimpleHolding = { id: editing ?? newId(), symbol: sym, shares, avgCost, firstDate: f.firstDate || undefined, avgFx: fxv, memo: f.memo || undefined };
    if (!editing && p.simple.holdings.some((x) => x.symbol === sym)) return setErr(`${sym}은(는) 이미 있습니다. 목록에서 '수정'을 누르세요.`);
    save((cur) => ({ ...cur, simple: { ...cur.simple, holdings: editing ? cur.simple.holdings.map((x) => (x.id === editing ? h : x)) : [...cur.simple.holdings, h] } }));
    setF(blank);
    setEditing(null);
    setErr(null);
  };
  const saveCash = () => {
    const v = cash.trim() === "" ? 0 : parseNum(cash);
    if (!(v >= 0)) return setErr("현금 잔액은 0 이상으로 입력하세요.");
    const fxv = cashFx ? parseNum(cashFx) : null;
    save((cur) => ({ ...cur, simple: { ...cur.simple, cash: v, cashFx: fxv && fxv > 0 ? fxv : null } }));
    setErr(null);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="티커 *">
          <SymbolField value={f.symbol} onChange={(v) => setF({ ...f, symbol: v })} label="티커" />
        </Field>
        <Field label="보유 수량 *">
          <input className="input" inputMode="decimal" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} aria-label="보유 수량" />
        </Field>
        <Field label="평균 매수 단가 (USD) *">
          <input className="input" inputMode="decimal" value={f.avgCost} onChange={(e) => setF({ ...f, avgCost: e.target.value })} aria-label="평균 매수 단가" />
        </Field>
        <Field label="최초 매수일 (선택)">
          <input className="input" type="date" value={f.firstDate} onChange={(e) => setF({ ...f, firstDate: e.target.value })} aria-label="최초 매수일" />
        </Field>
        <Field label="평균 매수 환율 (선택)" hint="원/달러">
          <input className="input" inputMode="decimal" value={f.avgFx} onChange={(e) => setF({ ...f, avgFx: e.target.value })} aria-label="평균 매수 환율" />
        </Field>
        <Field label="메모 (선택)">
          <input className="input" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} aria-label="메모" maxLength={200} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={submit}>
          {editing ? "수정 저장" : "보유 종목 추가"}
        </button>
        {editing && (
          <button type="button" className="btn" onClick={() => (setEditing(null), setF(blank))}>
            취소
          </button>
        )}
      </div>
      {err && <p className="text-sm text-critical" role="alert">{err}</p>}
      {p.simple.holdings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>티커</th>
                <th className="r">수량</th>
                <th className="r">평균 단가</th>
                <th>최초 매수일</th>
                <th className="r">평균 환율</th>
                <th className="r">수익률 ({v.basis === "usd" ? "달러" : "원화"})</th>
                <th>메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.simple.holdings.map((h) => (
                <tr key={h.id}>
                  <td className="font-semibold">{h.symbol}</td>
                  <td className="r">{h.shares}</td>
                  <td className="r">{usd(h.avgCost)}</td>
                  <td className="num">{h.firstDate ?? "-"}</td>
                  <td className="r">{h.avgFx ? h.avgFx.toLocaleString("ko-KR") : "-"}</td>
                  <td className={`r ${tone(rowReturn(v, h.symbol))}`}>{pct(rowReturn(v, h.symbol))}</td>
                  <td className="max-w-[14rem] truncate text-xs text-ink-2">{h.memo}</td>
                  <td className="whitespace-nowrap text-right">
                    <button type="button" className="btn btn-sm" onClick={() => (setEditing(h.id), setF({ symbol: h.symbol, shares: String(h.shares), avgCost: String(h.avgCost), firstDate: h.firstDate ?? "", avgFx: h.avgFx ? String(h.avgFx) : "", memo: h.memo ?? "" }))}>
                      수정
                    </button>{" "}
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => window.confirm(`${h.symbol} 보유 기록을 삭제할까요?`) && save((cur) => ({ ...cur, simple: { ...cur.simple, holdings: cur.simple.holdings.filter((x) => x.id !== h.id) } }))}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="현금 잔액 (USD)">
          <input className="input w-40" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} aria-label="현금 잔액" />
        </Field>
        <Field label="현금 환전 환율 (선택)">
          <input className="input w-32" inputMode="decimal" value={cashFx} onChange={(e) => setCashFx(e.target.value)} aria-label="현금 환율" />
        </Field>
        <button type="button" className="btn" onClick={saveCash}>
          현금 저장
        </button>
      </div>
    </div>
  );
}

const TXN_TYPES: TxnType[] = ["buy", "sell", "deposit", "withdraw", "dividend", "reinvest", "opening"];

function LedgerEditor({ p, save, s }: { p: PortfolioData; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void>; s: PortfolioSummary }) {
  const today = etToday();
  const blank = { date: today, symbol: "", shares: "", price: "", fee: "", amount: "", tax: "", fx: "", memo: "" };
  const [type, setType] = useState<TxnType>("buy");
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const needsSymbol = !["deposit", "withdraw"].includes(type);
  const needsShares = ["buy", "sell", "reinvest", "opening"].includes(type);
  const needsAmount = ["deposit", "withdraw", "dividend", "reinvest"].includes(type);

  const fill = async (what: "price" | "fx") => {
    setHint(null);
    try {
      const sym = what === "fx" ? "KRW=X" : normalizeSymbol(f.symbol);
      if (what === "price" && !getInstrument(sym)) return setHint("먼저 지원 종목 티커를 입력하세요.");
      const x: PriceSeries = await fetchSeries(sym);
      const c = closeOn(x, f.date);
      if (!c) return setHint(`${f.date} 이전 ${what === "fx" ? "환율" : "종가"} 기록이 없습니다.`);
      if (what === "price") setF((cur) => ({ ...cur, price: String(c.close) }));
      else setF((cur) => ({ ...cur, fx: String(Math.round(c.close * 100) / 100) }));
      setHint(`${c.date} ${what === "fx" ? "환율" : "종가"} ${c.close}을(를) 넣었습니다${c.date !== f.date ? " (해당일 기록이 없어 직전 거래일 값)" : ""}. 실제 체결가와 다를 수 있습니다.`);
    } catch (e) {
      setHint(`불러오지 못했습니다: ${(e as Error).message}`);
    }
  };

  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setErr("거래일을 입력하세요.");
    if (f.date > today) return setErr("미래 날짜의 거래는 기록할 수 없습니다.");
    const t: Txn = { id: newId(), type, date: f.date, createdAt: Date.now(), memo: f.memo || undefined, fx: f.fx ? parseNum(f.fx) : null };
    if (t.fx !== null && t.fx !== undefined && !(t.fx > 0)) return setErr("환율은 0보다 큰 숫자로 입력하세요.");
    if (needsSymbol) {
      const sym = normalizeSymbol(f.symbol);
      if (!getInstrument(sym)) return setErr("지원하는 종목 티커를 입력하세요.");
      t.symbol = sym;
    }
    if (needsShares) {
      t.shares = parseNum(f.shares);
      t.price = parseNum(f.price);
      if (!(t.shares > 0)) return setErr("수량을 0보다 크게 입력하세요.");
      if (!(t.price > 0)) return setErr("가격을 0보다 크게 입력하세요.");
    }
    if (type === "buy" || type === "sell") {
      t.fee = f.fee ? parseNum(f.fee) : 0;
      if (!(t.fee >= 0)) return setErr("수수료는 0 이상으로 입력하세요.");
    }
    if (needsAmount) {
      t.amount = parseNum(f.amount);
      if (!(t.amount > 0)) return setErr("금액을 0보다 크게 입력하세요.");
    }
    if (type === "dividend" || type === "reinvest") {
      t.tax = f.tax ? parseNum(f.tax) : 0;
      if (!(t.tax >= 0) || t.tax > (t.amount ?? 0)) return setErr("세금은 0 이상, 분배금 이하로 입력하세요.");
    }
    // 이 기록을 넣었을 때 생기는 오류(보유 수량 초과 매도 등)를 먼저 확인
    const check = computeLedger([...p.ledger, t], {});
    const problem = check.issues.find((i) => i.txnId === t.id && i.level === "error");
    if (problem) return setErr(problem.message);
    save((cur) => ({ ...cur, ledger: [...cur.ledger, t] }));
    setF({ ...blank, date: f.date });
    setErr(null);
    setHint(check.issues.find((i) => i.txnId === t.id)?.message ?? `${TXN_KO[type]} 기록을 저장했습니다.`);
  };

  const sorted = [...p.ledger].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const issueBy = new Map(s.issues.map((i) => [i.txnId, i]));
  return (
    <div className="flex flex-col gap-4">
      <Seg label="거래 종류" value={type} onChange={setType} options={TXN_TYPES.map((t) => ({ v: t, l: TXN_KO[t] }))} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="거래일 *">
          <input type="date" className="input" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="거래일" />
        </Field>
        {needsSymbol && (
          <Field label="티커 *">
            <SymbolField value={f.symbol} onChange={(v) => setF({ ...f, symbol: v })} label="거래 티커" />
          </Field>
        )}
        {needsAmount && (
          <Field label={type === "deposit" ? "입금액 (USD) *" : type === "withdraw" ? "출금액 (USD) *" : "분배금 세전 금액 (USD) *"}>
            <input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="금액" />
          </Field>
        )}
        {(type === "dividend" || type === "reinvest") && (
          <Field label="원천징수 세금 (USD)" hint={<button type="button" className="link text-accent" onClick={() => setF({ ...f, tax: String(Math.round(parseNum(f.amount) * 15) / 100 || "") })}>15%로 채우기</button>}>
            <input className="input" inputMode="decimal" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} aria-label="세금" />
          </Field>
        )}
        {needsShares && (
          <Field label={type === "reinvest" ? "재투자로 산 수량 *" : "수량 *"}>
            <input className="input" inputMode="decimal" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} aria-label="수량" />
          </Field>
        )}
        {needsShares && (
          <Field label={type === "opening" ? "평균 매수 단가 *" : "체결 가격 (USD) *"} hint={type !== "opening" ? <button type="button" className="text-accent" onClick={() => fill("price")}>그날 종가 넣기</button> : undefined}>
            <input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} aria-label="가격" />
          </Field>
        )}
        {(type === "buy" || type === "sell") && (
          <Field label="수수료 (USD)">
            <input className="input" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} aria-label="수수료" />
          </Field>
        )}
        <Field label="거래 당시 환율 (선택)" hint={<button type="button" className="text-accent" onClick={() => fill("fx")}>그날 환율 넣기</button>}>
          <input className="input" inputMode="decimal" value={f.fx} onChange={(e) => setF({ ...f, fx: e.target.value })} aria-label="거래 환율" />
        </Field>
        <Field label="메모 (선택)">
          <input className="input" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} aria-label="거래 메모" maxLength={200} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={submit}>
          {TXN_KO[type]} 기록 추가
        </button>
        {err && <span className="text-sm text-critical" role="alert">{err}</span>}
        {!err && hint && <span className="text-xs text-ink-2">{hint}</span>}
      </div>
      <DividendSuggestions p={p} save={save} />
      {s.issues.length > 0 && (
        <Notice tone="warn" title={`확인할 기록 ${s.issues.length}건`}>
          <ul className="list-disc pl-4 text-xs">
            {s.issues.slice(0, 8).map((i) => (
              <li key={i.txnId + i.message}>{i.message}</li>
            ))}
          </ul>
        </Notice>
      )}
      {sorted.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>날짜</th>
                <th>종류</th>
                <th>종목</th>
                <th className="r">수량</th>
                <th className="r">가격</th>
                <th className="r">금액</th>
                <th className="r">수수료·세금</th>
                <th className="r">환율</th>
                <th>메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id} className={issueBy.get(t.id)?.level === "error" ? "bg-critical-soft" : ""}>
                  <td className="num">{t.date}</td>
                  <td className="whitespace-nowrap">{TXN_KO[t.type]}</td>
                  <td className="font-semibold">{t.symbol ?? "-"}</td>
                  <td className="r">{t.shares ?? "-"}</td>
                  <td className="r">{t.price !== undefined ? usd(t.price) : "-"}</td>
                  <td className="r">{t.amount !== undefined ? usd(t.amount) : t.shares && t.price ? usd(t.shares * t.price) : "-"}</td>
                  <td className="r">{t.fee ? usd(t.fee) : t.tax ? `세금 ${usd(t.tax)}` : "-"}</td>
                  <td className="r">{t.fx ? t.fx.toLocaleString("ko-KR") : "-"}</td>
                  <td className="max-w-[12rem] truncate text-xs text-ink-2">{t.memo}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => window.confirm(`${t.date} ${TXN_KO[t.type]} 기록을 삭제할까요?`) && save((cur) => ({ ...cur, ledger: cur.ledger.filter((x) => x.id !== t.id) }))}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>거래 기록이 없습니다. 먼저 &apos;입금&apos;으로 투자 자금을 넣은 뒤 매수를 기록하세요.</Empty>
      )}
    </div>
  );
}

/** 보유 중 지급된 실제 분배금 가운데 아직 기록하지 않은 것 (사용자가 확인 후 추가) */
function DividendSuggestions({ p, save }: { p: PortfolioData; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void> }) {
  const symbols = [...new Set(p.ledger.filter((t) => t.type !== "deposit" && t.type !== "withdraw").map((t) => t.symbol).filter((x): x is string => !!x))];
  const ser = useSeriesMap(symbols);
  const [taxPct, setTaxPct] = useState("15");
  const today = etToday();
  const list = useMemo(() => {
    const out: { symbol: string; ex: string; pay: string | null; perShare: number; shares: number }[] = [];
    for (const sym of symbols) {
      const x = ser.series[sym];
      if (!x) continue;
      const first = p.ledger.filter((t) => t.symbol === sym).map((t) => t.date).sort()[0];
      for (const d of x.divs) {
        const when = d.pay ?? d.ex;
        if (d.ex <= first || when > today) continue;
        const held = computeLedger(p.ledger, {}, addDays(d.ex, -1)).positions.find((q) => q.symbol === sym)?.shares ?? 0;
        if (held <= 0) continue;
        const recorded = p.ledger.some((t) => (t.type === "dividend" || t.type === "reinvest") && t.symbol === sym && t.date >= addDays(d.ex, -3) && t.date <= addDays(when, 20));
        if (!recorded) out.push({ symbol: sym, ex: d.ex, pay: d.pay, perShare: d.amount, shares: held });
      }
    }
    return out.sort((a, b) => b.ex.localeCompare(a.ex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ledger, ser.series, today]);
  if (!list.length) return null;
  const add = (it: (typeof list)[number]) => {
    const gross = Math.round(it.perShare * it.shares * 100) / 100;
    const tax = Math.round(gross * parseNum(taxPct)) / 100;
    save((cur) => ({ ...cur, ledger: [...cur.ledger, { id: newId(), type: "dividend", date: it.pay ?? it.ex, symbol: it.symbol, amount: gross, tax: tax >= 0 && tax <= gross ? tax : 0, memo: `실제 지급 기록 기준 자동 계산 (배당락 ${it.ex}, 주당 $${it.perShare})`, createdAt: Date.now() }] }));
  };
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-semibold">
        기록되지 않은 실제 지급 {list.length}건 <span className="text-xs font-normal text-muted">— 보유 기간에 실제로 지급된 분배금 (확인 후 추가)</span>
      </summary>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          세율
          <input className="input w-16 py-0.5 text-sm" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} aria-label="추가할 때 적용할 세율" />%
        </label>
        <span className="text-muted">배당락일 전날 보유 수량 × 주당 지급액. 실제 계좌 입금액과 다르면 직접 입력하세요.</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {list.slice(0, 24).map((it) => (
          <li key={it.symbol + it.ex} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{it.symbol}</span>
            <span className="num text-xs text-muted">배당락 {it.ex} · 지급 {it.pay ?? "미제공"}</span>
            <span className="num">{it.shares}주 × ${it.perShare} = {usd(it.shares * it.perShare)}</span>
            <button type="button" className="btn btn-sm" onClick={() => add(it)}>
              수령 기록 추가
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
