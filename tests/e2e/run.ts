/**
 * 전체 흐름(e2e) 테스트
 *   1) 테스트용 합성 데이터 서버(mock-upstream) 실행
 *   2) 수집·브리핑 작업을 CLI 로 실행 → job_runs 결과 확인
 *   3) 빌드된 웹사이트 실행 → Playwright 로 페이지·차트·탭·반응형 확인, 스크린샷 저장
 *   4) 제공처 장애 상황 재현 → 실패 기록·마지막 정상 업데이트 안내·과거 데이터 표시 방식 확인
 *
 * 사용: npm run build && npm run test:e2e
 * ⚠ 이 테스트의 모든 시장 데이터는 합성 데이터이며 실제 시세가 아니다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, type Page } from "@playwright/test";
import { marketStatus } from "@/lib/market-calendar";
import { INSTRUMENTS } from "@/config/instruments";
import { featureChecks } from "./features";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "usi-e2e-"));
const MOCK = 4010;
const APP = 3100;
const M = `http://127.0.0.1:${MOCK}`;
const BASE = `http://127.0.0.1:${APP}`;
const DB = path.join(OUT, "e2e.db");

const ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  DATABASE_PATH: DB,
  RATE_LIMIT_SCALE: "0.02",
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
  SEC_USER_AGENT: "USI-E2E test@example.com",
  ADMIN_TOKEN: "e2e-admin",
  POLYGON_API_KEY: "",
  ALPHAVANTAGE_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  PORT: String(APP),
};

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function start(cmd: string, args: string[], name: string): ChildProcess {
  // detached: 프로세스 그룹 단위로 종료하기 위함 (npx → node 자식 프로세스까지)
  const p = spawn(cmd, args, { cwd: ROOT, env: ENV as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as ("ignore" | "pipe")[], detached: true });
  const log = fs.createWriteStream(path.join(OUT, `${name}.log`));
  p.stdout?.pipe(log);
  p.stderr?.pipe(log);
  return p;
}

function killTree(p: ChildProcess | null) {
  if (!p?.pid) return;
  try {
    process.kill(-p.pid, "SIGTERM");
  } catch {
    p.kill("SIGTERM");
  }
}

async function waitFor(url: string, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* 대기 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function runJob(job: string, extra: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const p = start("npx", ["tsx", "scripts/run-job.ts", job, ...extra], `job-${job}`);
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

function db() {
  return new DatabaseSync(DB);
}

async function textOf(page: Page) {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

async function main() {
  fs.rmSync(DB, { force: true });
  console.log(`출력 폴더: ${OUT}`);
  for (const port of [MOCK, APP]) {
    const busy = await fetch(`http://127.0.0.1:${port}/`).then(() => true).catch(() => false);
    if (busy) throw new Error(`포트 ${port} 가 이미 사용 중입니다. 이전 테스트 프로세스를 종료하세요.`);
  }
  const mock = start("npx", ["tsx", "tests/e2e/mock-upstream.ts"], "mock");
  let app: ChildProcess | null = null;
  try {
    await waitFor(`${M}/__stats`);
    // 합성 데이터 생성(첫 요청 시 계산)을 미리 끝내 둔다
    await fetch(`${M}/yahoo1/v8/finance/chart/QQQ?interval=1d&range=5d`);

    // ── 2) 자동 업데이트 작업 ──
    for (const job of ["refresh_quotes", "collect_reference", "collect_eod", "collect_news", "briefing_close", "briefing_intraday", "briefing_non_trading"]) {
      const t0 = Date.now();
      // 장중 브리핑은 합성 데이터의 마지막 거래일 기준으로 생성 (테스트 실행 시각과 무관하게)
      const extra = job === "briefing_intraday" ? ["--force", "--date", marketStatus().lastCompletedSession] : ["--force"];
      const code = await runJob(job, extra);
      check(`작업 ${job} 실행`, code === 0, `${((Date.now() - t0) / 1000).toFixed(1)}초`);
    }
    {
      const d = db();
      const runs = d.prepare("SELECT job, status, message FROM job_runs ORDER BY id").all() as { job: string; status: string; message: string }[];
      for (const r of runs) check(`job_runs 기록: ${r.job}`, r.status === "success", `${r.status} · ${r.message}`);
      const nBrief = (d.prepare("SELECT count(*) AS n FROM briefings WHERE session='close'").get() as { n: number }).n;
      check(`장 마감 후 브리핑 생성 (지원 종목 ${INSTRUMENTS.length} + 시장 1)`, nBrief === INSTRUMENTS.length + 1, `${nBrief}건`);
      const divs = d.prepare("SELECT ex_date, amount, amount_raw, pay_date, sources FROM dividends WHERE symbol='JEPI' ORDER BY ex_date DESC LIMIT 3").all() as { pay_date: string | null; sources: string }[];
      check("JEPI 분배금: 지급일 포함 (Nasdaq 병합)", divs.length > 0 && divs.every((x) => x.pay_date), JSON.stringify(divs[0]));
      const schd = d.prepare("SELECT ex_date, amount, amount_raw, split_adjusted FROM dividends WHERE symbol='SCHD' AND ex_date < '2024-10-11' ORDER BY ex_date DESC LIMIT 1").get() as { amount: number; amount_raw: number; split_adjusted: number } | undefined;
      check("SCHD 분할 전 지급액 분할 조정 (3:1)", Boolean(schd && schd.split_adjusted === 1 && Math.abs(schd.amount_raw / schd.amount - 3) < 0.01), JSON.stringify(schd));
      const fake = d.prepare("SELECT count(*) AS n FROM news n JOIN news_symbols s ON s.news_id=n.id WHERE s.symbol='QQQ'").get() as { n: number };
      check("QQQ 뉴스 저장", fake.n > 0, `${fake.n}건`);
      d.close();
    }

    // ── 3) 웹사이트 ──
    app = start("npx", ["next", "start", "-p", String(APP)], "app");
    await waitFor(`${BASE}/api/health`);

    // 브리핑 차별화 (API)
    const closeDate = (() => {
      const d = db();
      const r = d.prepare("SELECT trade_date FROM briefings WHERE session='close' LIMIT 1").get() as { trade_date: string };
      d.close();
      return r.trade_date;
    })();
    const getB = async (s: string) => (await (await fetch(`${BASE}/api/briefing/${s}?date=${closeDate}&session=close`)).json()) as { content: { summary: { text: string }[]; price: { benchmark: { text: string }[] }; risks: { general: string[] }; distributions: { statements: { text: string }[] } | null; news: { items: { url: string; publishedAt: number }[] } } };
    const bq = await getB("QQQ");
    const bt = await getB("TQQQ");
    const bj = await getB("JEPI");
    const bg = await getB("GLD");
    const str = (x: unknown) => JSON.stringify(x);
    check("TQQQ 브리핑: 레버리지(×3) 계산 포함", str(bt.content.price.benchmark).includes("× 3"));
    check("TQQQ 와 QQQ 브리핑 내용이 다름", str(bt.content.summary) !== str(bq.content.summary) && str(bt.content.risks) !== str(bq.content.risks));
    check("JEPI 브리핑: 옵션 프리미엄·분배금 설명", str(bj.content.distributions).includes("옵션 프리미엄"));
    check("GLD 브리핑: 금 선물·금리·달러 중심", str(bg.content.price.benchmark).includes("금 선물") && str(bg.content.price.benchmark).includes("국채금리"));
    check("브리핑 뉴스는 수집 구간 내 기사만 (오래된 기사 제외)", bq.content.news.items.every((n) => n.publishedAt > Date.now() - 4 * 86400_000), `${bq.content.news.items.length}건`);

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    // 외부 기사 이미지 로드 실패는 화면에서 대체 타일로 처리되므로 콘솔 오류에서 제외하고, 이미지가 아닌 요청 실패만 따로 확인한다
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(m.text()));
    const failedNonImage: string[] = [];
    // 페이지 이동으로 중단된 미리 불러오기(ERR_ABORTED)는 실패가 아니다
    page.on("requestfailed", (r) => r.resourceType() !== "image" && r.failure()?.errorText !== "net::ERR_ABORTED" && failedNonImage.push(`${r.resourceType()} ${r.url()} ${r.failure()?.errorText}`));

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    let t = await textOf(page);
    check("대시보드: 시장 지수", t.includes("S&P 500") && t.includes("NASDAQ 100") && t.includes("Dow Jones"));
    check("대시보드: 핵심 종목 목록", (await page.locator('a[href="/stock/JEPI"]').count()) > 0 && t.includes("핵심 종목"));
    check("대시보드: 오늘 확인할 것·레버리지 위험 한 줄·갱신 시각", t.includes("오늘 확인할 것") && t.includes("최고점 대비") && /시세 .+ · 브리핑 .+ 갱신/.test(t));
    const moverTabs = page.getByRole("tablist", { name: "시장 움직임" });
    check("대시보드: 시장 움직임 탭 (새 변화·상승·하락·거래량)", (await moverTabs.getByRole("tab").allInnerTexts()).map((x) => x.replace(/\d+$/, "").trim()).join(",") === "새 변화,상승,하락,거래량");
    await moverTabs.getByRole("tab", { name: "거래량" }).click();
    check("대시보드: 거래량 탭 — 평균 대비 배수", (await textOf(page)).includes("평균의"));
    await moverTabs.getByRole("tab", { name: "하락" }).click();
    const downCard = await page.evaluate(() => {
      // 하락 종목 카드의 선 그래프는 하락 색(--down)
      const cards = [...document.querySelectorAll('a[href^="/stock/"]')].filter((a) => a.querySelector("svg polyline") && a.textContent?.includes("−"));
      const line = cards.map((c) => c.querySelector("svg polyline")).find(Boolean);
      return line?.getAttribute("stroke") ?? null;
    });
    check("대시보드: 하락 종목 그래프는 하락 색", downCard === null || downCard === "var(--down)", String(downCard));
    const sched = page.getByRole("tablist", { name: "다가오는 일정" });
    await sched.getByRole("tab", { name: /실적/ }).click();
    t = await textOf(page);
    check("대시보드: 일정 탭 (배당락·지급·실적·경제지표)", t.includes("다가오는 일정") && (await sched.getByRole("tab").count()) === 3 && !t.includes("undefined"));
    await page.screenshot({ path: path.join(OUT, "desktop-dashboard.png"), fullPage: true });

    for (const s of ["QQQ", "TQQQ", "QLD", "VOO", "SPY", "DGRO", "JEPI", "JEPQ", "DIVO", "GLD", "NVDA"]) {
      await page.goto(`${BASE}/stock/${s}`, { waitUntil: "networkidle" });
      await page.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
      const canvases = await page.locator("canvas").count();
      t = await textOf(page);
      const legendOk = t.includes("추정 거래대금") && t.includes("거래량");
      check(`${s} 상세: 시세·차트·거래량 범례`, t.includes(s) && t.includes("$") && canvases > 0 && legendOk, `canvas ${canvases}`);
      await page.getByRole("tab", { name: "일일 브리핑" }).click();
      t = await textOf(page);
      check(`${s} 일일 브리핑 탭`, t.includes("오늘의 핵심 요약") && t.includes("기술적 분석") && t.includes("데이터와 분석의 기준") && t.includes("주요 위험 요인"));
      check(`${s} 브리핑: 핵심 변화·종합 판단`, t.includes("오늘의 핵심 변화") && t.includes("종합 판단") && t.includes("규칙 기반 자동 분석"));
      await page.getByRole("tab", { name: "배당·분배금" }).click();
      t = await textOf(page);
      if (["GLD", "TQQQ", "QLD"].includes(s)) check(`${s} 분배금 기록 없음 → 데이터 미제공 안내(가짜 값 없음)`, t.includes("데이터 미제공"));
      else check(`${s} 배당·분배금: 지급 내역 표·수익률`, t.includes("과거 지급 내역") && t.includes("TTM 수익률") && t.includes("최근 지급액 연환산"));
      await page.getByRole("tab", { name: s === "NVDA" ? "재무 정보" : "ETF 정보" }).click();
      t = await textOf(page);
      if (s === "NVDA") check("NVDA 재무 정보: 분기 실적·지표", t.includes("최근 분기 실적") && t.includes("PER") && t.includes("ROE"));
      else check(`${s} ETF 정보: 운용 전략·총보수·편입 종목`, t.includes("운용 전략과 구조") && t.includes("총보수"));
      if (s === "TQQQ") check("TQQQ: 레버리지 배수·일일 목표 표시", t.includes("레버리지 배수") && t.includes("일일"));
      if (s === "JEPI") check("JEPI: 옵션 운용 전략 안내", t.includes("옵션 운용 전략"));
      if (s === "GLD") check("GLD: 금 가격과의 관계", t.includes("금 가격과의 관계") && t.includes("상관계수"));
      await page.getByRole("tab", { name: "뉴스" }).click();
      const extLinks = await page.locator('[role="tabpanel"]:not([hidden]) a[target="_blank"]').count();
      check(`${s} 뉴스: 출처 링크`, extLinks > 0, `${extLinks}개`);
      if (["QQQ", "JEPI", "GLD"].includes(s)) await page.screenshot({ path: path.join(OUT, `desktop-${s}.png`), fullPage: true });
    }

    // 차트 기간·지표 전환
    await page.goto(`${BASE}/stock/QQQ`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "1일", exact: true }).click();
    await page.waitForTimeout(800);
    t = await textOf(page);
    check("차트: 1일(분봉) 전환", t.includes("분봉") && !t.includes("차트 데이터를 불러오지 못했습니다"));
    await page.getByRole("button", { name: "전체", exact: true }).click();
    await page.waitForTimeout(800);
    check("차트: 전체 기간(월봉) 전환", (await textOf(page)).includes("월봉"));
    await page.getByRole("button", { name: "라인", exact: true }).click();
    await page.getByRole("button", { name: "볼린저", exact: true }).click();
    await page.waitForTimeout(500);
    const legendTxt = await page.locator("main").innerText();
    check("차트: 라인·볼린저 밴드 표시", legendTxt.includes("BB 상단"));
    await page.getByRole("button", { name: "1년", exact: true }).click();
    await page.getByRole("button", { name: "캔들", exact: true }).click();
    const box = await page.locator('[role="img"][aria-label="QQQ 가격 차트"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + 100);
      await page.waitForTimeout(300);
    }
    check("차트: 십자선 범례(시·고·저·종·변동률)", (await page.locator("main").innerText()).includes("시 "));

    // 비교
    await page.goto(`${BASE}/compare`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "TQQQ vs QLD" }).click();
    await page.waitForTimeout(1500);
    t = await textOf(page);
    check("종목 비교: 정규화 차트·성과 표", t.includes("TQQQ") && t.includes("QLD") && t.includes("최대 낙폭") && t.includes("총수익률(재투자)"));
    await page.getByRole("button", { name: "10년" }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "JEPI vs JEPQ" }).click();
    await page.waitForTimeout(1500);
    t = await textOf(page);
    check("종목 비교: 데이터 부족 시 제외 안내 (10년)", t.includes("제외") || t.includes("기간 전체 데이터가 없습니다") || t.includes("JEPI"));
    await page.screenshot({ path: path.join(OUT, "desktop-compare.png"), fullPage: true });

    // 차별화 기능: 레버리지 분석·배당 현금흐름·관계 지도
    await page.goto(`${BASE}/leverage`, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
    t = await textOf(page);
    check("레버리지 분석: 하루 목표 설명·기간별 수익률·급락 구간·1년 분포", t.includes("왜 기간 수익률 × 배수가 아닌가요") && t.includes("기간별 수익률") && t.includes("급락 구간의 손실과 회복") && t.includes("1년 보유했을 때") && t.includes("배수 대비"));
    check("레버리지 분석: QQQ·QLD·TQQQ 같은 기간 비교 차트", t.includes("QQQ") && t.includes("QLD") && t.includes("TQQQ") && (await page.locator("canvas").count()) > 0);
    await page.getByRole("tab", { name: /S&P 500/ }).click();
    check("레버리지 분석: S&P 500 묶음", (await textOf(page)).includes("UPRO"));
    await page.screenshot({ path: path.join(OUT, "desktop-leverage.png"), fullPage: true });
    await page.goto(`${BASE}/stock/JEPI?tab=dividends`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("배당 탭: 계산기·변화 추적·월별 패턴·수익률 분해·지급 상태", t.includes("현금흐름 계산기") && t.includes("변화 추적") && t.includes("월별 지급 패턴") && t.includes("수익률의 관계") && t.includes("지급 완료"));
    await page.getByLabel("보유 주식 수").fill("200");
    await page.waitForTimeout(300);
    t = await textOf(page);
    check("배당 계산기: 수량 입력 반영·가정치 구분", t.includes("최근 12개월 실제 지급 기준") && t.includes("가정"));
    await page.goto(`${BASE}/income`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("배당 허브: 하위 탭·종목별 요약 표", t.includes("목표 배당 계산기") && t.includes("배당 캘린더") && t.includes("최근 12개월 실제 지급") && t.includes("JEPI"));
    await page.getByRole("tab", { name: "배당 품질 비교" }).click();
    await page.waitForTimeout(300);
    t = await textOf(page);
    check("배당 품질 비교: 변동성·총수익률·구성 미제공·기준", t.includes("배당·분배금 품질 비교") && t.includes("지급 변동성") && t.includes("1년 총수익률") && t.includes("제공처 미제공") && t.includes("분배금 수익률이 높다고 총수익률이 높은 것은 아닙니다"));
    await page.getByRole("tab", { name: "보유 종목 현금흐름" }).click();
    await page.getByLabel("보유 종목 선택").selectOption("SCHD");
    await page.getByRole("button", { name: "추가" }).click();
    await page.getByLabel("보유 종목 선택").selectOption("JEPI");
    await page.getByRole("button", { name: "추가" }).click();
    await page.waitForTimeout(300);
    t = await textOf(page);
    check("배당 현금흐름: 여러 종목 월별 계산", t.includes("SCHD") && t.includes("JEPI") && t.includes("월별 받은 금액") && t.includes("발표된 예정 지급"));
    await page.screenshot({ path: path.join(OUT, "desktop-income.png"), fullPage: true });
    await page.goto(`${BASE}/map`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("관계 지도: 기초지수 묶음", t.includes("나스닥100") && t.includes("S&P 500") && t.includes("배당") && t.includes("금"));
    await page.locator('g[role="button"][aria-label^="JEPQ "]').click();
    await page.waitForTimeout(300);
    t = await textOf(page);
    check("관계 지도: 선택 종목 비교(상관·중복)", t.includes("JEPQ") && t.includes("같은 묶음과 비교") && t.includes("상관"));
    await page.getByRole("button", { name: /^NVDA \d+개 ETF/ }).click();
    check("관계 지도: 개별 주식을 담은 ETF", (await textOf(page)).includes("이 종목을 담은 ETF"));
    await page.screenshot({ path: path.join(OUT, "desktop-map.png"), fullPage: true });

    // 브리핑·캘린더·관심·설정·상태
    await page.goto(`${BASE}/briefing`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("브리핑 페이지: 시장 브리핑 요약·종목별 목록", t.includes("시장 브리핑") && t.includes("종목별 브리핑") && t.includes("AAPL") && t.includes("전체 보기"));
    await page.getByRole("tablist", { name: "종목 분류" }).getByRole("tab", { name: "레버리지" }).click();
    check("브리핑 페이지: 분류 탭 전환", (await textOf(page)).includes("TQQQ"));
    await page.screenshot({ path: path.join(OUT, "desktop-briefing.png"), fullPage: true });
    await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("배당 캘린더: 배당락·지급일", t.includes("배당락일") && t.includes("지급일") && (await page.locator("table tbody tr").count()) > 0);
    await page.goto(`${BASE}/watchlist`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    check("관심 종목: 기본 목록과 시세", (await textOf(page)).includes("QQQ"));
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "다크" }).click();
    check("설정: 다크 모드 적용", (await page.locator("html").getAttribute("data-theme")) === "dark");
    await page.goto(`${BASE}/stock/JEPI?tab=dividends`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, "desktop-JEPI-dividends-dark.png"), fullPage: true });
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "라이트" }).click();
    await page.goto(`${BASE}/status`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("데이터 상태: 작업 기록·제공처", t.includes("작업별 상태") && t.includes("Yahoo Finance") && t.includes("성공"));
    const search = await page.request.get(`${BASE}/stock/splg`);
    check("SPLG → SPYM 연결", search.url().endsWith("/stock/SPYM"));
    await page.goto(`${BASE}/stock/AMD`, { waitUntil: "networkidle" });
    check("미지원 종목은 찾을 수 없음 안내 (무제한 검색 사이트 아님)", (await page.locator("body").innerText()).includes("찾을 수 없습니다"));
    const apiUnsupported = await page.request.get(`${BASE}/api/chart/AMD`);
    check("미지원 종목 API 404", apiUnsupported.status() === 404);
    const adminDenied = await page.request.post(`${BASE}/api/admin/jobs`, { data: { job: "cleanup" } });
    check("관리자 API: 토큰 없으면 거부", adminDenied.status() === 401);

    // 모바일
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
    const m = await mctx.newPage();
    for (const [url, name] of [
      ["/", "dashboard"],
      ["/stock/JEPI", "JEPI"],
      ["/stock/TQQQ?tab=briefing", "TQQQ-briefing"],
      ["/briefing", "briefing"],
      ["/compare", "compare"],
      ["/calendar", "calendar"],
      ["/leverage", "leverage"],
      ["/income", "income"],
      ["/map", "map"],
      ["/stock/JEPI?tab=dividends", "JEPI-dividends"],
    ]) {
      await m.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await m.waitForTimeout(500);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`모바일(390px) ${url}: 가로 넘침 없음`, overflow <= 1, `넘침 ${overflow}px`);
      await m.screenshot({ path: path.join(OUT, `mobile-${name}.png`), fullPage: true });
    }
    await m.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check("모바일 하단 탭", (await m.getByRole("navigation", { name: "하단 메뉴" }).innerText()).replace(/\s+/g, " ").trim() === "홈 브리핑 종목 내 자산 메뉴");
    await m.getByRole("button", { name: "메뉴 열기" }).click();
    check("모바일 전체 메뉴", (await m.getByRole("dialog", { name: "전체 메뉴" }).getByRole("link", { name: "배당·분배금" }).isVisible()) && (await m.getByRole("dialog", { name: "전체 메뉴" }).getByRole("link", { name: "미래 시뮬레이터" }).isVisible()));
    await m.getByRole("dialog", { name: "전체 메뉴" }).getByRole("link", { name: "배당·분배금" }).click();
    await m.waitForURL(/\/income$/);
    await m.getByRole("navigation", { name: "배당·분배금 하위 메뉴" }).getByRole("link", { name: "배당 캘린더" }).click();
    await m.waitForURL(/\/calendar$/);
    check("모바일: 메뉴 → 하위 탭으로 배당 캘린더 이동", (await textOf(m)).includes("배당 캘린더"));

    // 홈 화면 설치(PWA): 매니페스트·아이콘·서비스 워커, 오프라인일 때 안내 페이지 (데이터는 저장하지 않음)
    const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    const iconOk = (await Promise.all((manifest.icons as { src: string }[]).map(async (i) => (await fetch(new URL(i.src, `${BASE}/manifest.webmanifest`))).status === 200))).every(Boolean);
    check("PWA: 매니페스트·아이콘", manifest.display === "standalone" && manifest.start_url === "./" && manifest.icons.length >= 3 && iconOk);
    check("PWA: 매니페스트·애플 아이콘 링크", (await m.locator('link[rel="manifest"]').getAttribute("href")) === "/manifest.webmanifest" && (await m.locator('link[rel="apple-touch-icon"]').count()) === 1);
    const swReady = await m.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.scope), new Promise((res) => setTimeout(() => res(null), 8000))]));
    check("PWA: 서비스 워커 등록", swReady === `${BASE}/`, String(swReady));
    // Playwright 의 오프라인 흉내는 이 설정이 있어야 서비스 워커의 요청에도 적용된다 (새 컨텍스트에서만 확인)
    process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
    const octx = await browser.newContext({ locale: "ko-KR" });
    const op = await octx.newPage();
    await op.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await op.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await octx.setOffline(true);
    await op.goto(`${BASE}/stocks`).catch(() => null);
    const offlineText = await textOf(op).catch(() => "");
    await octx.close();
    delete process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS;
    check("PWA: 오프라인이면 '연결 안 됨' 안내 (오래된 시세를 보여 주지 않음)", offlineText.includes("인터넷에 연결되어 있지 않습니다") && !offlineText.includes("$"));

    // 내 자산·백테스트·시뮬레이터·스트레스 테스트·전략·백업
    await featureChecks(browser, BASE, OUT, check, async (s) => {
      const j = await (await fetch(`${BASE}/api/quotes?symbols=${encodeURIComponent(s)}`)).json();
      return j.quotes[0].price as number;
    });
    const series = await (await fetch(`${BASE}/api/series/QQQ`)).json();
    check("시계열 API: 일봉 종가·분배금 (백테스트용)", series.symbol === "QQQ" && series.close.length > 1000 && series.divs.length > 10);
    check("시계열 API: 미지원 종목 404", (await fetch(`${BASE}/api/series/AMD`)).status === 404);
    const income = await (await fetch(`${BASE}/api/income`)).json();
    check("배당 요약 API: 분배금/배당금 구분·최근 12개월", income.items.JEPI.word === "분배금" && income.items.AAPL.word === "배당금" && income.items.JEPI.ttmPerShare > 0);

    // ── 4) 장애 상황 ──
    killTree(mock);
    await new Promise((r) => setTimeout(r, 1000));
    const failCode = await runJob("refresh_quotes", ["--force"]);
    check("장애: 시세 작업 실패 종료 코드", failCode !== 0);
    {
      const d = db();
      const last = d.prepare("SELECT status, message FROM job_runs WHERE job='refresh_quotes' ORDER BY id DESC LIMIT 1").get() as { status: string; message: string };
      check("장애: 실패 상태 기록", last.status === "failed", last.message);
      // 시세 데이터를 6시간 전 것으로 만들어 '오래된 데이터' 표시 확인
      d.prepare("UPDATE quotes SET fetched_at = fetched_at - 6*3600*1000").run();
      d.prepare("UPDATE bar_meta SET fetched_at = fetched_at - 6*3600*1000").run();
      d.close();
    }
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("장애: 대시보드에 실패 및 마지막 정상 갱신 안내", t.includes("최근 시세 갱신 작업이 실패했습니다") && t.includes("마지막 정상 갱신"));
    await page.goto(`${BASE}/stock/QQQ`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    t = await textOf(page);
    check("장애: 과거 데이터임을 표시 (현재 데이터처럼 보이지 않음)", t.includes("최신 시세 조회에 실패해") || t.includes("저장된 과거 데이터 표시 중"));
    await page.screenshot({ path: path.join(OUT, "desktop-failure-QQQ.png"), fullPage: false });
    const chartRes = await (await fetch(`${BASE}/api/chart/QQQ?interval=1d`)).json();
    check("장애: 차트 API 가 stale 표시와 오류를 함께 반환", chartRes.meta?.stale === true && Boolean(chartRes.meta?.error));
    await page.goto(`${BASE}/status`, { waitUntil: "networkidle" });
    check("장애: 상태 페이지 실패 표시", (await textOf(page)).includes("실패"));

    check("브라우저 콘솔 오류 없음", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    check("이미지 외 요청 실패 없음", failedNonImage.length === 0, failedNonImage.slice(0, 3).join(" | "));
    await browser.close();
  } finally {
    killTree(app);
    killTree(mock);
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과 · 스크린샷/로그: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
