"use client";
/** 여러 보유 종목의 배당·분배금 현금흐름 (최근 12개월 실제 지급 + 발표된 예정 지급) */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABELS, type Category } from "@/config/instruments";
import type { CalcPayment } from "./DividendCalculator";

export interface IncomeAsset {
  symbol: string;
  name: string;
  category: Category;
  word: string;
  price: number | null;
  priceAsOf: number | null;
  frequency: string;
  past12: CalcPayment[];
  upcoming: CalcPayment[];
}

interface Holding {
  symbol: string;
  shares: number;
}

const KEY = "usi-income-holdings";
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function lastMonths(asOf: string, n: number): string[] {
  const [y, m] = asOf.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export default function IncomePlanner({ assets, asOf }: { assets: IncomeAsset[]; asOf: string }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("100");
  const [withholding, setWithholding] = useState(false);
  const bySym = useMemo(() => new Map(assets.map((a) => [a.symbol, a])), [assets]);

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(v)) setHoldings(v.filter((h) => h && typeof h.symbol === "string" && Number(h.shares) > 0));
    } catch {
      /* 무시 */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(holdings));
    } catch {
      /* 무시 */
    }
  }, [holdings, loaded]);

  const add = () => {
    const n = Number(qty.replace(/,/g, ""));
    if (!pick || !(n > 0)) return;
    setHoldings((h) => [...h.filter((x) => x.symbol !== pick), { symbol: pick, shares: n }]);
    setPick("");
  };
  const net = withholding ? 0.85 : 1;
  const rows = holdings
    .map((h) => {
      const a = bySym.get(h.symbol);
      if (!a) return null;
      const ttm = a.past12.reduce((s, p) => s + p.amount * h.shares * net, 0);
      const value = a.price ? a.price * h.shares : null;
      return { h, a, ttm, value, yield: value ? (ttm / net / value) * 100 : null };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const totalTtm = rows.reduce((s, r) => s + r.ttm, 0);
  const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const months = lastMonths(asOf, 12);
  const monthly = months.map((ym) => ({
    ym,
    cash: rows.reduce((s, r) => s + r.a.past12.filter((p) => (p.payDate ?? p.exDate).slice(0, 7) === ym).reduce((x, p) => x + p.amount * r.h.shares * net, 0), 0),
  }));
  const maxMonth = Math.max(1, ...monthly.map((m) => m.cash));
  const upcoming = rows
    .flatMap((r) => r.a.upcoming.map((u) => ({ symbol: r.a.symbol, word: r.a.word, ...u, cash: u.amount * r.h.shares * net })))
    .sort((a, b) => (a.payDate ?? a.exDate).localeCompare(b.payDate ?? b.exDate));
  const upcomingTotal = upcoming.reduce((s, u) => s + u.cash, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-4 p-4 sm:p-6">
        <h2 className="text-[17px] font-bold">보유 종목</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            종목
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="보유 종목 선택" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
              <option value="">선택</option>
              {assets.map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            주식 수
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="num w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
          </label>
          <button type="button" onClick={add} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!pick}>
            추가
          </button>
          <label className="ml-auto flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={withholding} onChange={(e) => setWithholding(e.target.checked)} className="h-4 w-4" />
            미국 원천징수 15% 반영
          </label>
        </div>
        {!loaded ? (
          <div className="skeleton h-16" />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">종목과 주식 수를 넣고 &lsquo;추가&rsquo;를 누르세요. 배당·분배금 기록이 있는 지원 종목 {assets.length}개를 고를 수 있습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">주식 수</th>
                  <th className="r">평가액</th>
                  <th className="r">최근 12개월 받은 금액</th>
                  <th className="r">TTM 수익률</th>
                  <th>주기</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.h.symbol}>
                    <td>
                      <Link href={`/stock/${r.a.symbol}?tab=dividends`} className="font-semibold hover:text-accent">
                        {r.a.symbol}
                      </Link>
                      <span className="ml-1 text-xs text-muted">{CATEGORY_LABELS[r.a.category]}</span>
                    </td>
                    <td className="r">{r.h.shares.toLocaleString("en-US")}</td>
                    <td className="r">{r.value !== null ? usd(r.value) : "-"}</td>
                    <td className="r font-semibold">{usd(r.ttm)}</td>
                    <td className="r">{r.yield !== null ? `${r.yield.toFixed(2)}%` : "-"}</td>
                    <td className="text-xs">{r.a.frequency}</td>
                    <td className="r">
                      <button type="button" onClick={() => setHoldings((h) => h.filter((x) => x.symbol !== r.h.symbol))} className="text-xs text-muted hover:text-critical" aria-label={`${r.a.symbol} 삭제`}>
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs text-muted">최근 12개월 실제 지급 기준</p>
              <p className="num mt-1 text-2xl font-bold">{usd(totalTtm)}</p>
              <p className="mt-1 text-xs text-muted">{withholding ? "원천징수 15% 반영" : "세전"}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted">평가액 (최근 수집 시세)</p>
              <p className="num mt-1 text-2xl font-bold">{usd(totalValue)}</p>
              <p className="mt-1 text-xs text-muted">TTM 수익률 {totalValue ? `${((totalTtm / net / totalValue) * 100).toFixed(2)}%` : "-"}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted">발표된 예정 지급</p>
              <p className="num mt-1 text-2xl font-bold">{upcoming.length ? usd(upcomingTotal) : "-"}</p>
              <p className="mt-1 text-xs text-muted">{upcoming.length}건 · 발표된 금액만</p>
            </div>
            <div className="card border-dashed bg-surface-2 p-4">
              <p className="text-xs text-muted">
                참고 <span className="rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn">가정</span>
              </p>
              <p className="num mt-1 text-2xl font-bold text-ink-2">월 {usd(totalTtm / 12)}</p>
              <p className="mt-1 text-xs text-muted">최근 12개월이 반복된다는 가정의 월평균. 확정 아님</p>
            </div>
          </div>

          <section className="card p-4 sm:p-6">
            <h2 className="text-[17px] font-bold">월별 받은 금액 (최근 12개월 실제 지급)</h2>
            <p className="mt-1 text-xs text-muted">지급일 기준(지급일이 없으면 배당락일). 지금 보유 수량을 1년 전부터 보유했다고 가정한 계산입니다.</p>
            <div className="mt-4 flex h-48 items-end gap-1.5">
              {monthly.map((m) => (
                <div key={m.ym} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[10px] text-ink-2">{m.cash ? usd(m.cash).replace(".00", "") : ""}</span>
                  <div className="w-full rounded-t-md bg-accent" style={{ height: `${(m.cash / maxMonth) * 100}%`, minHeight: m.cash ? 3 : 0 }} title={`${m.ym} ${usd(m.cash)}`} />
                  <span className="text-[10px] text-muted">{Number(m.ym.slice(5))}월</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="text-[17px] font-bold">발표된 예정 지급</h2>
            {upcoming.length ? (
              <ul className="mt-3 flex flex-col">
                {upcoming.map((u) => (
                  <li key={u.symbol + u.exDate} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
                    <span>
                      <strong>{u.symbol}</strong> <span className="text-xs text-muted">배당락 {u.exDate} · 지급 {u.payDate ?? "미제공"}</span>
                    </span>
                    <span className="num font-semibold">{usd(u.cash)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">보유 종목 중 아직 발표된 다음 지급이 없습니다.</p>
            )}
          </section>
        </>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        {asOf} 기준 수집된 실제 지급 기록으로 계산합니다. 원천징수 15%는 한·미 조세조약상 일반 세율을 가정한 참고값입니다. 과거 지급이 미래 지급을 보장하지 않으며, 예상치는 모두 &lsquo;가정&rsquo;으로 표시합니다.
      </p>
    </div>
  );
}
