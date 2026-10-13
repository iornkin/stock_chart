"use client";
/**
 * 계산 결과용 차트
 * - SimLineChart: 같은 단위의 여러 선(평가금액·지수·낙폭)을 한 축에 그린다. 십자선 위치의 값을 범례에 표시.
 * - GroupedBars: 연도별 수익률처럼 음수가 있는 값을 계열별로 나란히 비교 (0 기준선)
 * - ReturnHeatmap: 연·월 수익률 표 (상승/하락 두 색 + 0 근처는 회색)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, ColorType, LineSeries, LineStyle, PriceScaleMode, createChart, type MouseEventParams, type Time } from "lightweight-charts";
import { krw, pct, usd } from "./common";

export const SERIES_VARS = ["--s1", "--s2", "--s3", "--s7", "--s5"];

function cssVar(name: string, fb: string) {
  if (typeof window === "undefined") return fb;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

function rgba(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export type ValueFormat = "usd" | "krw" | "pct" | "index";

export function formatValue(v: number | null | undefined, f: ValueFormat): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  if (f === "usd") return usd(v, Math.abs(v) >= 1000 ? 0 : 2);
  if (f === "krw") return krw(v);
  if (f === "pct") return `${v.toFixed(1)}%`;
  return v.toFixed(1);
}

export interface LineDef {
  key: string;
  label: string;
  values: (number | null)[];
  /** CSS 변수 이름 (--s1 등). 없으면 순서대로 */
  color?: string;
  area?: boolean;
  dashed?: boolean;
}

function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-colors"] });
    return () => obs.disconnect();
  }, []);
  return v;
}

const toTime = (d: string) => (d.length === 7 ? `${d}-01` : d) as Time;

export function SimLineChart({ dates, lines, format, height = 280, logToggle = false, baseline, ariaLabel }: { dates: string[]; lines: LineDef[]; format: ValueFormat; height?: number; logToggle?: boolean; baseline?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const themeV = useThemeVersion();
  const idx = useMemo(() => new Map(dates.map((d, i) => [toTime(d) as string, i])), [dates]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !dates.length) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssVar("--surface", "#fff") }, textColor: cssVar("--text-2", "#555"), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--grid", "#eee") } },
      rightPriceScale: { borderColor: cssVar("--axis", "#ccc"), mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: cssVar("--axis", "#ccc") },
      localization: { locale: "ko-KR", priceFormatter: (v: number) => formatValue(v, format) },
      handleScroll: { vertTouchDrag: false },
      crosshair: { horzLine: { visible: false } },
    });
    lines.forEach((l, i) => {
      const color = cssVar(l.color ?? SERIES_VARS[i % SERIES_VARS.length], "#2a78d6");
      const data = dates.map((d, k) => ({ time: toTime(d), value: l.values[k] })).filter((p): p is { time: Time; value: number } => p.value !== null && Number.isFinite(p.value));
      const s = l.area
        ? chart.addSeries(AreaSeries, { lineColor: color, topColor: rgba(color, 0.28), bottomColor: rgba(color, 0.04), lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
        : chart.addSeries(LineSeries, { color, lineWidth: 2, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false });
      s.setData(data);
      if (i === 0 && baseline !== undefined) s.createPriceLine({ price: baseline, color: cssVar("--axis", "#ccc"), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    });
    chart.timeScale().fitContent();
    const onMove = (p: MouseEventParams<Time>) => setHover(p.time !== undefined ? (idx.get(String(p.time)) ?? null) : null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [dates, lines, format, log, baseline, idx, themeV]);

  const at = hover ?? dates.length - 1;
  return (
    <figure className="flex flex-col gap-2" aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="num text-muted">{dates[at]}</span>
          {lines.map((l, i) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: `var(${l.color ?? SERIES_VARS[i % SERIES_VARS.length]})`, height: 3, opacity: l.dashed ? 0.7 : 1 }} />
              <span className="text-ink-2">{l.label}</span>
              <span className="num font-semibold">{formatValue(l.values[at], format)}</span>
            </span>
          ))}
        </div>
        {logToggle && (
          <div className="seg" role="group" aria-label="세로축">
            <button type="button" aria-pressed={!log} onClick={() => setLog(false)}>
              일반 축
            </button>
            <button type="button" aria-pressed={log} onClick={() => setLog(true)}>
              로그 축
            </button>
          </div>
        )}
      </div>
      <div ref={ref} style={{ height }} className="w-full" />
    </figure>
  );
}

export interface BarSeries {
  label: string;
  values: (number | null)[];
  color?: string;
}

/** 묶음 막대 (음수 포함). 카테고리를 가리키면 모든 계열 값을 보여 준다 */
export function GroupedBars({ categories, series, format, height = 220, ariaLabel }: { categories: string[]; series: BarSeries[]; format: ValueFormat; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!categories.length) return null;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const W = 720;
  const padL = 48;
  const padB = 22;
  const top = 8;
  const innerH = height - padB - top;
  const y = (v: number) => top + ((max - v) / span) * innerH;
  const group = (W - padL) / categories.length;
  const gap = 2;
  const bw = Math.max(2, Math.min(22, (group - 6) / series.length - gap));
  const step = Math.ceil(categories.length / 12);
  const ticks = [max, (max + min) / 2, min].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure className="relative" aria-label={ariaLabel}>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `var(${s.color ?? SERIES_VARS[i % SERIES_VARS.length]})` }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {formatValue(t, format)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
        {categories.map((c, ci) => {
          const gx = padL + ci * group + (group - series.length * (bw + gap)) / 2;
          return (
            <g key={c} onMouseEnter={() => setHover(ci)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(ci)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={padL + ci * group} y={0} width={group} height={height - padB} fill={hover === ci ? "var(--surface-2)" : "transparent"} />
              {series.map((s, si) => {
                const v = s.values[ci];
                if (v === null || !Number.isFinite(v)) return null;
                const y0 = y(Math.max(0, v));
                const h = Math.max(1, Math.abs(y(v) - y(0)));
                return <rect key={si} x={gx + si * (bw + gap)} y={y0} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={`var(${s.color ?? SERIES_VARS[si % SERIES_VARS.length]})`} />;
              })}
              {ci % step === 0 && (
                <text x={padL + ci * group + group / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {c}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-6 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow">
          <p className="font-semibold">{categories[hover]}</p>
          {series.map((s) => (
            <p key={s.label} className="num">
              {s.label}: {formatValue(s.values[hover], format)}
            </p>
          ))}
        </div>
      )}
    </figure>
  );
}

/** 월별 수익률 히트맵 */
export function ReturnHeatmap({ monthly, annual }: { monthly: { ym: string; retPct: number }[]; annual: { year: string; retPct: number; partial: boolean }[] }) {
  const years = [...new Set(monthly.map((m) => m.ym.slice(0, 4)))];
  const byYm = new Map(monthly.map((m) => [m.ym, m.retPct]));
  const byYear = new Map(annual.map((a) => [a.year, a]));
  const cell = (v: number | undefined) => {
    if (v === undefined) return { background: "transparent" };
    const a = Math.min(1, Math.abs(v) / 8);
    if (Math.abs(v) < 0.05) return { background: "var(--surface-2)" };
    return { background: `color-mix(in srgb, var(${v > 0 ? "--up" : "--down"}) ${Math.round(10 + a * 55)}%, var(--surface))` };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-[11px]">
        <thead>
          <tr className="text-muted">
            <th className="px-1 text-left font-semibold">연도</th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i} className="px-1 text-center font-semibold">
                {i + 1}월
              </th>
            ))}
            <th className="px-1 text-center font-semibold">연간</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <th className="px-1 text-left font-semibold">{y}</th>
              {Array.from({ length: 12 }, (_, i) => {
                const v = byYm.get(`${y}-${String(i + 1).padStart(2, "0")}`);
                return (
                  <td key={i} className="num rounded px-1 py-1 text-center" style={cell(v)} title={v !== undefined ? `${y}-${i + 1}: ${pct(v)}` : "데이터 없음"}>
                    {v !== undefined ? v.toFixed(1) : ""}
                  </td>
                );
              })}
              <td className="num rounded px-1 py-1 text-center font-semibold" style={cell(byYear.get(y)?.retPct)} title={byYear.get(y)?.partial ? "부분 기간" : undefined}>
                {byYear.get(y) ? `${byYear.get(y)!.retPct.toFixed(1)}${byYear.get(y)!.partial ? "*" : ""}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">단위 %. 시간가중 수익률(추가 납입 효과 제외). * 표시는 1년 전체가 아닌 부분 기간. 색: 상승·하락 (설정의 색 규칙을 따름), 0% 근처는 회색.</p>
    </div>
  );
}

/** 가로 막대 비중 목록 */
export function WeightBars({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it) => {
        const p = (it.value / total) * 100;
        return (
          <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
            <span className="truncate">{it.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
            </span>
            <span className="num text-right text-xs">{p.toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}
