/**
 * 미국 동부 시간(America/New_York) 처리 유틸리티.
 * 서머타임(EDT/EST) 전환은 Intl API 가 처리한다.
 */
export const ET_TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=일 ... 6=토
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(d: Date | number): EtParts {
  const date = typeof d === "number" ? new Date(d) : d;
  const out: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WD[out.weekday] ?? 0,
  };
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** ET 기준 날짜 문자열 YYYY-MM-DD */
export function etDate(d: Date | number = Date.now()): string {
  const p = etParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** ET 기준 HH:MM */
export function etTime(d: Date | number = Date.now()): string {
  const p = etParts(d);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 특정 시각의 ET UTC 오프셋(분). EDT=-240, EST=-300 */
export function etOffsetMinutes(d: Date | number): number {
  const date = typeof d === "number" ? new Date(d) : d;
  const p = etParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** ET 기준 'YYYY-MM-DD' + 'HH:MM' → UTC epoch ms */
export function etToUtc(dateStr: string, hhmm = "00:00"): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // 두 번 보정하여 서머타임 경계에서도 정확하게 맞춘다
  let ts = guess - etOffsetMinutes(guess) * 60000;
  ts = guess - etOffsetMinutes(ts) * 60000;
  return ts;
}

/** 'YYYY-MM-DD' 날짜 연산 (UTC 기준 단순 날짜 계산) */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("ko-KR", { timeZone: ET_TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** 사람이 읽는 ET 시각: 2026-10-13 16:00 ET */
export function formatEt(ms: number | null | undefined, withSeconds = false): string {
  if (!ms) return "-";
  const p = etParts(ms);
  const base = `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
  return `${withSeconds ? `${base}:${pad2(p.second)}` : base} ET`;
}

export function formatEtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dateStr} (${wd})`;
}

export function formatEtShort(ms: number): string {
  return fmt("short", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** 상대 시간 (예: 5분 전) */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "-";
  const diff = Math.round((now - ms) / 1000);
  if (diff < 0) return "방금";
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}
