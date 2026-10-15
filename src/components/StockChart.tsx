"use client";
/**
 * 전문 주가 차트 (TradingView Lightweight Charts v5)
 * - 캔들/라인/영역, 기간(1일~전체), 봉 간격(1분~월봉)
 * - 거래량(상승·하락 색상, 이동평균) 패널, 보조지표마다 별도 패널 — 모든 패널이 같은 시간축 공유
 * - 기술적 지표(추세·모멘텀·변동성·거래량 27종): 추가·제거·숨김·파라미터 변경·여러 개 동시 표시·이름 붙여 저장/불러오기
 *   계산은 lib/ta.ts (전략 백테스트와 같은 함수), 목록은 lib/ta-registry.ts
 * - 십자선 위치의 날짜·시각(ET), 시가·고가·저가·종가, 거래량, 추정 거래대금, 직전 봉 대비 변동률 표시
 * - 마우스 휠/드래그/핀치로 확대·축소 및 과거 구간 이동
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { sma, cleanBars, type Series } from "@/lib/ta";
import { INDICATORS, INDICATOR_BY_KEY, cleanParams, defaultParams, type IndGroup, type IndicatorDef } from "@/lib/ta-registry";
import { etDate, etOffsetMinutes, formatEt } from "@/lib/time";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { DEFAULT_CHART_INDICATORS, usePrefs, type ChartIndicator, type ChartPrefs } from "@/lib/client/prefs";
import { chartUrl, getJson } from "@/lib/client/data-api";
import { IS_STATIC } from "@/lib/static-mode";

type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";
type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";

const RANGES: Record<RangeKey, { label: string; intervals: Interval[]; def: Interval; sessions?: number; days?: number }> = {
  "1D": { label: "1일", intervals: ["1m", "5m", "15m", "30m"], def: "5m", sessions: 1 },
  "5D": { label: "5일", intervals: ["1m", "5m", "15m", "30m", "60m"], def: "15m", sessions: 5 },
  "1M": { label: "1개월", intervals: ["15m", "30m", "60m", "1d"], def: "60m", days: 31 },
  "3M": { label: "3개월", intervals: ["60m", "1d", "1wk"], def: "1d", days: 92 },
  "6M": { label: "6개월", intervals: ["60m", "1d", "1wk"], def: "1d", days: 183 },
  "1Y": { label: "1년", intervals: ["60m", "1d", "1wk"], def: "1d", days: 365 },
  "5Y": { label: "5년", intervals: ["1d", "1wk", "1mo"], def: "1wk", days: 1826 },
  MAX: { label: "전체", intervals: ["1d", "1wk", "1mo"], def: "1mo" },
};

const INTERVAL_LABEL: Record<Interval, string> = {
  "1m": "1분봉",
  "5m": "5분봉",
  "15m": "15분봉",
  "30m": "30분봉",
  "60m": "1시간봉",
  "1d": "일봉",
  "1wk": "주봉",
  "1mo": "월봉",
};

type RawBar = [number, number, number, number, number, number];

interface ChartResponse {
  interval?: Interval;
  bars: RawBar[];
  meta: { source: string | null; fetchedAt: number | null; stale: boolean; error: string | null };
  dividends?: { exDate: string; amount: number; kind: string }[];
  error?: string;
}

interface Legend {
  label: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  chg: number | null;
  ind: { name: string; value: string; color: string }[];
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-colors"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setV((x) => x + 1);
    mq.addEventListener("change", on);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", on);
    };
  }, []);
  return v;
}

const isIntraday = (i: Interval) => !["1d", "1wk", "1mo"].includes(i);

function toTime(t: number, intraday: boolean): Time {
  if (!intraday) return etDate(t * 1000) as Time;
  // 차트 라이브러리는 UTC 로 표시하므로 ET 오프셋만큼 이동해 ET 시각으로 보이게 한다
  return (t + etOffsetMinutes(t * 1000) * 60) as UTCTimestamp;
}

const GROUPS: IndGroup[] = ["추세", "모멘텀", "변동성", "거래량"];
const MAX_INDICATORS = 12;
const label = (d: IndicatorDef, p: Record<string, number>) => (d.params.length ? `${d.name.split(" ")[0]}(${d.params.map((x) => p[x.key]).join(",")})` : d.name.split(" ")[0]);

export default function StockChart({ symbol, initialRange = "1Y" }: { symbol: string; initialRange?: string }) {
  const [prefs, setPrefs] = usePrefs();
  const cp = prefs.chart;
  const [range, setRange] = useState<RangeKey>((Object.keys(RANGES).includes(initialRange) ? initialRange : "1Y") as RangeKey);
  const [interval, setIntervalState] = useState<Interval>(RANGES[range].def);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const themeV = useThemeVersion();

  // 데이터 로드
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getJson<ChartResponse>(chartUrl(symbol, interval))
      .then((j) => {
        if (!j.bars?.length) throw new Error(j.error ?? "가격 데이터가 없습니다");
        return j;
      })
      .then((j) => alive && setData(j))
      .catch((e) => {
        if (!alive) return;
        setData(null);
        setError(String(e.message ?? e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, interval, reload]);

  const intraday = isIntraday(interval);
  // 봉 간격을 바꾼 직후에는 이전 간격의 데이터로 차트를 그리지 않는다. 정렬·중복·비정상 봉은 정리하고 몇 개였는지 표시
  const { bars, quality } = useMemo(() => {
    const raw = data && data.interval === interval ? data.bars : [];
    if (!raw.length) return { bars: [] as RawBar[], quality: null };
    const c = cleanBars(raw.map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })));
    const valid = c.bars.filter((b) => Number.isFinite(b.c)).map((b) => [b.t as number, b.o, b.h, b.l, b.c, b.v] as RawBar);
    return { bars: valid, quality: c.duplicates || c.invalid || c.unsorted ? c : null };
  }, [data, interval]);
  // 거래량이 필요한데 거래량 데이터가 없는 지표 (지수 등)
  const skipped = useMemo(() => {
    if (!bars.length || bars.some((b) => b[5] > 0)) return [];
    return cp.indicators.filter((x) => !x.hidden && INDICATOR_BY_KEY.get(x.key)?.needs === "hlcv").map((x) => `${INDICATOR_BY_KEY.get(x.key)?.name} (거래량 데이터 없음)`);
  }, [bars, cp.indicators]);

  // 차트 생성/갱신
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !bars.length) return;
    const prevRange: LogicalRange | null = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
    const prevKey = (el.dataset.key ?? "") as string;
    chartRef.current?.remove();
    chartRef.current = null;

    const C = {
      bg: cssVar("--surface", "#fcfcfb"),
      text: cssVar("--text-2", "#52514e"),
      grid: cssVar("--grid", "#e1e0d9"),
      axis: cssVar("--axis", "#c3c2b7"),
      up: cssVar("--up", "#d03b3b"),
      down: cssVar("--down", "#2a6fd0"),
      s: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--s${i}`, "#2a78d6")),
      muted: cssVar("--muted", "#898781"),
    };
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor: C.text,
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        panes: { separatorColor: C.axis, separatorHoverColor: C.grid, enableResize: true },
        attributionLogo: true,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.axis },
      timeScale: { borderColor: C.axis, timeVisible: intraday, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "ko-KR" },
    });
    const lastClose = bars[bars.length - 1][4];
    const pricePrecision = lastClose < 1 ? 4 : 2;
    const priceFormat = { type: "price" as const, precision: pricePrecision, minMove: 1 / 10 ** pricePrecision };
    chartRef.current = chart;

    const times = bars.map((b) => toTime(b[0], intraday));
    const closes = bars.map((b) => b[4]);

    // 가격
    let main: ISeriesApi<SeriesType>;
    if (cp.type === "candle") {
      main = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down, priceFormat });
      main.setData(bars.map((b, i) => ({ time: times[i], open: b[1], high: b[2], low: b[3], close: b[4] })));
    } else if (cp.type === "area") {
      main = chart.addSeries(AreaSeries, { lineColor: C.s[0], topColor: `${C.s[0]}55`, bottomColor: `${C.s[0]}05`, lineWidth: 2, priceFormat });
      main.setData(bars.map((b, i) => ({ time: times[i], value: b[4] })));
    } else {
      main = chart.addSeries(LineSeries, { color: C.s[0], lineWidth: 2, priceFormat });
      main.setData(bars.map((b, i) => ({ time: times[i], value: b[4] })));
    }

    const lineFrom = (vals: Series) =>
      vals.map((v, i) => (v === null ? { time: times[i] } : { time: times[i], value: v }));
    const overlays: { name: string; series: ISeriesApi<"Line">; values: Series; color: string }[] = [];
    let ci = 1;
    const addOverlay = (name: string, values: Series, color: string, style: LineStyle = LineStyle.Solid, pane = 0, width: 1 | 2 = 2, fmt: "price" | "volume" | "osc" | "rsi" = "price") => {
      const pf =
        fmt === "volume"
          ? { type: "volume" as const }
          : fmt === "osc"
            ? { type: "price" as const, precision: 3, minMove: 0.001 }
            : fmt === "rsi"
              ? { type: "price" as const, precision: 1, minMove: 0.1 }
              : priceFormat;
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf }, pane);
      s.setData(lineFrom(values));
      overlays.push({ name, series: s, values, color });
      return s;
    };
    const hlcv = { h: bars.map((b) => b[2]), l: bars.map((b) => b[3]), c: closes, v: bars.map((b) => b[5]) };
    const hasVolume = hlcv.v.some((x) => x > 0);
    const active = cp.indicators.filter((x) => !x.hidden && INDICATOR_BY_KEY.has(x.key));
    const ownPanes: { def: IndicatorDef; ind: ChartIndicator }[] = [];
    const sessionKey = intraday ? (i: number) => etDate(bars[i][0] * 1000) : undefined;
    for (const ind of active) {
      const def = INDICATOR_BY_KEY.get(ind.key) as IndicatorDef;
      if (def.needs === "hlcv" && !hasVolume) continue;
      if (def.pane === "own") {
        ownPanes.push({ def, ind });
        continue;
      }
      const p = cleanParams(def, ind.params);
      for (const ln of def.compute(hlcv, p, { sessionKey })) {
        const st = ln.style === "dashed" ? LineStyle.Dashed : ln.style === "dotted" ? LineStyle.Dotted : LineStyle.Solid;
        addOverlay(`${ln.label}${ln.displayOnly ? "" : ""}`, ln.values, C.s[ci++ % 8], st, 0, ln.style === "dotted" ? 1 : 2);
      }
    }

    // 배당락 표시
    if (cp.showDividends && !intraday && data?.dividends?.length) {
      const firstDate = etDate(bars[0][0] * 1000);
      const markers = data.dividends
        .filter((d) => d.exDate >= firstDate)
        .map((d) => {
          // 주·월봉은 배당락일이 속한 봉에 표시
          let idx = times.findIndex((t) => (t as string) >= d.exDate);
          if (interval !== "1d") idx = Math.max(0, (idx === -1 ? times.length : idx) - ((times[idx] as string) === d.exDate ? 0 : 1));
          if (idx < 0 || idx >= times.length) return null;
          return { time: times[idx], position: "belowBar" as const, color: C.s[2], shape: "circle" as const, text: "D", size: 0.6 };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (markers.length) createSeriesMarkers(main, markers);
    }

    // 거래량 패널
    let pane = 1;
    const volPane = pane++;
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, volPane);
    vol.setData(bars.map((b, i) => ({ time: times[i], value: b[5], color: `${b[4] >= b[1] ? C.up : C.down}99` })));
    const volMa = sma(bars.map((b) => b[5]), cp.volMaPeriod);
    addOverlay(`거래량 MA${cp.volMaPeriod}`, volMa, C.s[3], LineStyle.Solid, volPane, 1, "volume");

    // 보조지표: 지표마다 별도 패널 (같은 시간축)
    for (const { def, ind } of ownPanes) {
      const pn = pane++;
      const p = cleanParams(def, ind.params);
      const fmt = def.fmt === "volume" ? "volume" : def.fmt === "price" ? "price" : "osc";
      let first: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | null = null;
      for (const ln of def.compute(hlcv, p, { sessionKey })) {
        if (ln.style === "hist") {
          const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 3, minMove: 0.001 } }, pn);
          h.setData(ln.values.map((v, i) => (v === null ? { time: times[i] } : { time: times[i], value: v, color: `${v >= 0 ? C.up : C.down}aa` })));
          overlays.push({ name: ln.label, series: h as unknown as ISeriesApi<"Line">, values: ln.values, color: C.muted });
          first ??= h;
          continue;
        }
        const st = ln.style === "dashed" ? LineStyle.Dashed : ln.style === "dotted" ? LineStyle.Dotted : LineStyle.Solid;
        const sr = addOverlay(ln.label, ln.values, C.s[ci++ % 8], st, pn, ln.style === "dotted" ? 1 : 2, fmt);
        first ??= sr;
      }
      for (const lv of def.levels ?? []) first?.createPriceLine({ price: lv, color: C.axis, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: String(lv) });
    }
    // 패널 높이 비율: 가격 360 : 거래량 90 : RSI·MACD 각 95 (컨테이너 높이와 동일한 비율)
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 360 : i === volPane ? 90 : 95));

    // 표시 구간
    const key = `${symbol}|${interval}|${bars.length}`;
    el.dataset.key = key;
    if (prevRange && prevKey === key) {
      chart.timeScale().setVisibleLogicalRange(prevRange);
    } else {
      const R = RANGES[range];
      let fromIdx = 0;
      if (R.sessions) {
        const sessions = [...new Set(bars.map((b) => etDate(b[0] * 1000)))];
        const firstSession = sessions[Math.max(0, sessions.length - R.sessions)];
        fromIdx = bars.findIndex((b) => etDate(b[0] * 1000) >= firstSession);
      } else if (R.days) {
        const cutoff = bars[bars.length - 1][0] - R.days * 86400;
        fromIdx = Math.max(0, bars.findIndex((b) => b[0] >= cutoff));
      }
      chart.timeScale().setVisibleLogicalRange({ from: fromIdx - 0.5, to: bars.length - 1 + 3 });
    }

    // 범례 (십자선)
    const legendAt = (i: number): Legend => {
      const b = bars[i];
      const prev = i > 0 ? bars[i - 1][4] : null;
      return {
        label: intraday ? formatEt(b[0] * 1000) : interval === "1d" ? etDate(b[0] * 1000) : `${etDate(b[0] * 1000)} 시작 ${INTERVAL_LABEL[interval]}`,
        o: b[1],
        h: b[2],
        l: b[3],
        c: b[4],
        v: b[5],
        chg: prev ? (b[4] / prev - 1) * 100 : null,
        ind: [
          ...overlays
            .filter((o) => o.values[i] !== null && o.values[i] !== undefined)
            .map((o) => ({ name: o.name, value: o.name.startsWith("거래량") || o.name === "OBV" || o.name === "A/D" ? fmtCompact(o.values[i]) : Math.abs(o.values[i] as number) < 10 ? (o.values[i] as number).toFixed(3) : fmtPrice(o.values[i] as number), color: o.color })),
        ],
      };
    };
    setLegend(legendAt(bars.length - 1));
    const timeIndex = new Map(times.map((t, i) => [String(t), i]));
    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setLegend(legendAt(bars.length - 1));
        return;
      }
      const i = timeIndex.get(String(param.time));
      if (i !== undefined) setLegend(legendAt(i));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
    };
  }, [bars, cp, intraday, interval, range, symbol, themeV, data?.dividends]);
  const noVolume = bars.length > 0 && !bars.some((b) => b[5] > 0);
  const ownCount = cp.indicators.filter((x) => {
    const d = INDICATOR_BY_KEY.get(x.key);
    return !x.hidden && d?.pane === "own" && !(noVolume && d.needs === "hlcv");
  }).length;

  useEffect(() => () => {
    chartRef.current?.remove();
    chartRef.current = null;
  }, []);

  const panesHeight = 360 + 90 + 95 * ownCount;

  const selectRange = (r: RangeKey) => {
    setRange(r);
    if (!RANGES[r].intervals.includes(interval)) setIntervalState(RANGES[r].def);
    else if (chartRef.current && containerRef.current) containerRef.current.dataset.key = "";
  };

  const setCp = (patch: Partial<ChartPrefs>) => setPrefs({ chart: { ...cp, ...patch } });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="차트 기간" className="flex flex-wrap rounded-lg border border-line bg-surface-2 p-0.5">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => selectRange(r)}
              aria-pressed={range === r}
              className={`rounded-md px-2.5 py-1 text-xs ${range === r ? "bg-surface font-semibold text-accent shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              {RANGES[r].label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <span className="sr-only">봉 간격</span>
          <select
            value={interval}
            onChange={(e) => setIntervalState(e.target.value as Interval)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
          >
            {RANGES[range].intervals.filter((i) => !(IS_STATIC && i === "1m")).map((i) => (
              <option key={i} value={i}>
                {INTERVAL_LABEL[i]}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="차트 종류" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          {(
            [
              ["candle", "캔들"],
              ["line", "라인"],
              ["area", "영역"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={cp.type === k}
              onClick={() => setCp({ type: k })}
              className={`rounded-md px-2.5 py-1 text-xs ${cp.type === k ? "bg-surface font-semibold text-accent shadow-sm" : "text-ink-2"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <button type="button" aria-pressed={cp.showDividends} onClick={() => setCp({ showDividends: !cp.showDividends })} className={`rounded-md border px-2 py-1 ${cp.showDividends ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2"}`}>
            배당락
          </button>
          <button type="button" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} className="rounded-md border border-line px-2 py-1 font-semibold text-ink-2">
            지표 {cp.indicators.length}개 · 설정
          </button>
        </div>
      </div>

      <ActiveIndicators cp={cp} setCp={setCp} />
      {showSettings && <IndicatorPanel cp={cp} setCp={setCp} />}
      {(quality || skipped.length > 0) && (
        <p className="text-[11px] text-warn">
          {quality ? `데이터 확인: ${quality.unsorted ? "시각 순서 정렬, " : ""}${quality.duplicates ? `같은 시각 중복 ${quality.duplicates}개 정리, ` : ""}${quality.invalid ? `비정상 봉(고가<저가·가격≤0 등) ${quality.invalid}개 제외` : ""}. ` : ""}
          {skipped.length > 0 ? `표시하지 못한 지표: ${skipped.join(", ")}` : ""}
        </p>
      )}

      <div className="relative w-full overflow-hidden rounded-lg border border-line" style={{ height: panesHeight }}>
        <div ref={containerRef} className="absolute inset-0" aria-label={`${symbol} 가격 차트`} role="img" />
        {legend && !error && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-5rem)] rounded-md bg-surface/85 px-2 py-1 text-[11px] leading-relaxed shadow-sm backdrop-blur">
            <div className="font-semibold text-ink">{legend.label}</div>
            <div className="num flex flex-wrap gap-x-2 text-ink-2">
              <span>시 {fmtPrice(legend.o)}</span>
              <span>고 {fmtPrice(legend.h)}</span>
              <span>저 {fmtPrice(legend.l)}</span>
              <span>종 {fmtPrice(legend.c)}</span>
              <span className={legend.chg === null ? "" : legend.chg >= 0 ? "text-up" : "text-down"}>{fmtPct(legend.chg)}</span>
            </div>
            <div className="num flex flex-wrap gap-x-2 text-ink-2">
              <span>거래량 {fmtCompact(legend.v)}주</span>
              <span title="종가 × 거래량으로 추정한 값입니다">추정 거래대금 ${fmtCompact(legend.c * legend.v)}</span>
            </div>
            <div className="num hidden flex-wrap gap-x-2 sm:flex">
              {legend.ind.map((x) => (
                <span key={x.name} className="inline-flex items-center gap-1 text-ink-2">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: x.color }} />
                  {x.name} {x.value}
                </span>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/60">
            <span className="text-sm text-muted">차트 데이터를 불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-surface p-4 text-center">
            <p className="text-sm font-semibold text-critical">차트 데이터를 불러오지 못했습니다</p>
            <p className="max-w-md text-xs text-muted">{error}</p>
            <button type="button" onClick={() => setReload((x) => x + 1)} className="rounded-md border border-line px-3 py-1 text-xs">
              다시 시도
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted">
        <span>
          {INTERVAL_LABEL[interval]} · 시각은 미국 동부 시간(ET) · 정규장 데이터 · 거래량 색상은 봉의 상승(종가≥시가)/하락 기준
          {cp.indicators.some((x) => x.key === "vwap" && !x.hidden) ? (intraday ? " · VWAP 은 거래일마다 새로 시작" : " · 일봉 이상에서 VWAP 은 n봉 이동 VWAP") : ""} · 지표는 과거 데이터로 계산한 값이며 미래 가격을 알려 주지 않습니다</span>
        <span>
        </span>
        {data?.meta && (
          <span className={data.meta.stale ? "text-warn" : ""}>
            출처 {data.meta.source ?? "-"} · 갱신 {formatEt(data.meta.fetchedAt)}
            {data.meta.stale ? ` · 최신 조회 실패(${data.meta.error}) — 저장된 과거 데이터 표시 중` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** 차트 위 지표 칩: 숨기기·지우기 (한 번에 보이게) */
function ActiveIndicators({ cp, setCp }: { cp: ChartPrefs; setCp: (p: Partial<ChartPrefs>) => void }) {
  if (!cp.indicators.length) return null;
  return (
    <div className="flex flex-wrap gap-1 text-[11px]" aria-label="차트에 올린 지표">
      {cp.indicators.map((x) => {
        const d = INDICATOR_BY_KEY.get(x.key);
        if (!d) return null;
        const p = cleanParams(d, x.params);
        return (
          <span key={x.id} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${x.hidden ? "border-line text-muted line-through" : "border-line-strong text-ink-2"}`} title={`${d.desc}\n계산: ${d.formula}`}>
            {label(d, p)}
            <button type="button" className="text-muted hover:text-ink" onClick={() => setCp({ indicators: cp.indicators.map((y) => (y.id === x.id ? { ...y, hidden: !y.hidden } : y)) })} aria-label={`${label(d, p)} ${x.hidden ? "보이기" : "숨기기"}`}>
              {x.hidden ? "보이기" : "숨김"}
            </button>
            <button type="button" className="text-muted hover:text-critical" onClick={() => setCp({ indicators: cp.indicators.filter((y) => y.id !== x.id) })} aria-label={`${label(d, p)} 지우기`}>
              ✕
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** 지표 추가·파라미터·저장/불러오기 */
function IndicatorPanel({ cp, setCp }: { cp: ChartPrefs; setCp: (p: Partial<ChartPrefs>) => void }) {
  const [pick, setPick] = useState("sma");
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const add = () => {
    const d = INDICATOR_BY_KEY.get(pick);
    if (!d || cp.indicators.length >= MAX_INDICATORS) return;
    const id = `${d.key}-${Date.now().toString(36)}`;
    setCp({ indicators: [...cp.indicators, { id, key: d.key, params: defaultParams(d) }] });
    setOpen(id);
  };
  const setParam = (id: string, key: string, v: string) => setCp({ indicators: cp.indicators.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: Number(v) } } : x)) });
  const pd = INDICATOR_BY_KEY.get(pick);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          지표 추가
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-line bg-surface px-2 py-1" aria-label="추가할 지표">
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {INDICATORS.filter((d) => d.group === g).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" onClick={add} disabled={cp.indicators.length >= MAX_INDICATORS} className="rounded-md bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-50">
          추가
        </button>
        <span className="text-muted">{cp.indicators.length >= MAX_INDICATORS ? `최대 ${MAX_INDICATORS}개` : pd ? `${pd.desc} (${pd.pane === "price" ? "가격 위에 겹침" : "별도 패널"})` : ""}</span>
      </div>
      {cp.indicators.length > 0 && (
        <ul className="flex flex-col gap-1">
          {cp.indicators.map((x) => {
            const d = INDICATOR_BY_KEY.get(x.key);
            if (!d) return null;
            const p = cleanParams(d, x.params);
            return (
              <li key={x.id} className="rounded border border-line bg-surface px-2 py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="font-semibold" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
                    {label(d, p)} <span className="font-normal text-muted">{d.group} · {d.pane === "price" ? "가격" : "패널"}</span>
                  </button>
                  {d.params.map((q) => (
                    <label key={q.key} className="flex items-center gap-1 text-ink-2">
                      {q.label}
                      <input type="number" className="w-16 rounded border border-line bg-surface px-1 py-0.5" value={x.params[q.key] ?? q.def} min={q.min} max={q.max} step={q.step ?? 1} onChange={(e) => setParam(x.id, q.key, e.target.value)} aria-label={`${d.name} ${q.label}`} />
                    </label>
                  ))}
                  <button type="button" className="ml-auto text-muted" onClick={() => setCp({ indicators: cp.indicators.map((y) => (y.id === x.id ? { ...y, params: defaultParams(d) } : y)) })}>
                    기본값
                  </button>
                </div>
                {open === x.id && (
                  <p className="mt-1 leading-relaxed text-muted">
                    {d.desc} 계산: {d.formula} 범위 밖 값은 가장 가까운 허용값({d.params.map((q) => `${q.label} ${q.min}~${q.max}`).join(", ") || "파라미터 없음"})으로 바뀝니다.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
        <label className="flex flex-col gap-1">
          지금 구성 저장 (이 브라우저)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 추세 보기" maxLength={30} className="rounded border border-line bg-surface px-2 py-1" aria-label="지표 구성 이름" />
        </label>
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1"
          disabled={!name.trim()}
          onClick={() => {
            const saved = [...cp.saved.filter((x) => x.name !== name.trim()), { name: name.trim(), indicators: cp.indicators }].slice(-5);
            setCp({ saved });
            setName("");
          }}
        >
          저장
        </button>
        {cp.saved.map((x) => (
          <span key={x.name} className="inline-flex items-center gap-1">
            <button type="button" className="rounded-md border border-line px-2 py-1" onClick={() => setCp({ indicators: x.indicators })}>
              불러오기: {x.name}
            </button>
            <button type="button" className="text-muted" onClick={() => setCp({ saved: cp.saved.filter((y) => y.name !== x.name) })} aria-label={`${x.name} 저장 지우기`}>
              ✕
            </button>
          </span>
        ))}
        <button type="button" className="ml-auto rounded-md border border-line px-2 py-1" onClick={() => setCp({ indicators: DEFAULT_CHART_INDICATORS })}>
          기본 구성으로
        </button>
        <label className="flex items-center gap-1">
          거래량 이동평균
          <input type="number" min={2} max={200} value={cp.volMaPeriod} onChange={(e) => setCp({ volMaPeriod: Math.min(200, Math.max(2, Number(e.target.value) || 20)) })} className="w-14 rounded border border-line bg-surface px-1 py-0.5" aria-label="거래량 이동평균 기간" />
        </label>
      </div>
    </div>
  );
}
