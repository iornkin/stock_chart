"use client";
/**
 * 배당·분배금 현금흐름 계산기
 * - 최근 12개월 '실제 지급 기록'과 '발표된 예정 지급'만 계산에 사용한다
 * - 같은 금액이 반복된다는 가정치는 '가정'으로 따로 표시한다
 */
import { useEffect, useState } from "react";
import { TaxRatePicker, useDivTax } from "./DividendTax";

export interface CalcPayment {
  exDate: string;
  payDate: string | null;
  amount: number;
  special: boolean;
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const per = (v: number) => `$${v.toFixed(4).replace(/0{1,2}$/, "")}`;

export default function DividendCalculator({ symbol, word, price, past12, upcoming, asOf }: { symbol: string; word: string; price: number | null; past12: CalcPayment[]; upcoming: CalcPayment[]; asOf: string }) {
  const [mode, setMode] = useState<"shares" | "amount">("shares");
  const [input, setInput] = useState("100");
  const tax = useDivTax();
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`usi-calc-${symbol}`) ?? "null");
      if (saved && (saved.mode === "shares" || saved.mode === "amount")) {
        setMode(saved.mode);
        setInput(String(saved.input ?? "100"));
      }
    } catch {
      /* 저장값 없음 */
    }
  }, [symbol]);
  useEffect(() => {
    try {
      localStorage.setItem(`usi-calc-${symbol}`, JSON.stringify({ mode, input }));
    } catch {
      /* 저장 실패 무시 */
    }
  }, [symbol, mode, input]);

  const n = Number(input.replace(/,/g, ""));
  const valid = Number.isFinite(n) && n > 0;
  const shares = !valid ? 0 : mode === "shares" ? n : price ? n / price : 0;
  const net = 1 - tax.rate / 100;
  const taxed = tax.rate > 0;
  const regular = past12.filter((p) => !p.special);
  const pastCash = past12.reduce((a, p) => a + p.amount * shares * net, 0);
  const regularCash = regular.reduce((a, p) => a + p.amount * shares * net, 0);
  const upcomingCash = upcoming.reduce((a, p) => a + p.amount * shares * net, 0);

  const btn = (on: boolean) => `rounded-md px-3 py-1.5 text-sm ${on ? "bg-surface font-semibold shadow-sm" : "text-ink-2"}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          <button type="button" className={btn(mode === "shares")} aria-pressed={mode === "shares"} onClick={() => setMode("shares")}>
            보유 주식 수
          </button>
          <button type="button" className={btn(mode === "amount")} aria-pressed={mode === "amount"} onClick={() => setMode("amount")} disabled={!price}>
            투자 금액
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {mode === "shares" ? "주식 수" : "투자 금액 (USD)"}
          <input
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="num w-40 rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink"
            aria-label={mode === "shares" ? "보유 주식 수" : "투자 금액"}
          />
        </label>
      </div>
      <TaxRatePicker t={tax} />
      {mode === "amount" && price && valid && <p className="-mt-2 text-xs text-muted">현재가 {usd(price)} 기준 약 {shares.toFixed(2)}주 (소수점 주식 포함)</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs text-muted">최근 12개월 실제 지급 기준{taxed ? ` (${tax.label})` : " (세전)"}</p>
          <p className="num mt-1 text-2xl font-bold">{usd(pastCash)}</p>
          <p className="mt-1 text-xs text-muted">
            {past12.length}회 지급 기록 × {shares ? shares.toLocaleString("en-US", { maximumFractionDigits: 2 }) : 0}주{regular.length !== past12.length ? ` · 정기분 ${usd(regularCash)}` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs text-muted">발표된 예정 {word}</p>
          <p className="num mt-1 text-2xl font-bold">{upcoming.length ? usd(upcomingCash) : "-"}</p>
          <p className="mt-1 text-xs text-muted">{upcoming.length ? upcoming.map((u) => `${u.payDate ?? u.exDate} ${per(u.amount)}`).join(", ") : "발표된 다음 지급 없음"}</p>
        </div>
        <div className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-4">
          <p className="text-xs text-muted">
            참고 <span className="rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn">가정</span>
          </p>
          <p className="num mt-1 text-2xl font-bold text-ink-2">{regular.length ? `월 ${usd(regularCash / 12)}` : "-"}</p>
          <p className="mt-1 text-xs text-muted">최근 12개월 정기 지급이 그대로 반복된다고 가정한 월평균입니다. 확정된 금액이 아닙니다.</p>
        </div>
      </div>

      {past12.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>지급일</th>
                <th>배당락일</th>
                <th className="r">주당</th>
                <th className="r">받은 금액{taxed ? ` (${tax.label})` : " (세전)"}</th>
              </tr>
            </thead>
            <tbody>
              {[...past12].reverse().map((p) => (
                <tr key={p.exDate + p.amount}>
                  <td className="num">{p.payDate ?? <span className="text-muted">미제공</span>}</td>
                  <td className="num text-muted">{p.exDate}</td>
                  <td className="r">
                    {per(p.amount)}
                    {p.special && <span className="ml-1 text-[10px] text-muted">특별</span>}
                  </td>
                  <td className="r font-semibold">{usd(p.amount * shares * net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        {asOf} 기준 수집된 실제 지급 기록으로 계산합니다(배당락일이 최근 365일 안에 있는 지급). 세금은 고른 세율 가정으로 뺀 참고값이며 확정 세액이 아닙니다. 과거 지급이 미래 지급을 보장하지 않습니다.
      </p>
    </div>
  );
}
