import { describe, expect, it, vi } from "vitest";

// 저장소: 실제 모듈(노드에서는 메모리 저장) + 특정 키 쓰기를 실패시키는 스위치
const fail = { key: null as string | null };
vi.mock("@/lib/client/local-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/client/local-store")>();
  return {
    ...real,
    writeLocal: async (key: string, value: unknown) => {
      // 한 번만 실패 (새 데이터가 커서 용량 부족 → 지운 뒤 원래 데이터로 되돌리기는 성공하는 상황)
      if (fail.key === key) {
        fail.key = null;
        throw new Error("저장 공간 부족 (테스트)");
      }
      return real.writeLocal(key as never, value);
    },
  };
});

const { restoreBundle, validateBundle, BUNDLE_FORMAT } = await import("@/lib/client/backup");
const { readLocal, writeLocal } = await import("@/lib/client/local-store");

const portfolio = (n: number) => ({
  version: 1,
  mode: "ledger",
  simple: { holdings: [], cash: 0 },
  ledger: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: "deposit", date: "2026-01-02", amount: 100, createdAt: i })),
});
const bundle = (data: Record<string, unknown>, browser: Record<string, string> = {}) => ({ format: BUNDLE_FORMAT, version: 1, exportedAt: "x", data, browser });

describe("복원 — 실패해도 기존 데이터를 잃지 않음", () => {
  it("중간에 쓰기가 실패하면 원래 데이터로 되돌리고 오류를 알린다", async () => {
    await writeLocal("portfolio", portfolio(3));
    await writeLocal("strategies", [{ id: "s1", name: "기존 전략", items: [{ symbol: "QQQ", weight: 100 }] }]);
    const v = validateBundle(bundle({ portfolio: portfolio(1), strategies: [] }));
    if (!v.ok) throw new Error(v.error);
    fail.key = "strategies";
    await expect(restoreBundle(v.bundle)).rejects.toThrow(/이전 데이터로 되돌렸습니다/);
    expect(((await readLocal("portfolio")) as { ledger: unknown[] }).ledger).toHaveLength(3);
    expect(((await readLocal("strategies")) as { name: string }[])[0].name).toBe("기존 전략");
  });
  it("정상이면 파일 내용으로 바뀜", async () => {
    const v = validateBundle(bundle({ portfolio: portfolio(5) }));
    if (!v.ok) throw new Error(v.error);
    await restoreBundle(v.bundle);
    expect(((await readLocal("portfolio")) as { ledger: unknown[] }).ledger).toHaveLength(5);
    expect(await readLocal("strategies")).toBeUndefined();
  });
});

describe("복원 파일 검증 (항목 단위)", () => {
  it("잘못된 거래·숫자·날짜·전략 항목을 막고 몇 번째인지 알려 줌", () => {
    const bad = portfolio(2);
    (bad.ledger[1] as Record<string, unknown>).amount = "100";
    expect(validateBundle(bundle({ portfolio: bad }))).toEqual({ ok: false, error: expect.stringContaining("2번째") });
    const badDate = portfolio(1);
    (badDate.ledger[0] as Record<string, unknown>).date = "2026/01/02";
    expect(validateBundle(bundle({ portfolio: badDate })).ok).toBe(false);
    const badType = portfolio(1);
    (badType.ledger[0] as Record<string, unknown>).type = "steal";
    expect(validateBundle(bundle({ portfolio: badType })).ok).toBe(false);
    expect(validateBundle(bundle({ strategies: [{ name: "x", items: [{ symbol: "QQQ", weight: "50" }] }] })).ok).toBe(false);
    expect(validateBundle(bundle({ runs: [1, 2] })).ok).toBe(false);
  });
  it("저장소 사본 키(usi-local:*)는 파일에서 덮어쓰지 않음", () => {
    const v = validateBundle(bundle({}, { "usi-prefs-v1": "{}", "usi-local:portfolio": '{"evil":1}', other: "x" }));
    if (!v.ok) throw new Error(v.error);
    expect(Object.keys(v.bundle.browser)).toEqual(["usi-prefs-v1"]);
  });
  it("모르는 형식·암호화 파일·버전", () => {
    expect(validateBundle({ foo: 1 }).ok).toBe(false);
    expect(validateBundle({ format: "usi-userdata-encrypted" }).ok).toBe(false);
    expect(validateBundle({ format: BUNDLE_FORMAT, version: 2, data: {} }).ok).toBe(false);
  });
});
