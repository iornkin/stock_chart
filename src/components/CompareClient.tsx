"use client";
/** 종목 비교: 같은 시작값(100)으로 정규화한 차트와 기간 성과·특성 비교 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, createChart, type IChartApi, type MouseEventParams, type Time } from "lightweight-charts";
import { INSTRUMENTS, CATEGORY_LABELS, CATEGORY_ORDER } from "@/config/instruments";
import { COMPARE_PERIODS } from "@/lib/performance";
import type { CompareResult } from "@/lib/compare";
import { fmtCompact, fmtDividend, fmtPct, fmtUsdCompact } from "@/lib/format";
import { formatEt } from "@/lib/time";

const PRESETS: string[][] = [
  ["QQQ", "VOO"],
  ["SPY", "VOO"],
  ["TQQQ", "QLD"],
  ["JEPI", "JEPQ"],
  ["DGRO", "SCHD"],
  ["GLD", "IAU"],
  ["NVDA", "SMH"],
];

const COLORS = ["--s1", "--s2", "--s3", "--s7", "--s5"];

function cssVar(name: string, fb: string) {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

export default function CompareClient({ initial, showPresets = true }: { initial: string[]; showPresets?: boolean }) {
  const [symbols, setSymbols] = useState<string[]>(initial.slice(0, 5));
  const [period, setPeriod] = useState("1y");
  const [mode, setMode] = useState<"price" | "total">("total");
  const [data, setData] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ date: string; values: Record<string, number> } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (symbols.length < 2) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/compare?symbols=${symbols.join(",")}&period=${period}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as CompareResult;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbols, period]);

  const colorOf = useMemo(() => {
    const m: Record<string, string> = {};
    symbols.forEach((s, i) => (m[s] = COLORS[i % COLORS.length]));
    return m;
  }, [symbols]);

  useEffect(() => {
    const el = ref.current;
    chartRef.current?.remove();
    chartRef.current = null;
    if (!el || !data || !data.series.length) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssVar("--surface", "#fff") }, textColor: cssVar("--text-2", "#555"), fontSize: 11 },
      grid: { vertLines: { color: cssVar("--grid", "#eee") }, horzLines: { color: cssVar("--grid", "#eee") } },
      rightPriceScale: { borderColor: cssVar("--axis", "#ccc") },
      timeScale: { borderColor: cssVar("--axis", "#ccc") },
      localization: { locale: "ko-KR", priceFormatter: (v: number) => v.toFixed(1) },
    });
    chartRef.current = chart;
    const byDate: Record<string, Record<string, number>> = {};
    data.series.forEach((s, idx) => {
      const pts = mode === "price" ? s.price : s.total;
      const line = chart.addSeries(LineSeries, { color: cssVar(colorOf[s.symbol] ?? "--s1", "#2a78d6"), lineWidth: 2, title: s.symbol, priceLineVisible: false });
      line.setData(pts.map((p) => ({ time: p.date as Time, value: p.value })));
      for (const p of pts) (byDate[p.date] ??= {})[s.symbol] = p.value;
      if (idx === 0) line.createPriceLine({ price: 100, color: cssVar("--axis", "#ccc"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    });
    chart.timeScale().fitContent();
    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.time) return setHover(null);
      const d = String(p.time);
      setHover(byDate[d] ? { date: d, values: byDate[d] } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [data, mode, colorOf]);

  useEffect(() => () => chartRef.current?.remove(), []);

  const add = (s: string) => {
    if (!s || symbols.includes(s) || symbols.length >= 5) return;
    setSymbols([...symbols, s]);
  };

  const lastValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of data?.series ?? []) {
      const pts = mode === "price" ? s.price : s.total;
      if (pts.length) out[s.symbol] = pts[pts.length - 1].value;
    }
    return out;
  }, [data, mode]);
  const shown = hover?.values ?? lastValues;

  return (
    <div className="flex flex-col gap-3">
      {showPresets && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">추천 비교:</span>
          {PRESETS.map((p) => (
            <button key={p.join()} type="button" onClick={() => setSymbols(p)} className="rounded-md border border-line px-2 py-1 hover:border-accent">
              {p.join(" vs ")}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {symbols.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${colorOf[s]})` }} aria-hidden />
            <span className="font-semibold">{s}</span>
            <button type="button" aria-label={`${s} 제거`} onClick={() => setSymbols(symbols.filter((x) => x !== s))} className="rounded-full px-1.5 text-muted hover:text-critical">
              ×
            </button>
          </span>
        ))}
        {symbols.length < 5 && (
          <select aria-label="비교 종목 추가" value="" onChange={(e) => add(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1 text-sm">
            <option value="">+ 종목 추가 (최대 5개)</option>
            {CATEGORY_ORDER.map((c) => (
              <optgroup key={c} label={CATEGORY_LABELS[c]}>
                {INSTRUMENTS.filter((i) => i.category === c && !symbols.includes(i.symbol)).map((i) => (
                  <option key={i.symbol} value={i.symbol}>
                    {i.symbol} · {i.nameKo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="비교 기간" className="flex flex-wrap rounded-lg border border-line bg-surface-2 p-0.5">
          {COMPARE_PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={`rounded-md px-2.5 py-1 text-xs ${period === p.key ? "bg-surface font-semibold text-accent shadow-sm" : "text-ink-2"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="수익률 기준" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          <button type="button" aria-pressed={mode === "total"} onClick={() => setMode("total")} className={`rounded-md px-2.5 py-1 text-xs ${mode === "total" ? "bg-surface font-semibold text-accent shadow-sm" : "text-ink-2"}`}>
            총수익률 (분배금 재투자)
          </button>
          <button type="button" aria-pressed={mode === "price"} onClick={() => setMode("price")} className={`rounded-md px-2.5 py-1 text-xs ${mode === "price" ? "bg-surface font-semibold text-accent shadow-sm" : "text-ink-2"}`}>
            가격 수익률
          </button>
        </div>
      </div>

      {symbols.length < 2 && <p className="text-sm text-muted">비교할 종목을 2개 이상 선택하세요.</p>}
      {error && <p className="text-sm text-critical">비교 데이터를 불러오지 못했습니다: {error}</p>}
      {data?.excluded.map((e) => (
        <p key={e.symbol} className="rounded-md bg-warn-soft px-3 py-1.5 text-xs text-warn">
          {e.symbol} 제외: {e.reason}
        </p>
      ))}

      <div className="relative h-[360px] w-full overflow-hidden rounded-lg border border-line">
        <div ref={ref} className="absolute inset-0" role="img" aria-label="정규화 비교 차트" />
        {data && data.series.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-surface/90 px-2 py-1 text-[11px] shadow-sm">
            <div className="font-semibold">{hover?.date ?? `${data.end} (마지막)`} · 시작값 100 기준</div>
            {data.series.map((s) => (
              <div key={s.symbol} className="num flex items-center gap-1.5 text-ink-2">
                <span className="inline-block h-0.5 w-3" style={{ background: `var(${colorOf[s.symbol]})` }} />
                {s.symbol} <strong className="text-ink">{shown[s.symbol]?.toFixed(1) ?? "-"}</strong>
              </div>
            ))}
          </div>
        )}
        {loading && <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/60 text-sm text-muted">비교 데이터 계산 중…</div>}
      </div>

      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-basic">
            <caption className="mb-1 text-left text-xs text-muted">
              {data.periodLabel} · {data.start} ~ {data.end} · 공통 거래일 기준 · 가격 데이터 갱신 {formatEt(data.dataAsOf)}
            </caption>
            <thead>
              <tr>
                <th>종목</th>
                <th className="r">가격 수익률</th>
                <th className="r">총수익률(재투자)</th>
                <th className="r">총수익률(현금)</th>
                <th className="r">연환산(CAGR)</th>
                <th className="r">변동성(연)</th>
                <th className="r">최대 낙폭</th>
                <th className="r">평균 거래량</th>
                <th className="r">기간 중 분배금</th>
                <th className="r">TTM 수익률</th>
                <th>지급 주기</th>
                <th className="r">총보수</th>
                <th className="r">운용자산</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `var(${colorOf[r.symbol]})` }} />
                    <span className="font-semibold">{r.symbol}</span> <span className="text-xs text-muted">{r.name}</span>
                  </td>
                  <td className="r">{fmtPct(r.stats?.priceReturn)}</td>
                  <td className="r">{fmtPct(r.stats?.totalReturnReinvested)}</td>
                  <td className="r">{fmtPct(r.stats?.totalReturnCash)}</td>
                  <td className="r">{fmtPct(r.stats?.cagr)}</td>
                  <td className="r">{fmtPct(r.stats?.volatility, 1, false)}</td>
                  <td className="r">{fmtPct(r.stats?.maxDrawdown, 1)}</td>
                  <td className="r">{fmtCompact(r.stats?.avgVolume)}</td>
                  <td className="r">{r.stats?.distributions ? fmtDividend(r.stats.distributions) : "-"}</td>
                  <td className="r">{fmtPct(r.ttmYield, 2, false)}</td>
                  <td>{r.frequency}</td>
                  <td className="r" title={r.expenseSource ?? ""}>{r.kind === "etf" ? (r.expenseRatio !== null ? fmtPct(r.expenseRatio, 2, false) : "미제공") : "해당 없음"}</td>
                  <td className="r">{r.kind === "etf" ? (r.totalAssets !== null ? fmtUsdCompact(r.totalAssets) : "미제공") : "해당 없음"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-2 list-disc pl-5 text-[11px] text-muted">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
