import { afterEach, describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/redact";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("redactSecrets (비밀 값 가리기)", () => {
  it("여러 줄로 잘못 넣은 비밀 값의 각 줄과 KEY=값 형태를 가린다", () => {
    process.env.SEC_USER_AGENT = "MySite me@mail.com\nFINNHUB_API_KEY=abcdef123456\nFRED_API_KEY=0123456789abcdef";
    process.env.FINNHUB_API_KEY = "";
    const msg = `Headers.append: "MySite me@mail.com\nFINNHUB_API_KEY=abcdef123456\nFRED_API_KEY=0123456789abcdef" is an invalid header value.`;
    const out = redactSecrets(msg);
    expect(out).not.toContain("abcdef123456");
    expect(out).not.toContain("0123456789abcdef");
    expect(out).not.toContain("me@mail.com");
  });
  it("환경변수에 들어 있는 키 값이 오류 문구에 나오면 가린다", () => {
    process.env.FRED_API_KEY = "zzzz9999yyyy8888";
    expect(redactSecrets("request failed: api_key zzzz9999yyyy8888 invalid")).toBe("request failed: api_key *** invalid");
  });
  it("일반 오류 문구와 예시 주소는 그대로 둔다", () => {
    process.env.FRED_API_KEY = "";
    expect(redactSecrets("FRED_API_KEY 미설정 — 경제지표 일정 미수집")).toBe("FRED_API_KEY 미설정 — 경제지표 일정 미수집");
    expect(redactSecrets("예: 'MyStockSite contact@example.com'")).toBe("예: 'MyStockSite contact@example.com'");
  });
});

describe("환경변수 값 정리", () => {
  it("'이름=값' 형태나 앞뒤 공백을 붙여 넣어도 값만 쓴다", async () => {
    const { env } = await import("@/lib/env");
    process.env.FINNHUB_API_KEY = " FINNHUB_API_KEY=abc123 \n";
    expect(env.finnhubKey).toBe("abc123");
    process.env.FRED_API_KEY = '"q1w2e3"';
    expect(env.fredKey).toBe("q1w2e3");
  });
});
