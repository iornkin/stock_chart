/**
 * NYSE/Nasdaq 정기 휴장일은 src/lib/market-calendar.ts 에서 규칙으로 계산한다.
 * 규칙으로 계산할 수 없는 임시 휴장(국가 애도일 등)이나 조기 폐장은 여기에 추가한다.
 * 출처: NYSE Holidays & Trading Hours 공지 (https://www.nyse.com/markets/hours-calendars)
 */
export const EXTRA_CLOSURES: Record<string, string> = {
  "2025-01-09": "지미 카터 전 대통령 국가 애도일",
};

/** 규칙 외 조기 폐장 (ET 기준 폐장 시각) */
export const EXTRA_EARLY_CLOSES: Record<string, string> = {};

/** 규칙으로 계산된 휴장일을 취소해야 하는 경우 (예외) */
export const CANCELLED_HOLIDAYS: string[] = [];
