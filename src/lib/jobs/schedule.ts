/**
 * 자동 업데이트 일정 (미국 동부 시간 기준)
 * 설정 페이지(관리자)에서 변경 가능하며 settings 테이블에 저장된다.
 *
 * 기본 일정과 호출량 (무료 플랜 기준 설계)
 * - 시세: 거래일 04:00~20:00 ET, 15분마다 (Yahoo 일괄 조회 2~4회/실행)
 * - 뉴스: 매일 06:00~22:00 ET, 2시간마다 (종목당 1~3회 호출, 검색어 캐시 공유)
 * - 참조 데이터(재무·ETF·일정·거시): 매일 07:00 ET (20시간 이내 수집분은 건너뜀, SEC 는 주 1회)
 * - 장 마감 데이터(일봉·분봉·배당): 정규장 마감 15분 후
 * - 장중 브리핑: 거래일 12:30 ET (선택)
 * - 장 마감 후 브리핑: 정규장 마감 25분 후 (조기 폐장일은 13:00 기준)
 * - 휴장일 브리핑: 주말·공휴일 10:00 ET
 */
import { getSetting, setSetting } from "../db";
import type { JobName } from "./jobs";

export interface ScheduleConfig {
  quotesIntervalMin: number;
  newsIntervalMin: number;
  newsStart: string;
  newsEnd: string;
  referenceTime: string;
  eodDelayMin: number;
  intradayBriefingEnabled: boolean;
  intradayBriefingTime: string;
  closeBriefingDelayMin: number;
  nonTradingBriefingTime: string;
  cleanupTime: string;
  maxAttempts: number;
  retryDelayMin: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  quotesIntervalMin: 15,
  newsIntervalMin: 120,
  newsStart: "06:00",
  newsEnd: "22:00",
  referenceTime: "07:00",
  eodDelayMin: 15,
  intradayBriefingEnabled: true,
  intradayBriefingTime: "12:30",
  closeBriefingDelayMin: 25,
  nonTradingBriefingTime: "10:00",
  cleanupTime: "03:30",
  maxAttempts: 4,
  retryDelayMin: 15,
};

export function getSchedule(): ScheduleConfig {
  return { ...DEFAULT_SCHEDULE, ...getSetting<Partial<ScheduleConfig>>("schedule", {}) };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule(input: Partial<ScheduleConfig>): { ok: true; value: ScheduleConfig } | { ok: false; error: string } {
  // 알려진 항목만 받고, 숫자·문자·참거짓 형식을 확인한다 (NaN 은 범위 비교를 모두 통과하므로 먼저 막는다)
  const base = getSchedule();
  const v = { ...base };
  for (const [k, val] of Object.entries(input ?? {})) {
    if (!(k in DEFAULT_SCHEDULE)) return { ok: false, error: `알 수 없는 설정 항목: ${k}` };
    const want = typeof DEFAULT_SCHEDULE[k as keyof ScheduleConfig];
    if (want === "number" && !(typeof val === "number" && Number.isFinite(val))) return { ok: false, error: `${k} 는 숫자여야 합니다` };
    if (want !== "number" && typeof val !== want) return { ok: false, error: `${k} 형식이 올바르지 않습니다` };
    (v as Record<string, unknown>)[k] = val;
  }
  for (const k of ["newsStart", "newsEnd", "referenceTime", "intradayBriefingTime", "nonTradingBriefingTime", "cleanupTime"] as const) {
    if (!TIME.test(v[k])) return { ok: false, error: `${k} 형식은 HH:MM 이어야 합니다` };
  }
  if (v.quotesIntervalMin < 5 || v.quotesIntervalMin > 240) return { ok: false, error: "시세 갱신 주기는 5~240분" };
  if (v.newsIntervalMin < 30 || v.newsIntervalMin > 1440) return { ok: false, error: "뉴스 수집 주기는 30~1440분" };
  if (v.closeBriefingDelayMin < 10 || v.closeBriefingDelayMin > 300) return { ok: false, error: "마감 후 브리핑 지연은 10~300분" };
  if (v.eodDelayMin < 5 || v.eodDelayMin > 240) return { ok: false, error: "마감 데이터 수집 지연은 5~240분" };
  if (v.maxAttempts < 1 || v.maxAttempts > 10) return { ok: false, error: "재시도 횟수는 1~10" };
  if (v.retryDelayMin < 1 || v.retryDelayMin > 240) return { ok: false, error: "재시도 간격은 1~240분" };
  return { ok: true, value: v };
}

export function saveSchedule(v: ScheduleConfig) {
  setSetting("schedule", v);
}

export interface ScheduleRow {
  job: JobName;
  when: string;
}

export function describeSchedule(s: ScheduleConfig): ScheduleRow[] {
  return [
    { job: "refresh_quotes", when: `거래일 04:00~20:00 ET, ${s.quotesIntervalMin}분마다 (휴장일 10:00 1회)` },
    { job: "collect_news", when: `매일 ${s.newsStart}~${s.newsEnd} ET, ${s.newsIntervalMin}분마다` },
    { job: "collect_reference", when: `매일 ${s.referenceTime} ET` },
    { job: "collect_eod", when: `거래일 정규장 마감 ${s.eodDelayMin}분 후` },
    { job: "briefing_intraday", when: s.intradayBriefingEnabled ? `거래일 ${s.intradayBriefingTime} ET (정규장 중)` : "사용 안 함" },
    { job: "briefing_close", when: `거래일 정규장 마감 ${s.closeBriefingDelayMin}분 후 (일봉 확정 확인 후 생성)` },
    { job: "briefing_non_trading", when: `주말·공휴일 ${s.nonTradingBriefingTime} ET` },
    { job: "cleanup", when: `매일 ${s.cleanupTime} ET` },
  ];
}
