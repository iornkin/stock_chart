"use client";
/** 가상 투자 — 실제 주문과 연결되지 않는 모의 계좌 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useVirtual, useQuotes, useSeriesMap, useFx, etToday, QUOTE_OLD_MS } from "@/lib/client/user-data";
import { computeVirtual, planOrder, virtualHistory } from "@/lib/portfolio/virtual";
import { newId, type VirtualAccount } from "@/lib/portfolio/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { marketStatus } from "@/lib/market-calendar";
import { formatEt, relativeTime } from "@/lib/time";
import { Empty, Notice, Section } from "@/components/ui";
import { Field, KV, LocalOnlyNote, Money, parseNum, pct, Seg, signedUsd, SymbolField, tone, usd } from "@/components/sim/common";
import { SimLineChart } from "@/components/sim/charts";

export default function PaperClient() {
  const store = useVirtual();
  if (!store.loaded) return <div className="skeleton h-64" aria-label="가상 계좌를 불러오는 중" />;
  if (!store.value) return <Setup onCreate={(a) => store.set(a)} />;
  return <Account acc={store.value} set={store.set} />;
}

function Setup({ onCreate, initial }: { onCreate: (a: VirtualAccount) => void; initial?: VirtualAccount }) {
  const [cash, setCash] = useState(String(initial?.initialCash ?? 10000));
  const [drip, setDrip] = useState(initial?.drip ?? false);
  const [slip, setSlip] = useState(String(initial?.slippagePct ?? 0.05));
  const [fee, setFee] = useState(String(initial?.feePct ?? 0.25));
  const [tax, setTax] = useState(String(initial?.taxPct ?? 15));
  const [err, setErr] = useState<string | null>(null);
  const create = () => {
    const c = parseNum(cash);
    const s = parseNum(slip);
    const f = parseNum(fee);
    const t = parseNum(tax);
    if (!(c > 0) || c > 1e9) return setErr("가상 초기 자금은 0보다 크고 10억 달러 이하로 입력하세요.");
    if (!(s >= 0 && s <= 5) || !(f >= 0 && f <= 5) || !(t >= 0 && t <= 100)) return setErr("슬리피지·수수료는 0~5%, 세율은 0~100%로 입력하세요.");
    onCreate({ version: 1, initialCash: c, startDate: etToday(), createdAt: Date.now(), drip, slippagePct: s, feePct: f, taxPct: t, trades: [] });
  };
  return (
    <Section title="가상 계좌 만들기" description="가상 초기 자금으로 사이트 안에서만 사고팝니다. 실제 증권 주문으로 이어지지 않습니다.">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="가상 초기 자금 (USD)">
          <input className="input" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} aria-label="가상 초기 자금" />
        </Field>
        <Field label="슬리피지 가정 (%)" hint="시세보다 불리하게 체결된다고 보는 폭">
          <input className="input" inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} aria-label="슬리피지" />
        </Field>
        <Field label="거래 수수료 (%)">
          <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="거래 수수료" />
        </Field>
        <Field label="분배금 세금 (%)" hint="미국 원천징수 15% 가정">
          <input className="input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={drip} onChange={(e) => setDrip(e.target.checked)} className="h-4 w-4" />
          분배금 자동 재투자
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={create}>
          가상 계좌 시작
        </button>
        {err && <span className="text-sm text-critical" role="alert">{err}</span>}
      </div>
      <div className="mt-3">
        <LocalOnlyNote what="가상 계좌와 가상 거래 기록" />
      </div>
    </Section>
  );
}

function Account({ acc, set }: { acc: VirtualAccount; set: (v: VirtualAccount | null | ((p: VirtualAccount | null) => VirtualAccount | null)) => Promise<void> }) {
  const today = etToday();
  const [sym, setSym] = useState("");
  const orderSym = getInstrument(sym) ? normalizeSymbol(sym) : "";
  const held = useMemo(() => [...new Set(acc.trades.map((t) => t.symbol))], [acc.trades]);
  const q = useQuotes([...held, ...(orderSym ? [orderSym] : [])]);
  const ser = useSeriesMap(held.length ? [...held, "SPY"] : []);
  const fx = useFx();
  const st = useMemo(() => computeVirtual(acc, ser.series, q.prices, today), [acc, ser.series, q.prices, today]);
  const hist = useMemo(() => {
    const cal = ser.series.SPY?.dates.filter((d) => d >= acc.startDate) ?? [];
    return cal.length >= 2 ? virtualHistory(acc, ser.series, cal) : null;
  }, [acc, ser.series]);
  const [editing, setEditing] = useState(false);

  if (editing)
    return (
      <Setup
        initial={acc}
        onCreate={(a) => {
          set((cur) => (cur ? { ...cur, drip: a.drip, slippagePct: a.slippagePct, feePct: a.feePct, taxPct: a.taxPct } : cur));
          setEditing(false);
        }}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="warn" title="가상 투자입니다">이 화면의 주문은 실제 증권 계좌로 전송되지 않습니다. 실제 보유 자산(내 자산)과 별도로 저장·계산합니다.</Notice>
      <Section
        title="가상 계좌"
        description={`시작 ${acc.startDate} · 초기 자금 ${usd(acc.initialCash)} · 분배금 ${acc.drip ? "자동 재투자" : "현금 수령"} · 슬리피지 ${acc.slippagePct}% · 수수료 ${acc.feePct}% · 분배금 세금 ${acc.taxPct}%`}
        right={
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              설정 변경
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => window.confirm("가상 계좌와 모든 가상 거래 기록을 지울까요? 되돌릴 수 없습니다.") && set(null)}>
              기록 초기화
            </button>
          </div>
        }
      >
        {st.missingPrices.length > 0 && <Notice tone="warn">{st.missingPrices.join(", ")} 시세가 없어 평가금액에서 빠졌습니다.</Notice>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV label="가상 총자산" value={<Money v={st.missingPrices.length ? null : st.totalValue} fx={fx.rate} />} />
          <KV label="가상 현금" value={<Money v={st.cash} fx={fx.rate} />} />
          <KV label="손익 (초기 자금 대비)" value={<Money v={st.missingPrices.length ? null : st.pnl} fx={fx.rate} signed />} valueClass={tone(st.pnl)} sub={st.missingPrices.length ? undefined : pct(st.returnPct)} />
          <KV label="실현 손익" value={signedUsd(st.realized)} valueClass={tone(st.realized)} />
          <KV label="미실현 손익" value={signedUsd(st.positions.reduce((a, p) => a + (p.unrealized ?? 0), 0))} valueClass={tone(st.positions.reduce((a, p) => a + (p.unrealized ?? 0), 0))} />
          <KV label="받은 가상 분배금 (세전)" value={usd(st.dividendsGross)} sub={`세금 ${usd(st.dividendsTax)}`} />
          <KV label="지급 예정 (배당락 지남)" value={usd(st.pending.reduce((a, p) => a + p.gross, 0))} sub="지급일 전 — 현금에 넣지 않음" />
          <KV label="낸 수수료" value={usd(st.fees)} />
        </div>
        {st.notes.map((n) => (
          <p key={n} className="mt-2 text-[11px] text-muted">
            {n}
          </p>
        ))}
      </Section>

      <OrderPanel acc={acc} set={set} st={st} sym={sym} setSym={setSym} quote={orderSym ? q.quotes[orderSym] : undefined} quoteLoading={q.loading} />

      <Section title="보유 종목">
        {st.positions.filter((p) => p.shares > 0).length ? (
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">수량</th>
                  <th className="r">평균 단가</th>
                  <th className="r">현재가</th>
                  <th className="r">평가금액</th>
                  <th className="r">미실현 손익</th>
                  <th className="r">실현 손익</th>
                  <th className="r">받은 분배금</th>
                </tr>
              </thead>
              <tbody>
                {st.positions
                  .filter((p) => p.shares > 0 || p.realized !== 0)
                  .map((p) => (
                    <tr key={p.symbol}>
                      <td>
                        <Link href={`/stock/${p.symbol}`} className="font-semibold hover:text-accent">
                          {p.symbol}
                        </Link>
                      </td>
                      <td className="r">{p.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td className="r">{usd(p.avgCost)}</td>
                      <td className="r">{usd(p.price)}</td>
                      <td className="r">{usd(p.value)}</td>
                      <td className={`r ${tone(p.unrealized)}`}>
                        {signedUsd(p.unrealized)} <span className="block text-[11px]">{pct(p.unrealizedPct)}</span>
                      </td>
                      <td className={`r ${tone(p.realized)}`}>{signedUsd(p.realized)}</td>
                      <td className="r">{usd(p.dividends)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>아직 가상으로 산 종목이 없습니다.</Empty>
        )}
      </Section>

      <Section title="가상 자산 추이" description="거래 기록과 일별 종가로 다시 계산 (지급 완료된 분배금·재투자 포함). 오늘 장중 변동은 반영되지 않을 수 있습니다.">
        {hist && hist.dates.length >= 2 ? (
          <SimLineChart dates={hist.dates} lines={[{ key: "v", label: "가상 총자산", values: hist.value, area: true }]} format="usd" baseline={acc.initialCash} ariaLabel="가상 총자산 추이" />
        ) : (
          <Empty>일별 종가가 2일 이상 쌓이면 추이를 표시합니다.</Empty>
        )}
      </Section>

      <Section title="거래·분배금 내역">
        {st.events.length ? (
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>거래일</th>
                  <th>구분</th>
                  <th>종목</th>
                  <th className="r">수량</th>
                  <th className="r">가격</th>
                  <th className="r">현금 변화</th>
                  <th>체결 근거</th>
                </tr>
              </thead>
              <tbody>
                {st.events.map((e, i) => (
                  <tr key={i}>
                    <td className="num">{e.date}</td>
                    <td>{e.kind === "buy" ? "매수" : e.kind === "sell" ? "매도" : e.kind === "dividend" ? "분배금 (자동)" : "재투자 (자동)"}</td>
                    <td className="font-semibold">{e.symbol}</td>
                    <td className="r">{e.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="r">{e.price !== null ? (e.kind === "dividend" ? `주당 $${e.price}` : usd(e.price)) : "-"}</td>
                    <td className={`r ${tone(e.cash)}`}>{signedUsd(e.cash)}</td>
                    <td className="text-[11px] text-ink-2">
                      {e.trade
                        ? `시세 ${usd(e.trade.quotePrice)} (${e.trade.quoteTime ? formatEt(e.trade.quoteTime) : "시각 미상"}, ${e.trade.quoteSource}, ${e.trade.quoteDelay}) · 슬리피지 ${e.trade.slippagePct}% · 수수료 ${usd(e.trade.fee)}`
                        : (e.note ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>거래 내역이 없습니다.</Empty>
        )}
        {st.pending.length > 0 && (
          <p className="mt-2 text-xs text-ink-2">
            지급 예정: {st.pending.map((p) => `${p.symbol} ${usd(p.gross)} (배당락 ${p.ex}, 지급 ${p.pay ?? "미제공"})`).join(", ")}
          </p>
        )}
      </Section>
      <LocalOnlyNote what="가상 계좌와 가상 거래 기록" />
    </div>
  );
}

function OrderPanel({
  acc,
  set,
  st,
  sym,
  setSym,
  quote,
  quoteLoading,
}: {
  acc: VirtualAccount;
  set: (v: VirtualAccount | null | ((p: VirtualAccount | null) => VirtualAccount | null)) => Promise<void>;
  st: ReturnType<typeof computeVirtual>;
  sym: string;
  setSym: (s: string) => void;
  quote: ReturnType<typeof useQuotes>["quotes"][string] | undefined;
  quoteLoading: boolean;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState<"shares" | "amount">("shares");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const symbol = getInstrument(sym) ? normalizeSymbol(sym) : "";
  const ms = marketStatus();
  const qPrice = quote?.price ?? null;
  const qTime = quote ? (quote.marketTime ?? quote.fetchedAt) : null;
  const old = qTime !== null && Date.now() - qTime > QUOTE_OLD_MS;
  const n = parseNum(qty);
  const slipPrice = qPrice ? (side === "buy" ? qPrice * (1 + acc.slippagePct / 100) : qPrice * (1 - acc.slippagePct / 100)) : null;
  const shares = mode === "shares" ? n : slipPrice ? n / (slipPrice * (1 + acc.feePct / 100)) : NaN;
  const plan = symbol && Number.isFinite(shares) ? planOrder(st, acc, side, symbol, Math.floor(shares * 10000) / 10000, old ? null : qPrice) : null;
  const tradeDate = ms.phase === "regular" ? ms.etDate : ms.nextSessionDate;

  const execute = () => {
    if (!plan || !plan.ok || !quote) return;
    const s = Math.floor(shares * 10000) / 10000;
    const ok = window.confirm(`가상 ${side === "buy" ? "매수" : "매도"}: ${symbol} ${s}주 × ${usd(plan.fillPrice)} (수수료 ${usd(plan.fee)})\n체결 거래일: ${tradeDate}\n\n실제 주문이 아닙니다. 진행할까요?`);
    if (!ok) return;
    set((cur) =>
      cur
        ? {
            ...cur,
            trades: [
              ...cur.trades,
              {
                id: newId(),
                side,
                symbol,
                shares: s,
                price: plan.fillPrice,
                quotePrice: qPrice as number,
                quoteTime: qTime,
                quoteSource: quote.source,
                quoteDelay: quote.delay?.text ?? "지연 여부 미확인",
                slippagePct: acc.slippagePct,
                fee: plan.fee,
                at: Date.now(),
                date: tradeDate,
              },
            ],
          }
        : cur,
    );
    setMsg({ ok: true, text: `가상 ${side === "buy" ? "매수" : "매도"} 완료: ${symbol} ${s}주` });
    setQty("");
  };

  return (
    <Section title="가상 주문" description="체결 가격 = 확인 가능한 최근 시세 ± 슬리피지. 정규장 시간이 아니면 마지막 시세로 체결됐다고 가정하고, 체결 거래일은 다음 정규장 날짜로 기록합니다(분배금 수령 자격 판단에 사용).">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="종목">
          <SymbolField value={sym} onChange={setSym} label="주문 종목" />
        </Field>
        <Field label="구분">
          <Seg label="매수 매도" value={side} onChange={setSide} options={[{ v: "buy", l: "매수" }, { v: "sell", l: "매도" }]} />
        </Field>
        <Field label="주문 단위">
          <Seg label="주문 단위" value={mode} onChange={setMode} options={[{ v: "shares", l: "수량" }, { v: "amount", l: "금액(USD)" }]} />
        </Field>
        <Field label={mode === "shares" ? "수량 (소수 4자리까지)" : "주문 금액 (USD)"}>
          <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="주문 수량" />
        </Field>
      </div>
      {symbol && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {quoteLoading ? (
            "시세 확인 중…"
          ) : quote && qPrice ? (
            <>
              <p>
                <span className="font-semibold">{symbol}</span> 시세 <span className="num font-semibold">{usd(qPrice)}</span> · 기준 시각 {qTime ? `${formatEt(qTime)} (${relativeTime(qTime)})` : "미상"} · 출처 {quote.source} · {quote.delay?.text ?? "지연 여부 미확인"}
              </p>
              <p className="text-xs text-muted">
                시장 상태: {ms.label} · 체결 거래일 {tradeDate}
                {ms.phase !== "regular" && " · 장외 시간이라 마지막 시세로 체결된다고 가정"}
              </p>
              {old && <p className="text-xs text-critical">시세가 {relativeTime(qTime)}의 것이라 가상 주문에도 쓰지 않습니다. 데이터가 갱신된 뒤 다시 시도하세요.</p>}
            </>
          ) : (
            <span className="text-critical">확인 가능한 시세가 없어 주문할 수 없습니다.</span>
          )}
        </div>
      )}
      {plan && (
        <p className="mt-2 text-sm">
          {plan.ok ? (
            <>
              예상 체결: <span className="num font-semibold">{(Math.floor(shares * 10000) / 10000).toLocaleString("en-US")}주 × {usd(plan.fillPrice)}</span> · 수수료 {usd(plan.fee)} · {side === "buy" ? "필요 현금" : "받을 현금"} <span className="num font-semibold">{usd(plan.total)}</span>
            </>
          ) : (
            <span className="text-critical">{plan.error}</span>
          )}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!plan?.ok} onClick={execute}>
          가상 {side === "buy" ? "매수" : "매도"} 실행
        </button>
        <span className="text-xs text-muted">가상 현금 {usd(st.cash)}</span>
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-critical"}`}>{msg.text}</span>}
      </div>
    </Section>
  );
}
