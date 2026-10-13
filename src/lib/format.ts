/** 숫자 표시 유틸리티 (서버·클라이언트 공용) */

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function fmtPrice(v: number | null | undefined, digits?: number): string {
  if (!isNum(v)) return "-";
  const d = digits ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtUsd(v: number | null | undefined, digits?: number): string {
  if (!isNum(v)) return "-";
  return `$${fmtPrice(v, digits)}`;
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "-";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // 반올림 결과가 0 이면 부호를 붙이지 않는다 (−0.00 방지)
  const rounded = Number(Math.abs(v).toFixed(digits));
  return `${rounded === 0 ? "" : v > 0 ? "+" : "−"}${s}`;
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (!isNum(v)) return "-";
  return signed ? `${fmtSigned(v, digits)}%` : `${v.toFixed(digits)}%`;
}

export function fmtCompact(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "-";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits)}K`;
  return `${sign}${a.toFixed(0)}`;
}

export function fmtUsdCompact(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "-";
  return `${v < 0 ? "−" : ""}$${fmtCompact(Math.abs(v), digits)}`;
}

export function fmtVolume(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  return `${fmtCompact(v, 2)}주`;
}

export function fmtInt(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtRatio(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "-";
  return `${v.toFixed(digits)}배`;
}

export function changeClass(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "text-muted";
  return v > 0 ? "text-up" : "text-down";
}

/** 달러 금액(배당 등) — 소수 4자리까지 */
export function fmtDividend(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  const d = v < 0.1 ? 4 : 4;
  return `$${v.toFixed(d).replace(/0{1,2}$/, "")}`;
}
