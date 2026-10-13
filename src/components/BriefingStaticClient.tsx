"use client";
/**
 * 정적 사이트의 브리핑 기록 보기.
 * 서버가 ?date=&session= 을 읽지 못하므로, 브라우저가 쿼리 문자열을 보고 빌드 때 저장한 JSON 을 불러와 표시한다.
 */
import { useCallback, useState, type ReactNode } from "react";
import type { BriefingRecord } from "@/lib/briefing/store";
import type { MarketBriefing, SymbolBriefing } from "@/lib/briefing/types";
import { getJson } from "@/lib/client/data-api";
import { staticDataUrl } from "@/lib/static-mode";
import BriefingIndexView, { pickSession, type BriefingDay, type BriefingIndexProps } from "./BriefingIndexView";
import BriefingView, { MarketBriefingView } from "./BriefingView";
import UrlParams from "./UrlParams";
import { Empty, Notice } from "./ui";

/** 일일 브리핑 목록 (/briefing?date=&session=) */
export function BriefingIndexStatic({ initial }: { initial: BriefingIndexProps }) {
  const [props, setProps] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const onParams = useCallback(
    (p: URLSearchParams) => {
      const date = p.get("date");
      const session = p.get("session");
      setError(null);
      if (!date || !initial.dates.includes(date)) {
        setProps(initial);
        return;
      }
      getJson<BriefingDay>(staticDataUrl(`briefing/day/${date}.json`))
        .then((day) => {
          const s = pickSession(day.items, session);
          setProps({ dates: initial.dates, date, session: s, items: day.items, market: (s && day.markets[s]) || null });
        })
        .catch((e) => setError(String((e as Error).message ?? e)));
    },
    [initial],
  );
  return (
    <>
      <UrlParams onChange={onParams} />
      {error && <Notice tone="warn" title="브리핑 기록을 불러오지 못했습니다">{error}</Notice>}
      <BriefingIndexView {...props} />
    </>
  );
}

/** 종목·시장 브리핑 상세 (/briefing/{scope}?date=&session=) */
export function BriefingRecordStatic({ scope, isMarket, initialKey, children }: { scope: string; isMarket: boolean; initialKey: string | null; children: ReactNode }) {
  const [rec, setRec] = useState<BriefingRecord | null>(null);
  const [state, setState] = useState<"initial" | "loading" | "loaded" | "error">("initial");
  const [error, setError] = useState<string | null>(null);
  const onParams = useCallback(
    (p: URLSearchParams) => {
      const date = p.get("date");
      const session = p.get("session");
      if (!date || !session || `${date}_${session}` === initialKey || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-z_]+$/.test(session)) {
        setState("initial");
        return;
      }
      setState("loading");
      getJson<BriefingRecord>(staticDataUrl(`briefing/${encodeURIComponent(scope)}/${date}_${session}.json`))
        .then((r) => {
          setRec(r);
          setState("loaded");
        })
        .catch((e) => {
          setError(String((e as Error).message ?? e));
          setState("error");
        });
    },
    [scope, initialKey],
  );
  return (
    <>
      <UrlParams onChange={onParams} />
      {state === "initial" && children}
      {state === "loading" && <div className="skeleton h-64" />}
      {state === "error" && <Empty>해당 브리핑을 불러오지 못했습니다 ({error}). 정적 사이트에는 최근 30건의 기록만 저장됩니다.</Empty>}
      {state === "loaded" && rec && (isMarket ? <MarketBriefingView b={rec.content as MarketBriefing} /> : <BriefingView b={rec.content as SymbolBriefing} />)}
    </>
  );
}
