import { describe, expect, it } from "vitest";
import { EMPTY_INBOX, pruneInbox, visibleInbox, type InboxItem } from "@/lib/alerts/inbox";

const it_ = (key: string, o: Partial<InboxItem> = {}): InboxItem => ({ key, category: "data", priority: "medium", title: key, body: "", href: "/", at: 0, ...o });

describe("확인함", () => {
  it("같은 키는 한 번만, 중요도 순", () => {
    const v = visibleInbox([it_("a", { priority: "low" }), it_("b", { priority: "high" }), it_("a", { priority: "low" })], EMPTY_INBOX, 100);
    expect(v.map((x) => x.key)).toEqual(["b", "a"]);
  });
  it("확인 완료·나중에·끈 종류는 숨김, 나중에는 시간이 지나면 다시 보임", () => {
    const items = [it_("a"), it_("b"), it_("c", { category: "journal" })];
    const st = { done: { a: 1 }, snooze: { b: 200 }, muted: ["journal" as const] };
    expect(visibleInbox(items, st, 100)).toEqual([]);
    expect(visibleInbox(items, st, 300).map((x) => x.key)).toEqual(["b"]);
  });
  it("사라진 항목·지난 '나중에' 상태는 정리", () => {
    const st = pruneInbox({ done: { a: 1, gone: 1 }, snooze: { b: 50, c: 500 }, muted: [] }, ["a", "b", "c"], 100);
    expect(st).toEqual({ done: { a: 1 }, snooze: { c: 500 }, muted: [] });
  });
});
