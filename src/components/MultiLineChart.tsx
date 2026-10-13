"use client";
/** 여러 종목의 누적 지수(시작 100)를 같은 축에 그리는 선 차트. 값 차이가 큰 레버리지 비교를 위해 로그 축을 기본으로 쓴다 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, PriceScaleMode, createChart, type IChartApi, type MouseEventParams, type Time } from "lightweight-charts";

const COLORS = ["--s1", "--s2", "--s3", "--s7", "--s5"];

function cssVar(name: string, fb: string) {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

export default function MultiLineChart({ dates, series, labels, height = 320, defaultLog = true }: { dates: string[]; series: Record<string, number[]>; labels?: Record<string, string>; height?: number; defaultLog?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [log, setLog] = useState(defaultLog);
  const [hover, setHover] = useState<{ date: string; values: Record<string, number> } | null>(null);
  const symbols = useMemo(() => Object.keys(series), [series]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !dates.length) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssVar("--surface", "#fff") }, textColor: cssVar("--text-2", "#555"), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--grid", "#eee") } },
      rightPriceScale: { borderColor: cssVar("--axis", "#ccc"), mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: cssVar("--axis", "#ccc") },
      localization: { locale: "ko-KR", priceFormatter: (v: number) => (v >= 1000 ? v.toFixed(0) : v.toFixed(1)) },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;
    const byDate: Record<string, Record<string, number>> = {};
    symbols.forEach((s, i) => {
      const line = chart.addSeries(LineSeries, { color: cssVar(COLORS[i % COLORS.length], "#2a78d6"), lineWidth: 2, title: s, priceLineVisible: false, lastValueVisible: true });
      line.setData(dates.map((d, k) => ({ time: d as Time, value: series[s][k] })));
      dates.forEach((d, k) => ((byDate[d] ??= {})[s] = series[s][k]));
      if (i === 0) line.createPriceLine({ price: 100, color: cssVar("--axis", "#ccc"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    });
    chart.timeScale().fitContent();
    const onMove = (p: MouseEventParams<Time>) => setHover(p.time && byDate[String(p.time)] ? { date: String(p.time), values: byDate[String(p.time)] } : null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [dates, series, symbols, log]);

  const last = Object.fromEntries(symbols.map((s) => [s, series[s][series[s].length - 1]]));
  const shown = hover?.values ?? last;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="num text-muted">{hover?.date ?? dates[dates.length - 1]}</span>
          {symbols.map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${COLORS[i % COLORS.length]})` }} />
              <span className="font-semibold">{labels?.[s] ?? s}</span>
              <span className="num">{shown[s]?.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
            </span>
          ))}
        </div>
        <div className="flex rounded-md border border-line bg-surface-2 p-0.5">
          {[
            [true, "로그 축"],
            [false, "일반 축"],
          ].map(([v, l]) => (
            <button key={String(v)} type="button" onClick={() => setLog(v as boolean)} aria-pressed={log === v} className={`rounded px-2 py-0.5 ${log === v ? "bg-surface font-semibold shadow-sm" : "text-ink-2"}`}>
              {l as string}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} style={{ height }} className="w-full" />
    </div>
  );
}
