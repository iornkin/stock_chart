"use client";
/** 배당·분배금 종목별 요약표 (분류 필터·정렬) */
import Link from "next/link";
import { useState } from "react";
import { fmtPct } from "@/lib/format";

export interface IncomeRow {
  symbol: string;
  name: string;
  category: string;
  categoryLabel: string;
  word: string;
  freq: string;
  latest: { exDate: string; payDate: string | null; amount: number } | null;
  ttm: number;
  ttmCount: number;
  ttmYield: number | null;
  annualized: number | null;
  annualizedYield: number | null;
  next: { exDate: string; payDate: string | null; amount: number } | null;
}

export default function IncomeTable({ rows }: { rows: IncomeRow[] }) {
  const cats = [...new Map(rows.map((r) => [r.category, r.categoryLabel])).entries()];
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<"default" | "yield">("default");
  let list = cat === "all" ? rows : rows.filter((r) => r.category === cat);
  if (sort === "yield") list = [...list].sort((a, b) => (b.ttmYield ?? -1) - (a.ttmYield ?? -1));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg" role="group" aria-label="분류">
          <button type="button" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
            전체
          </button>
          {cats.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)}>
              {l.replace(" ETF", "").replace("대형 기술주", "")}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="정렬">
          <button type="button" aria-pressed={sort === "default"} onClick={() => setSort("default")}>
            기본 순서
          </button>
          <button type="button" aria-pressed={sort === "yield"} onClick={() => setSort("yield")}>
            수익률 높은 순
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic min-w-[820px]">
          <thead>
            <tr>
              <th>종목</th>
              <th>지급</th>
              <th className="r">최근 지급액</th>
              <th className="r">최근 12개월 실제</th>
              <th className="r">수익률</th>
              <th className="r">연환산 (가정)</th>
              <th>다음 발표된 지급</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.symbol}>
                <td>
                  <Link href={`/stock/${t.symbol}?tab=dividends`} className="font-semibold hover:text-accent">
                    {t.symbol}
                  </Link>
                  <span className="block max-w-[14rem] truncate text-[11px] text-muted">{t.name}</span>
                </td>
                <td className="text-xs">
                  {t.word}
                  <span className="block text-muted">{t.freq}</span>
                </td>
                <td className="r">
                  {t.latest ? (
                    <>
                      ${t.latest.amount.toFixed(4)}
                      <span className="block text-[11px] text-muted">락 {t.latest.exDate}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="r">
                  {t.ttmCount ? (
                    <>
                      ${t.ttm.toFixed(4)}
                      <span className="block text-[11px] text-muted">{t.ttmCount}회</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="r font-semibold">{fmtPct(t.ttmYield, 2, false)}</td>
                <td className="r text-ink-2">{t.annualized !== null ? fmtPct(t.annualizedYield, 2, false) : <span className="text-xs text-muted">불규칙</span>}</td>
                <td className="text-xs">{t.next ? `락 ${t.next.exDate.slice(5)} · 지급 ${t.next.payDate ? t.next.payDate.slice(5) : "미제공"} · $${t.next.amount.toFixed(4)}` : <span className="text-muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
