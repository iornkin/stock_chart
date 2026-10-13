/**
 * 미국 주식시장(NYSE/Nasdaq) 거래 캘린더.
 * - 정규장: 09:30–16:00 ET, 조기 폐장일 13:00 ET
 * - 프리마켓 04:00–09:30, 애프터마켓 16:00–20:00 (정보 표시용)
 */
import { EXTRA_CLOSURES, EXTRA_EARLY_CLOSES, CANCELLED_HOLIDAYS } from "@/config/market-calendar-overrides";
import { addDays, etDate, etParts, etToUtc, pad2, weekdayOf } from "./time";

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** n번째 요일 (weekday 0=일) */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return ymd(year, month, day);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWd = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return ymd(year, month, lastDay - ((lastWd - weekday + 7) % 7));
}

/** 부활절 (Anonymous Gregorian algorithm) */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** 토요일 → 금요일, 일요일 → 월요일 대체 휴일 */
function observed(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  if (wd === 6) return addDays(dateStr, -1);
  if (wd === 0) return addDays(dateStr, 1);
  return dateStr;
}

const holidayCache = new Map<number, Map<string, string>>();

export function holidaysForYear(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const map = new Map<string, string>();
  // 신정: 토요일이면 전년도 12/31 은 휴장하지 않음 (NYSE 규칙)
  const ny = ymd(year, 1, 1);
  const nyWd = weekdayOf(ny);
  if (nyWd === 0) map.set(ymd(year, 1, 2), "신정 (대체)");
  else if (nyWd !== 6) map.set(ny, "신정");
  map.set(nthWeekday(year, 1, 1, 3), "마틴 루터 킹 주니어 데이");
  map.set(nthWeekday(year, 2, 1, 3), "워싱턴 탄생일 (Presidents' Day)");
  map.set(addDays(easter(year), -2), "성금요일 (Good Friday)");
  map.set(lastWeekday(year, 5, 1), "메모리얼 데이");
  if (year >= 2022) map.set(observed(ymd(year, 6, 19)), "준틴스 (Juneteenth)");
  map.set(observed(ymd(year, 7, 4)), "독립기념일");
  map.set(nthWeekday(year, 9, 1, 1), "노동절 (Labor Day)");
  map.set(nthWeekday(year, 11, 4, 4), "추수감사절");
  map.set(observed(ymd(year, 12, 25)), "크리스마스");
  for (const [d, name] of Object.entries(EXTRA_CLOSURES)) if (d.startsWith(`${year}-`)) map.set(d, name);
  for (const d of CANCELLED_HOLIDAYS) map.delete(d);
  holidayCache.set(year, map);
  return map;
}

export function holidayName(dateStr: string): string | null {
  const year = Number(dateStr.slice(0, 4));
  return holidaysForYear(year).get(dateStr) ?? null;
}

export function isTradingDay(dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  if (wd === 0 || wd === 6) return false;
  return holidayName(dateStr) === null;
}

/** 조기 폐장 시각 (없으면 null) */
export function earlyCloseTime(dateStr: string): string | null {
  if (EXTRA_EARLY_CLOSES[dateStr]) return EXTRA_EARLY_CLOSES[dateStr];
  if (!isTradingDay(dateStr)) return null;
  const year = Number(dateStr.slice(0, 4));
  // 독립기념일 전날(7/3)이 거래일이면 13:00 폐장
  if (dateStr === ymd(year, 7, 3)) return "13:00";
  // 추수감사절 다음 날
  if (dateStr === addDays(nthWeekday(year, 11, 4, 4), 1)) return "13:00";
  // 크리스마스 이브 (평일이며 휴장일이 아닌 경우)
  if (dateStr === ymd(year, 12, 24)) return "13:00";
  return null;
}

export interface SessionTimes {
  date: string;
  preOpen: number;
  open: number;
  close: number;
  postClose: number;
  earlyClose: boolean;
}

export function sessionTimes(dateStr: string): SessionTimes {
  const ec = earlyCloseTime(dateStr);
  return {
    date: dateStr,
    preOpen: etToUtc(dateStr, "04:00"),
    open: etToUtc(dateStr, "09:30"),
    close: etToUtc(dateStr, ec ?? "16:00"),
    postClose: etToUtc(dateStr, ec ? "17:00" : "20:00"),
    earlyClose: ec !== null,
  };
}

export function previousTradingDay(dateStr: string): string {
  let d = addDays(dateStr, -1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDays(d, -1);
  return d;
}

export function nextTradingDay(dateStr: string): string {
  let d = addDays(dateStr, 1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}

export type MarketPhase = "pre" | "regular" | "post" | "closed";

export interface MarketStatus {
  now: number;
  etDate: string;
  phase: MarketPhase;
  isTradingDay: boolean;
  /** 휴장 사유 (주말/공휴일) */
  closedReason: "weekend" | "holiday" | null;
  holidayName: string | null;
  earlyClose: boolean;
  /** 정규장이 마감된 마지막 거래일 (오늘 장 마감 후면 오늘) */
  lastCompletedSession: string;
  /** 현재 진행 중이거나 다음에 열릴 정규장 날짜 */
  nextSessionDate: string;
  nextOpen: number;
  todayClose: number | null;
  label: string;
}

export function marketStatus(now = Date.now()): MarketStatus {
  const today = etDate(now);
  const trading = isTradingDay(today);
  const wd = etParts(now).weekday;
  const hname = holidayName(today);
  let phase: MarketPhase = "closed";
  let todayClose: number | null = null;
  let earlyClose = false;
  if (trading) {
    const s = sessionTimes(today);
    todayClose = s.close;
    earlyClose = s.earlyClose;
    if (now >= s.preOpen && now < s.open) phase = "pre";
    else if (now >= s.open && now < s.close) phase = "regular";
    else if (now >= s.close && now < s.postClose) phase = "post";
  }
  const sessionDoneToday = trading && todayClose !== null && now >= todayClose;
  const lastCompletedSession = sessionDoneToday ? today : previousTradingDay(today);
  const nextSessionDate = trading && !sessionDoneToday ? today : nextTradingDay(today);
  const nextOpen = sessionTimes(nextSessionDate).open;
  const closedReason = trading ? null : wd === 0 || wd === 6 ? "weekend" : "holiday";
  const label =
    phase === "regular"
      ? earlyClose
        ? "정규장 개장 중 (조기 폐장일)"
        : "정규장 개장 중"
      : phase === "pre"
        ? "프리마켓"
        : phase === "post"
          ? "애프터마켓 (정규장 마감)"
          : closedReason === "weekend"
            ? "휴장 (주말)"
            : closedReason === "holiday"
              ? `휴장 (${hname})`
              : sessionDoneToday
                ? "장 마감"
                : "개장 전";
  return {
    now,
    etDate: today,
    phase,
    isTradingDay: trading,
    closedReason,
    holidayName: hname,
    earlyClose,
    lastCompletedSession,
    nextSessionDate,
    nextOpen,
    todayClose,
    label,
  };
}

/** 다가오는 휴장일 목록 */
export function upcomingHolidays(fromDate: string, days = 60): { date: string; name: string }[] {
  const out: { date: string; name: string }[] = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(fromDate, i);
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    const n = holidayName(d);
    if (n) out.push({ date: d, name: n });
  }
  return out;
}
