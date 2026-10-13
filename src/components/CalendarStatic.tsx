"use client";
/** 정적 사이트의 배당 캘린더: 쿼리 문자열(month·category·type)을 브라우저에서 읽어 저장된 일정으로 다시 그린다 */
import { useCallback, useState } from "react";
import { etDate } from "@/lib/time";
import CalendarView, { parseCalendarQuery, type CalendarDividend, type CalendarQuery } from "./CalendarView";
import UrlParams from "./UrlParams";

export default function CalendarStatic({ divs, builtToday, coverage }: { divs: CalendarDividend[]; builtToday: string; coverage: { from: string; to: string } }) {
  const [today, setToday] = useState(builtToday);
  const [query, setQuery] = useState<CalendarQuery>(() => parseCalendarQuery({}, builtToday));
  const onParams = useCallback((p: URLSearchParams) => {
    const now = etDate();
    setToday(now);
    setQuery(parseCalendarQuery({ month: p.get("month"), category: p.get("category"), type: p.get("type") }, now));
  }, []);
  return (
    <>
      <UrlParams onChange={onParams} />
      <CalendarView query={query} today={today} divs={divs} coverage={coverage} />
    </>
  );
}
