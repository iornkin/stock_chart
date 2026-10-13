"use client";
/** 단일 계열 막대 차트 (분배금 지급 기록·연도별 합계). 호버/포커스 시 툴팁. */
import { useState } from "react";

export interface BarPoint {
  label: string;
  value: number;
  sub?: string;
  muted?: boolean;
}

const FORMATS = {
  usd2: (v: number) => `$${v.toFixed(2)}`,
  usd3: (v: number) => `$${v.toFixed(3)}`,
};

export default function BarChartSvg({ points, height = 180, valueFormat, ariaLabel }: { points: BarPoint[]; height?: number; valueFormat: keyof typeof FORMATS; ariaLabel: string }) {
  const format = FORMATS[valueFormat];
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  // 막대 개수와 관계없이 같은 크기로 그리기 위해 고정 폭 좌표계를 사용
  const W = 640;
  const padL = 44;
  const padB = 22;
  const innerH = height - padB - 8;
  const bw = (W - padL) / points.length;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const step = Math.ceil(points.length / 8);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full max-w-[720px]" role="img" aria-label={ariaLabel}>
        {ticks.map((t, i) => {
          const y = 8 + innerH - (t / max) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
                {format(t)}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const h = Math.max(1, (p.value / max) * innerH);
          const x = padL + i * bw + (bw - Math.max(1, Math.min(48, bw - 2))) / 2;
          const y = 8 + innerH - h;
          const w = Math.max(1, Math.min(48, bw - 2));
          const r = Math.min(4, w / 2);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <rect x={padL + i * bw} y={0} width={bw} height={height - padB} fill="transparent" />
              <path
                d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`}
                fill={p.muted ? "var(--axis)" : hover === i ? "var(--s1)" : "color-mix(in srgb, var(--s1) 80%, transparent)"}
              />
              {i % step === 0 && (
                <text x={padL + i * bw + bw / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
                  {p.label.length > 7 ? p.label.slice(2, 7) : p.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={8 + innerH} y2={8 + innerH} stroke="var(--axis)" strokeWidth="1" />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow">
          <strong className="num">{format(points[hover].value)}</strong> <span className="text-muted">{points[hover].label}</span>
          {points[hover].sub && <div className="text-[10px] text-muted">{points[hover].sub}</div>}
        </div>
      )}
    </div>
  );
}
