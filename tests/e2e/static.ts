/**
 * 정적 사이트(GitHub Pages 용) 종단 간 점검
 *   1) BASE_PATH=/stock_chart npm run build:static 으로 out/ 을 만든 뒤
 *   2) npm run test:e2e:static
 * out/ 을 GitHub Pages 처럼(저장소 이름 경로, 폴더 주소는 끝에 / 로 이동, 없는 주소는 404.html) 제공하고 화면을 확인한다.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { featureChecks } from "./features";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "out");
const BASE_PATH = process.env.BASE_PATH ?? "/stock_chart";
const PORT = Number(process.env.STATIC_PORT ?? 3200);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}${BASE_PATH}`;
const SHOTS = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "usi-static-"));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serve(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", ORIGIN);
    const p = decodeURIComponent(url.pathname);
    const notFound = () => {
      res.writeHead(404, { "content-type": TYPES[".html"] });
      fs.createReadStream(path.join(OUT, "404.html")).pipe(res);
    };
    if (p !== BASE_PATH && !p.startsWith(`${BASE_PATH}/`)) return notFound();
    const rel = p.slice(BASE_PATH.length) || "/";
    let file = path.join(OUT, rel);
    if (!file.startsWith(OUT)) return notFound();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!p.endsWith("/")) {
        res.writeHead(301, { location: `${p}/${url.search}` });
        return res.end();
      }
      file = path.join(file, "index.html");
    } else if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
    if (!fs.existsSync(file)) return notFound();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const textOf = (page: Page) => page.locator("body").innerText();

async function main() {
  if (!fs.existsSync(path.join(OUT, "index.html")) || !fs.existsSync(path.join(OUT, "data", "build.json"))) {
    console.error("out/ 이 없습니다. 먼저 BASE_PATH=/stock_chart npm run build:static 을 실행하세요.");
    process.exit(2);
  }
  const server = serve();
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    const errors: string[] = [];
    const failedRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
    page.on("response", (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`));

    // 대시보드
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    let t = await textOf(page);
    check("대시보드: 정적 스냅샷 안내", t.includes("정적 스냅샷") && t.includes("실시간 시세가 아니며"));
    check("대시보드: 시장 지수·종목 카드", t.includes("S&P 500") && (await page.locator(`a[href="${BASE_PATH}/stock/JEPI/"]`).count()) > 0);
    check("대시보드: 시장 상태 문구", /\(ET\) · /.test(t));
    check("대시보드: 관심 종목 시세(정적 JSON)", (await page.locator("text=관심 종목").count()) > 0 && !t.includes("HTTP 404"));

    // 종목 상세 + 차트 간격 전환
    await page.goto(`${BASE}/stock/QQQ/`, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
    t = await textOf(page);
    check("QQQ 상세: 차트·스냅샷 시세 표시", (await page.locator("canvas").count()) > 0 && t.includes("수집 시점 스냅샷"));
    check("QQQ 상세: '실시간' 표시 없음", !t.includes("제공처 기준 실시간 (") || t.includes("원 데이터: 제공처 기준 실시간"));
    for (const [range, label] of [
      ["1일", "5분봉"],
      ["5일", "15분봉"],
      ["1개월", "1시간봉"],
      ["1년", "일봉"],
      ["5년", "주봉"],
      ["전체", "월봉"],
    ] as const) {
      await page.getByRole("button", { name: range, exact: true }).click();
      await page.waitForTimeout(700);
      t = await textOf(page);
      check(`차트 ${range} (${label})`, t.includes(label) && !t.includes("차트 데이터를 불러오지 못했습니다") && !t.includes("데이터 파일이 없습니다"));
    }
    await page.getByRole("button", { name: "1일", exact: true }).click();
    await page.waitForTimeout(300);
    check("차트: 정적 사이트에서 1분봉 버튼 숨김", (await page.getByRole("button", { name: "1분봉", exact: true }).count()) === 0);

    await page.goto(`${BASE}/stock/JEPI/?tab=dividends`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("?tab=dividends 로 배당 탭 바로 열기", t.includes("과거 지급 내역") && (await page.getByRole("tab", { name: "배당·분배금" }).getAttribute("aria-selected")) === "true");

    // 이전 티커 → 새 티커
    await page.goto(`${BASE}/stock/SPLG/`);
    await page.waitForURL(/\/stock\/SPYM\/?$/, { timeout: 10000 }).catch(() => null);
    check("SPLG → SPYM 이동", /\/stock\/SPYM\/?$/.test(page.url()), page.url());

    // 비교 (브라우저에서 계산)
    await page.goto(`${BASE}/compare/?symbols=JEPI,JEPQ`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    t = await textOf(page);
    check("비교: URL 의 종목으로 계산", t.includes("JEPI") && t.includes("JEPQ") && t.includes("총수익률") && !t.includes("HTTP 404"));

    // 브리핑 목록·기록
    await page.goto(`${BASE}/briefing/`, { waitUntil: "networkidle" });
    t = await textOf(page);
    const dates = await page.locator(`a[href^="${BASE_PATH}/briefing/?date="]`).allInnerTexts();
    check("브리핑 목록: 날짜 선택", dates.length >= 2, dates.join(", "));
    if (dates.length >= 2) {
      await page.locator(`a[href^="${BASE_PATH}/briefing/?date=${dates[1]}"]`).first().click();
      await page.waitForTimeout(1000);
      const href = await page.locator(`a[href^="${BASE_PATH}/briefing/AAPL/"]`).first().getAttribute("href");
      check("브리핑 목록: 이전 날짜로 전환", Boolean(href?.includes(dates[1])), href ?? "");
      await page.goto(`${BASE}/briefing/AAPL/?date=${dates[1]}&session=close`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      t = await textOf(page);
      check("브리핑 상세: 이전 날짜 기록 불러오기", t.includes(dates[1]) && t.includes("오늘의 핵심 요약"));
    }
    await page.goto(`${BASE}/briefing/MARKET/`, { waitUntil: "networkidle" });
    check("시장 브리핑 페이지", (await textOf(page)).includes("시장 브리핑"));

    // 캘린더 (브라우저에서 달 이동)
    await page.goto(`${BASE}/calendar/`, { waitUntil: "networkidle" });
    const month = (await page.locator("span.num.font-semibold").first().innerText()).trim();
    await page.getByRole("link", { name: "← 이전 달" }).click();
    await page.waitForTimeout(800);
    const prev = (await page.locator("span.num.font-semibold").first().innerText()).trim();
    check("캘린더: 이전 달 이동", month !== prev && /년 \d+월/.test(prev), `${month} → ${prev}`);
    t = await textOf(page);
    check("캘린더: 일정 표시", t.includes("목록 보기"));

    // 차별화 기능 (정적 사이트)
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("대시보드: 오늘 확인할 것·새 변화 종목·레버리지 위험", t.includes("오늘 확인할 것") && t.includes("오늘 새 변화가 있는 종목") && t.includes("레버리지 ETF 위험 지표"));
    await page.waitForTimeout(800);
    check("대시보드: 관심 종목 새 변화(정적 JSON)", /개 중 \d+개에 새 변화|새로 생긴 중요한 변화 없음/.test(await textOf(page)));
    await page.goto(`${BASE}/stock/QQQ/?tab=briefing`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("브리핑: 핵심 변화·종합 판단", t.includes("오늘의 핵심 변화") && t.includes("종합 판단"));
    await page.goto(`${BASE}/leverage/`, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas", { timeout: 15000 }).catch(() => null);
    t = await textOf(page);
    check("레버리지 분석 (정적)", t.includes("기간별 수익률") && t.includes("TQQQ") && (await page.locator("canvas").count()) > 0);
    await page.goto(`${BASE}/stock/JEPI/?tab=dividends`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("배당 탭: 계산기·수익률 분해 (정적)", t.includes("현금흐름 계산기") && t.includes("수익률의 관계"));
    await page.goto(`${BASE}/income/`, { waitUntil: "networkidle" });
    await page.getByLabel("보유 종목 선택").selectOption("JEPI");
    await page.getByRole("button", { name: "추가" }).click();
    await page.waitForTimeout(300);
    check("배당 현금흐름 (정적)", (await textOf(page)).includes("월별 받은 금액"));
    await page.goto(`${BASE}/map/`, { waitUntil: "networkidle" });
    await page.locator('g[role="button"][aria-label^="TQQQ "]').click();
    await page.waitForTimeout(300);
    t = await textOf(page);
    check("관계 지도 (정적)", t.includes("같은 묶음과 비교") && t.includes("TQQQ"));

    // 관심 종목·설정·상태
    await page.goto(`${BASE}/watchlist/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    t = await textOf(page);
    check("관심 종목: 시세 표시", t.includes("QQQ") && t.includes("$") && !t.includes("HTTP 404"));
    await page.goto(`${BASE}/settings/`, { waitUntil: "networkidle" });
    t = await textOf(page);
    const sched = t.slice(t.indexOf("데이터 업데이트 일정"), t.indexOf("데이터 업데이트 일정") + 400).replace(/\s+/g, " ");
    check("설정: GitHub Actions 일정(한국 시간)", t.includes("GitHub Actions") && /월–금 \d{2}:\d{2}/.test(t) && !t.includes("관리자 토큰"), sched);
    await page.goto(`${BASE}/status/`, { waitUntil: "networkidle" });
    t = await textOf(page);
    check("데이터 상태: 예약 실행 안내", t.includes("GitHub Actions 예약 실행") && !t.includes("스케줄러(워커)가 실행되고 있지 않습니다"));

    // 없는 주소
    const r = await page.goto(`${BASE}/stock/NOPE/`);
    check("없는 종목 주소 → 404", r?.status() === 404);

    // 모바일
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
    const mp = await m.newPage();
    mp.on("pageerror", (e) => errors.push(String(e)));
    await mp.goto(`${BASE}/stock/JEPI/`, { waitUntil: "networkidle" });
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("모바일: 가로 넘침 없음", overflow <= 1, `${overflow}px`);
    await mp.screenshot({ path: path.join(SHOTS, "static-mobile-JEPI.png"), fullPage: false });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, "static-dashboard.png"), fullPage: false });

    const unexpected = failedRequests.filter((u) => !u.includes("/stock/NOPE/") && !u.includes("/img/"));
    check("데이터 요청 실패 없음", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
    const realErrors = errors.filter((e) => !e.includes("404"));
    check("브라우저 콘솔 오류 없음", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
    const quotesJson = JSON.parse(fs.readFileSync(path.join(OUT, "data", "quotes.json"), "utf8")) as { quotes: { symbol: string; price: number }[] };
    await featureChecks(browser, BASE, SHOTS, check, async (s) => quotesJson.quotes.find((q) => q.symbol === s)?.price ?? NaN, "정적");
    check("정적: 시계열 파일 (지수·환율 포함)", ["QQQ", "_GSPC", "KRW_X", "_IRX"].every((k) => fs.existsSync(path.join(OUT, "data", "series", `${k}.json`))));
    check("정적: 배당 요약 파일", fs.existsSync(path.join(OUT, "data", "income.json")));
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n정적 사이트 점검 ${results.length - failed.length}/${results.length} 통과 · 스크린샷: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
