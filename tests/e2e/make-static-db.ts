/**
 * 정적 사이트 e2e 용 DB 만들기 — 합성 데이터 서버(mock-upstream)를 띄우고 예약 작업과 같은 'job all' 을 실행한다.
 * 사용: npx tsx tests/e2e/make-static-db.ts <DB 경로>
 *   → DATABASE_PATH=<DB 경로> BASE_PATH=/stock_chart npm run build:static && npm run test:e2e:static
 * ⚠ 모든 시장 데이터는 합성 데이터이며 실제 시세가 아니다.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { marketStatus, previousTradingDay } from "@/lib/market-calendar";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DB = path.resolve(process.argv[2] ?? "e2e-out/static.db");
const MOCK = Number(process.env.MOCK_PORT ?? 4010);
const M = `http://127.0.0.1:${MOCK}`;

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  DATABASE_PATH: DB,
  RATE_LIMIT_SCALE: "0.02",
  // 정적 사이트 갱신 워크플로처럼 주봉·월봉·분봉까지 모은다
  COLLECT_ALL_INTERVALS: "1",
  YAHOO_QUERY1_BASE: `${M}/yahoo1`,
  YAHOO_QUERY2_BASE: `${M}/yahoo2`,
  YAHOO_COOKIE_URL: `${M}/yahoo-cookie/`,
  NASDAQ_API_BASE: `${M}/nasdaq`,
  GOOGLE_NEWS_BASE: `${M}/gnews`,
  FINNHUB_API_BASE: `${M}/finnhub`,
  FINNHUB_API_KEY: "test-key",
  FRED_API_BASE: `${M}/fred`,
  FRED_API_KEY: "test",
  SEC_API_BASE: `${M}/sec`,
  SEC_WWW_BASE: `${M}/secwww`,
  FINRA_API_BASE: `${M}/finra-api`,
  FINRA_CDN_BASE: `${M}/finra-cdn`,
  CBOE_CDN_BASE: `${M}/cboe-cdn`,
  AAII_BASE: `${M}/aaii`,
  SEC_USER_AGENT: "USI-E2E test@example.com",
  POLYGON_API_KEY: "",
  ALPHAVANTAGE_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  MOCK_PORT: String(MOCK),
};

async function waitFor(url: string, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fetch(url).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} 응답 없음`);
}

async function main() {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  const mock = spawn("npx", ["tsx", "tests/e2e/mock-upstream.ts"], { cwd: ROOT, env, stdio: "ignore", detached: true });
  try {
    await waitFor(`${M}/__stats`);
    const job = (args: string[]) =>
      new Promise<number>((resolve) => {
        const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "scripts/run-job.ts", ...args], { cwd: ROOT, env, stdio: "inherit" });
        p.on("exit", (c) => resolve(c ?? 1));
      });
    // 직전 거래일 브리핑도 만들어 두어 '날짜별 기록' 화면을 확인할 수 있게 한다 (실제 운영에서는 매일 쌓임)
    const prev = previousTradingDay(marketStatus().lastCompletedSession);
    for (const args of [["all"], ["briefing_close", "--force", "--date", prev]]) {
      const code = await job(args);
      if (code !== 0) throw new Error(`job ${args.join(" ")} 종료 코드 ${code}`);
    }
    console.log(`정적 e2e 용 DB: ${DB}`);
  } finally {
    try {
      process.kill(-mock.pid!, "SIGTERM");
    } catch {
      mock.kill("SIGTERM");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
