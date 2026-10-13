/** 간단한 가격 추이 SVG (최근 종가) */
export default function Sparkline({ values, width = 120, height = 36, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return <div style={{ width, height }} className="text-[10px] text-muted">차트 데이터 없음</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? "가격 추이"} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
