/**
 * 개인 확인함 (순수 함수) — 알림을 쌓지 않고 '지금 확인할 일'만 모은다
 * - 같은 문제는 같은 키로 만들어 다시 찾아도 한 항목으로 갱신된다.
 * - 확인 완료한 키는 다시 보이지 않고, '나중에'는 정한 시각까지 숨긴다. 종류별로 끌 수 있다.
 */
export type InboxCategory = "alert" | "data" | "journal" | "drift" | "concentration";
export const INBOX_CATEGORY_KO: Record<InboxCategory, string> = {
  alert: "알림 규칙",
  data: "데이터 점검",
  journal: "투자 기록 재검토",
  drift: "목표 비중 이탈",
  concentration: "한 종목 비중 집중",
};
export type Priority = "high" | "medium" | "low";
export const PRIORITY_KO: Record<Priority, string> = { high: "중요", medium: "보통", low: "참고" };

export interface InboxItem {
  key: string;
  category: InboxCategory;
  priority: Priority;
  title: string;
  body: string;
  /** 관련 화면 */
  href: string;
  at: number | null;
}

export interface InboxState {
  done: Record<string, number>;
  snooze: Record<string, number>;
  muted: InboxCategory[];
}

export const EMPTY_INBOX: InboxState = { done: {}, snooze: {}, muted: [] };

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function visibleInbox(items: InboxItem[], st: InboxState, now: number): InboxItem[] {
  const seen = new Set<string>();
  return items
    .filter((i) => {
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      if (st.muted.includes(i.category)) return false;
      if (st.done[i.key]) return false;
      const s = st.snooze[i.key];
      return !(s && s > now);
    })
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || (b.at ?? 0) - (a.at ?? 0));
}

/** 더 이상 나타나지 않는 항목의 상태를 지워 저장 공간이 계속 늘지 않게 한다 */
export function pruneInbox(st: InboxState, liveKeys: string[], now: number): InboxState {
  const live = new Set(liveKeys);
  const keep = (rec: Record<string, number>, isSnooze: boolean) => Object.fromEntries(Object.entries(rec).filter(([k, v]) => live.has(k) && (!isSnooze || v > now)));
  return { done: keep(st.done, false), snooze: keep(st.snooze, true), muted: st.muted };
}
