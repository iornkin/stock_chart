"use client";
/**
 * 포지션·심리 화면용 SVG 차트 (호버 툴팁·범례·하나의 축)
 * - StackedShareBars: 합계 100% 구성 막대 (강세·중립·약세)
 * - LineSvg: 같은 단위의 선 1~2개 (+ 기준선)
 * - ColumnSvg: 단일 계열 막대 (공매도 잔고 추이)
 * 색은 계열 고유값(var(--s1) 등), 글자는 글자 색. 값은 표·툴팁으로도 확인할 수 있다.
 */
import { useState } from "react";

const W = 640;
const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export type Fmt = "pct" | "ratio" | "pp" | "compact";
export function fmtValue(v: number | null | undefined, f: Fmt): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  if (f === "pct") return `${v.toFixed(1)}%`;
  if (f === "pp") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p`;
  if (f === "ratio") return v.toFixed(2);
  return compact(v);
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <svg width="16" height="8" aria-hidden>
            {i.dashed ? <line x1="0" y1="4" x2="16" y2="4" stroke={i.color} strokeWidth="2" strokeDasharray="4 3" /> : <rect x="0" y="1" width="16" height="6" rx="2" fill={i.color} />}
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, children }: { x: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-surface px-2 py-1 text-[11px] shadow-sm" style={{ left: `${Math.min(Math.max((x / W) * 100, 12), 70)}%` }}>
      {children}
    </div>
  );
}

/** 합계 100% 구성 막대 — keys 순서대로 아래에서 위로 쌓는다 */
export function StackedShareBars({ rows, keys, ariaLabel, height = 200 }: { rows: { label: string; values: number[] }[]; keys: { label: string; color: string }[]; ariaLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return null;
  const padL = 34, padB = 20, top = 6;
  const innerH = height - padB - top;
  const slot = (W - padL) / rows.length;
  const bw = Math.min(24, slot * 0.7);
  const gap = 2;
  const step = Math.ceil(rows.length / 8);
  return (
    <figure className="relative">
      <Legend items={keys} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0, 50, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={top + innerH - (t / 100) * innerH} y2={top + innerH - (t / 100) * innerH} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 4} y={top + innerH - (t / 100) * innerH + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {t}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const sum = r.values.reduce((a, b) => a + b, 0) || 1;
          let y = top + innerH;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${r.label}: ${keys.map((k, j) => `${k.label} ${r.values[j].toFixed(1)}%`).join(", ")}`}>
              <rect x={padL + i * slot} y={top} width={slot} height={innerH} fill="transparent" />
              {r.values.map((v, j) => {
                const h = (v / sum) * innerH;
                y -= h;
                const hh = Math.max(0, h - (j < r.values.length - 1 ? gap : 0));
                return <rect key={j} x={x} y={y + (j < r.values.length - 1 ? gap : 0)} width={bw} height={hh} rx={j === r.values.length - 1 ? 3 : 0} fill={keys[j].color} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {i % step === 0 && (
                <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {r.label.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tip x={padL + hover * slot}>
          <p className="font-semibold">{rows[hover].label}</p>
          {keys.map((k, j) => (
            <p key={k.label} className="num">
              <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: k.color }} />
              {k.label} {rows[hover].values[j].toFixed(1)}%
            </p>
          ))}
        </Tip>
      )}
    </figure>
  );
}

export interface LineSeriesDef {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

/** 같은 단위의 선 차트 (축 하나). refLines 는 기준선(예: 0, 평균) */
export function LineSvg({
  dates,
  series,
  fmt,
  ariaLabel,
  height = 200,
  refLines = [],
  domain,
}: {
  dates: string[];
  series: LineSeriesDef[];
  fmt: Fmt;
  ariaLabel: string;
  height?: number;
  refLines?: { value: number; label: string }[];
  /** 축 범위 고정 (예: 0~100 지수). 없으면 값에 맞춤 */
  domain?: [number, number];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!dates.length || !vals.length) return null;
  const padL = 44, padB = 20, top = 8, padR = 8;
  const innerH = height - padB - top;
  let lo = domain ? domain[0] : Math.min(...vals, ...refLines.map((r) => r.value));
  let hi = domain ? domain[1] : Math.max(...vals, ...refLines.map((r) => r.value));
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = domain ? 0 : (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const X = (i: number) => padL + (dates.length === 1 ? (W - padL - padR) / 2 : (i / (dates.length - 1)) * (W - padL - padR));
  const Y = (v: number) => top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const step = Math.ceil(dates.length / 6);
  const path = (vs: (number | null)[]) => {
    let d = "";
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - padL) / (W - padL - padR)) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };
  return (
    <figure className="relative">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 4} y={Y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {fmtValue(t, fmt)}
            </text>
          </g>
        ))}
        {refLines.map((r) => (
          <line key={r.label} x1={padL} x2={W - padR} y1={Y(r.value)} y2={Y(r.value)} stroke="var(--axis)" strokeWidth="1" strokeDasharray="3 3" />
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
        ))}
        {/* 앞뒤 값이 없는 점(기록이 하루뿐인 경우 등)은 선이 그려지지 않으므로 점으로 표시 */}
        {series.map((s) =>
          s.values.map((v, i) =>
            v !== null && Number.isFinite(v) && !isNum(s.values[i - 1]) && !isNum(s.values[i + 1]) ? <circle key={`${s.key}-${i}`} cx={X(i)} cy={Y(v)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" /> : null,
          ),
        )}
        {/* 기준선 이름은 선 위에 배경색 테두리를 둘러 겹쳐도 읽히게 */}
        {refLines.map((r) => (
          <text key={r.label} x={W - padR} y={Y(r.value) - 3} textAnchor="end" fontSize="10" fill="var(--muted)" stroke="var(--surface)" strokeWidth="3" paintOrder="stroke">
            {r.label}
          </text>
        ))}
        {dates.map((d, i) =>
          i % step === 0 ? (
            <text key={d} x={X(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {d.slice(2)}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={top} y2={top + innerH} stroke="var(--axis)" strokeWidth="1" />
            {series.map((s) => (s.values[hover] !== null && s.values[hover] !== undefined ? <circle key={s.key} cx={X(hover)} cy={Y(s.values[hover]!)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" /> : null))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tip x={X(hover)}>
          <p className="font-semibold">{dates[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="num">
              <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label} {fmtValue(s.values[hover], fmt)}
            </p>
          ))}
        </Tip>
      )}
    </figure>
  );
}

/** 단일 계열 막대 (값이 0 이상) */
export function ColumnSvg({ labels, values, ariaLabel, color = "var(--s1)", height = 180, valueLabel }: { labels: string[]; values: (number | null)[]; ariaLabel: string; color?: string; height?: number; valueLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ok = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!labels.length || !ok.length) return null;
  const padL = 44, padB = 20, top = 6;
  const innerH = height - padB - top;
  const max = Math.max(...ok) || 1;
  const slot = (W - padL) / labels.length;
  const bw = Math.min(24, slot * 0.7);
  const step = Math.ceil(labels.length / 8);
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={top + innerH - f * innerH} y2={top + innerH - f * innerH} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 4} y={top + innerH - f * innerH + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {compact(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const v = values[i];
          const h = v !== null && Number.isFinite(v) ? (v / max) * innerH : 0;
          const x = padL + i * slot + (slot - bw) / 2;
          return (
            <g key={l} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${l}: ${v === null ? "자료 없음" : compact(v)}`}>
              <rect x={padL + i * slot} y={top} width={slot} height={innerH} fill="transparent" />
              {h > 0 && <path d={`M${x},${top + innerH} v${-(h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${h - 3} z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {i % step === 0 && (
                <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {l.slice(2)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tip x={padL + hover * slot}>
          <p className="font-semibold">{labels[hover]}</p>
          <p className="num">
            {valueLabel} {values[hover] === null ? "자료 없음" : (values[hover] as number).toLocaleString("en-US")}
          </p>
        </Tip>
      )}
    </figure>
  );
}
