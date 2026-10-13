/**
 * 개인 자산·가상 투자·백테스트·시뮬레이터·스트레스 테스트·전략·백업 e2e 확인 (서버 모드·정적 모드 공용)
 * ⚠ 합성(테스트용) 시장 데이터로 실행한다. 실제 시세가 아니다.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function text(page: Page) {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

/** 지정한 텍스트가 나타날 때까지 기다린 뒤 본문 반환 */
async function waitText(page: Page, needle: string | RegExp, ms = 15000) {
  const t0 = Date.now();
  let t = "";
  while (Date.now() - t0 < ms) {
    t = await text(page);
    if (typeof needle === "string" ? t.includes(needle) : needle.test(t)) return t;
    await page.waitForTimeout(250);
  }
  return t;
}

export async function featureChecks(browser: Browser, base: string, out: string, check: Check, quoteOf: (s: string) => Promise<number>, label = "") {
  const P = label ? `${label} ` : "";
  // 저장 파일 이름은 영문으로 (일부 환경의 브라우저 자동화는 한글 파일 이름을 파일 입력에 넣지 못함)
  const slug = label ? "static" : "server";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  const go = (u: string) => page.goto(`${base}${u}`, { waitUntil: "networkidle" });

  // ── 대시보드: 입력 전에는 개인 금액을 표시하지 않음 ──
  await go("/");
  let t = await waitText(page, "내 투자 현황");
  check(`${P}대시보드: 자산 입력 전 개인 금액 표시 안 함`, t.includes("아직 입력한 자산이 없어 총자산·손익·분배금을 표시하지 않습니다"));

  // ── 내 자산: 간편 입력 ──
  await go("/portfolio");
  await waitText(page, "간편 입력");
  await page.getByLabel("티커", { exact: true }).fill("AMD");
  t = await text(page);
  check(`${P}내 자산: 지원하지 않는 티커 안내`, t.includes("AMD: 지원하지 않는 종목입니다"));
  const addSimple = async (sym: string, sh: string, cost: string) => {
    await page.getByLabel("티커", { exact: true }).fill(sym);
    await page.getByLabel("보유 수량").fill(sh);
    await page.getByLabel("평균 매수 단가").fill(cost);
    await page.getByRole("button", { name: "보유 종목 추가" }).click();
    await page.waitForTimeout(200);
  };
  await addSimple("QQQ", "10", "400");
  await addSimple("JEPI", "100", "55");
  await page.getByLabel("현금 잔액").fill("1000");
  await page.getByRole("button", { name: "현금 저장" }).click();
  const qqq = await quoteOf("QQQ");
  const jepi = await quoteOf("JEPI");
  const total = 10 * qqq + 100 * jepi + 1000;
  t = await waitText(page, money(total));
  check(`${P}내 자산(간편): 총자산 = 수량 × 현재가 + 현금`, t.includes(money(total)), `기대 ${money(total)}`);
  check(`${P}내 자산(간편): 매수 원가 합계`, t.includes(money(9500)));
  check(`${P}내 자산(간편): 예상 연간 분배금은 추정으로 구분`, t.includes("예상 연간 분배금 (추정)") && t.includes("확정 아님"));
  await page.reload({ waitUntil: "networkidle" });
  t = await waitText(page, money(total));
  check(`${P}내 자산: 새로고침 후 데이터 유지 (IndexedDB)`, t.includes("QQQ") && t.includes("JEPI") && t.includes(money(total)));

  // ── 간편 입력 → 거래 내역 전환 (중복 계산 없음) ──
  await page.getByRole("button", { name: "거래 내역 관리로 전환" }).click();
  t = await waitText(page, "기초 보유");
  check(`${P}전환: 기초 보유·입금 기록 생성`, t.includes("기초 보유") && t.includes("입금"));
  check(`${P}전환: 총자산이 그대로 (수량·원가 중복 없음)`, t.includes(money(total)) && t.includes(`순납입 원금 ${money(10500)}`));

  // ── 거래 내역: 매수·매도·분배금·재투자·입출금 ──
  const txn = async (type: string, fields: Record<string, string>) => {
    await page.getByRole("button", { name: type, exact: true }).click();
    for (const [k, v] of Object.entries(fields)) await page.getByLabel(k, { exact: true }).fill(v);
    await page.getByRole("button", { name: `${type} 기록 추가` }).click();
    await page.waitForTimeout(250);
  };
  await txn("입금", { 금액: "500" });
  await txn("매수", { "거래 티커": "QQQ", 수량: "2", 가격: "500", 수수료: "1" });
  await txn("매도", { "거래 티커": "QQQ", 수량: "100", 가격: "520", 수수료: "1" });
  t = await text(page);
  check(`${P}거래 내역: 보유 수량보다 많은 매도 거부`, t.includes("보유 수량") && t.includes("반영하지 않았습니다"));
  await txn("매도", { "거래 티커": "QQQ", 수량: "5", 가격: "520", 수수료: "1" });
  // 평균 단가 (4000 + 1001) / 12 = 416.75 → 실현 = 2600 − 1 − 2083.75 = 515.25
  t = await waitText(page, "+$515.25");
  check(`${P}거래 내역: 이동평균 실현 손익`, t.includes("+$515.25"));
  await txn("분배금 수령", { "거래 티커": "JEPI", 금액: "50", 세금: "7.5" });
  await txn("분배금 재투자", { "거래 티커": "JEPI", 금액: "40", 세금: "6", 수량: "0.6", 가격: "55" });
  await txn("출금", { 금액: "200" });
  t = await waitText(page, money(90));
  check(`${P}거래 내역: 실제 분배금 누적 (수령+재투자)`, t.includes(money(90)));
  check(`${P}거래 내역: 외부 입출금은 원금으로 구분`, t.includes(`순납입 원금 ${money(10800)}`));
  const cash = 1000 + 500 - 1001 + 2599 + 42.5 + (34 - 33) - 200;
  const value = 7 * qqq + 100.6 * jepi;
  t = await waitText(page, money(value + cash));
  check(`${P}거래 내역: 총자산 = 평가금액 + 현금`, t.includes(money(value + cash)), `기대 ${money(value + cash)}`);
  await page.reload({ waitUntil: "networkidle" });
  t = await waitText(page, "분배금 재투자");
  check(`${P}거래 내역: 새로고침 후 유지`, t.includes("분배금 재투자") && t.includes(money(value + cash)));
  await page.screenshot({ path: path.join(out, `${slug}-portfolio.png`), fullPage: true });

  // ── 가상 투자 ──
  await go("/paper");
  await waitText(page, "가상 계좌 만들기");
  await page.getByLabel("가상 초기 자금").fill("10000");
  await page.getByRole("button", { name: "가상 계좌 시작" }).click();
  await waitText(page, "가상 주문");
  await page.getByLabel("주문 종목").fill("JEPI");
  await page.getByLabel("주문 수량").fill("10");
  await waitText(page, "예상 체결");
  await page.getByRole("button", { name: "가상 매수 실행" }).click();
  t = await waitText(page, "가상 매수 완료");
  check(`${P}가상 투자: 시세 기준 체결·시세 시각·지연 표시`, t.includes("가상 매수 완료") && t.includes("기준 시각") && t.includes("체결 거래일"));
  check(`${P}가상 투자: 실제 주문 아님 안내`, t.includes("실제 증권 계좌로 전송되지 않습니다"));
  await page.getByRole("button", { name: "매도", exact: true }).click();
  await page.getByLabel("주문 수량").fill("1000");
  t = await waitText(page, "보유 수량");
  check(`${P}가상 투자: 보유 초과 매도 막음`, t.includes("보다 많이 팔 수 없습니다"));
  await page.reload({ waitUntil: "networkidle" });
  t = await waitText(page, "보유 종목");
  check(`${P}가상 투자: 새로고침 후 유지·실제 자산과 분리`, t.includes("JEPI") && t.includes("가상 총자산"));
  await page.screenshot({ path: path.join(out, `${slug}-paper.png`), fullPage: true });

  // ── 백테스트 ──
  await go("/backtest");
  await waitText(page, "종목별 실제 데이터 범위");
  await page.getByRole("button", { name: "5년", exact: true }).click();
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "결과 비교");
  check(`${P}백테스트: 두 포트폴리오·벤치마크 동일 조건 비교`, t.includes("최종 평가금액") && t.includes("연환산 수익률 (CAGR)") && t.includes("최대 낙폭") && t.includes("샤프 비율") && t.includes("벤치마크 대비 초과 총수익률"));
  check(`${P}백테스트: 분배금 재투자 효과·가격만 수익률 구분`, t.includes("재투자 효과") && t.includes("가격만의 수익률"));
  check(`${P}백테스트: 차트·히트맵·연도별`, (await page.locator("canvas").count()) >= 2 && t.includes("월별 수익률 히트맵") && t.includes("연도별 수익률"));
  check(`${P}백테스트: 과거 성과 미보장 안내`, t.includes("과거 성과는 미래 수익을 보장하지 않습니다"));
  await page.getByRole("button", { name: "결과 저장 (대시보드에 표시)" }).click();
  await page.screenshot({ path: path.join(out, `${slug}-backtest.png`), fullPage: true });
  // 사용자가 입력한 날짜 그대로
  await page.getByLabel("시작일").fill("2018-03-15");
  await page.getByLabel("종료일").fill("2021-09-30");
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "계산 기간 2018-03-15 ~ 2021-09-30");
  check(`${P}백테스트: 직접 입력한 시작일·종료일로 계산`, t.includes("계산 기간 2018-03-15 ~ 2021-09-30"));
  // 상장 전 시작일 → 계산하지 않고 공통 기간 제안
  await page.getByLabel("포트폴리오 A 불러오기").selectOption("preset:2");
  await page.getByRole("button", { name: "1년", exact: true }).click();
  await page.getByLabel("시작일").fill("2018-01-02");
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "계산하지 않았습니다");
  check(`${P}백테스트: 상장 전 기간은 계산 안 함 (JEPQ 2022-05-04)`, t.includes("JEPQ: 데이터가 2022-05-04부터") && t.includes("공통 기간"));
  await page.getByRole("button", { name: /공통 기간\(2022-05-04~\)으로 맞추기/ }).click();
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "계산 기간 2022-05-04");
  check(`${P}백테스트: 공통 기간으로 맞춰 계산 + 종목별 전체 기간 결과 따로`, t.includes("계산 기간 2022-05-04") && t.includes("각 종목의 전체 이용 가능 기간 성과"));
  // 비중 합계 확인과 자동 정규화
  await page.getByLabel("포트폴리오 B 비중 2").fill("40");
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "비중 합계가 90%");
  check(`${P}백테스트: 비중 합계 100% 확인`, t.includes("비중 합계가 90%"));
  await page.getByLabel("비중 합계가 100%가 아니면 자동 정규화 (끄면 오류로 알림)").check();
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "자동 정규화했습니다");
  check(`${P}백테스트: 자동 정규화 선택 시 계산`, t.includes("100%로 자동 정규화했습니다") && t.includes("결과 비교"));

  // ── 미래 시뮬레이터 ──
  await go("/simulate");
  t = await waitText(page, "기간 종료 시 예상 자산");
  check(`${P}미래: 보수·중립·낙관·사용자 지정 시나리오`, t.includes("보수적") && t.includes("중립적") && t.includes("낙관적") && t.includes("사용자 지정") && t.includes("예측값이 아닙니다"));
  check(`${P}미래: 가격 수익과 분배금 구분·재투자 비교`, t.includes("가격 변화 손익") && t.includes("분배금 합계 (세전)") && (t.includes("재투자하지 않으면") || t.includes("재투자하면")));
  const before = t.match(/기간 종료 시 예상 자산 (\$[\d,]+)/)?.[1];
  await page.getByRole("button", { name: "직접 입력" }).click();
  await page.getByLabel("기간 년").fill("1");
  await page.getByLabel("기간 개월").fill("3");
  t = await waitText(page, "= 15개월");
  const after = t.match(/기간 종료 시 예상 자산 (\$[\d,]+)/)?.[1];
  check(`${P}미래: 기간 직접 입력 (15개월) 반영`, t.includes("15개월 뒤 기준") && before !== after, `${before} → ${after}`);
  await page.getByRole("tab", { name: "몬테카를로 (과거 수익률 분포)" }).click();
  await page.getByRole("button", { name: "몬테카를로 실행" }).click();
  t = await waitText(page, "원금 손실 확률");
  check(`${P}미래: 몬테카를로 분위수·손실 확률`, t.includes("중앙값") && t.includes("하위 5%") && t.includes("원금 손실 확률") && t.includes("사용한 과거 기간"));
  await page.screenshot({ path: path.join(out, `${slug}-simulate.png`), fullPage: true });

  // ── 스트레스 테스트 ──
  await go("/stress");
  t = await waitText(page, "분배금 변화 없음");
  check(`${P}스트레스: 분배금 0·10·20·30% 감소 (내 자산 기준)`, t.includes("분배금 변화 없음") && t.includes("전체 10% 감소") && t.includes("전체 30% 감소") && t.includes("예측이 아닙니다"));
  await page.getByLabel("JEPI 감소율").fill("50");
  t = await waitText(page, "특정 종목만 감소");
  check(`${P}스트레스: 특정 종목만 감소 시나리오 구분`, t.includes("특정 종목만 감소 (JEPI 50%)") && t.includes("재투자 가능 금액"));
  await page.getByRole("tab", { name: "하락장" }).click();
  t = await waitText(page, "과거 실제 하락 구간", 20000);
  check(`${P}스트레스: 하락장 단순 충격·일일 복리 경로·과거 구간`, t.includes("단순 충격 분석") && t.includes("일일 복리 경로") && t.includes("베타") && t.includes("과거 실제 하락 구간"));
  await page.screenshot({ path: path.join(out, `${slug}-stress.png`), fullPage: true });

  // ── 전략 ──
  await go("/strategies");
  await waitText(page, "저장한 전략");
  await page.getByRole("button", { name: "예시 전략 추가" }).click();
  t = await waitText(page, "QQQ 40% + SCHD 30% + DIVO 30%");
  await page.getByRole("button", { name: "복제" }).first().click();
  t = await waitText(page, "(복사본)");
  check(`${P}전략: 예시 추가·복제`, t.includes("(복사본)") && t.includes("VOO 50% + JEPI 50%"));
  t = await waitText(page, "전략 한눈에 비교");
  check(`${P}전략: 같은 조건 한눈에 비교`, t.includes("전략 한눈에 비교") && /\$[\d,]+/.test(t));
  const dlS = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 내보내기" }).click();
  const fS = path.join(out, `${slug}-strategies.json`);
  await (await dlS).saveAs(fS);
  const sj = JSON.parse(fs.readFileSync(fS, "utf8"));
  check(`${P}전략: JSON 내보내기`, sj.format === "usi-strategies" && sj.strategies.length === 6);
  await page.getByRole("link", { name: "백테스트" }).first().click();
  await page.waitForURL(/backtest/);
  await page.waitForTimeout(800);
  check(`${P}전략: 전략별 백테스트로 불러오기`, (await page.getByLabel("포트폴리오 A 이름").inputValue()) === "SCHD 50% + DIVO 50%");

  // ── 대시보드: 개인 영역 ──
  await go("/");
  t = await waitText(page, "최근 백테스트·시뮬레이션 결과");
  check(`${P}대시보드: 내 총자산·분배금·전략·최근 결과`, t.includes(money(value + cash)) && t.includes("최근 12개월 실제 분배금") && t.includes("SCHD 50% + DIVO 50%") && t.includes("백테스트 "));

  // ── 원화 환산 ──
  await go("/settings");
  await page.getByRole("button", { name: "USD + 원화 환산 함께" }).click();
  await go("/stock/QQQ");
  t = await waitText(page, "≈ ₩");
  check(`${P}원화 환산 표시 (설정)`, t.includes("≈ ₩"));
  await go("/stock/AAPL?tab=news");
  t = await waitText(page, "관련 공시");
  check(`${P}종목 상세: 관련 공시(SEC)`, t.includes("관련 공시 (SEC EDGAR)") && t.includes("[TEST] Quarterly report"));

  // ── 백업·복원 ──
  await go("/settings");
  await waitText(page, "데이터 관리");
  const dl1 = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 파일로 내보내기" }).click();
  const plainPath = path.join(out, `${slug}-userdata.json`);
  await (await dl1).saveAs(plainPath);
  const plain = JSON.parse(fs.readFileSync(plainPath, "utf8"));
  check(`${P}백업: 일반 내보내기 (자산·가상·전략·설정 포함)`, plain.format === "usi-userdata" && plain.data.portfolio.ledger.length >= 8 && plain.data.virtual.trades.length === 1 && plain.data.strategies.length === 6 && Object.keys(plain.browser).some((k) => k === "usi-prefs-v1"));
  await page.getByLabel("백업 비밀번호", { exact: true }).fill("test-password-1");
  await page.getByLabel("백업 비밀번호 확인").fill("test-password-1");
  const dl2 = page.waitForEvent("download");
  await page.getByRole("button", { name: "암호화 백업 내려받기" }).click();
  const encPath = path.join(out, `${slug}-backup.encrypted.json`);
  await (await dl2).saveAs(encPath);
  const encText = fs.readFileSync(encPath, "utf8");
  const enc = JSON.parse(encText);
  check(`${P}백업: 암호화 파일 (내용이 평문으로 보이지 않음)`, enc.format === "usi-userdata-encrypted" && enc.kdf.iterations >= 100000 && !encText.includes('"ledger"') && !encText.includes('"symbol"') && !encText.includes('"QQQ"') && !encText.includes("test-password-1"));
  // 전체 초기화
  await page.getByRole("button", { name: "전체 초기화" }).click();
  await page.waitForTimeout(1500);
  await go("/portfolio");
  t = await waitText(page, "아직 입력한 자산이 없습니다");
  check(`${P}초기화: 모든 개인 데이터 삭제`, t.includes("아직 입력한 자산이 없습니다"));
  // 잘못된 파일
  const badPath = path.join(out, "bad.json");
  fs.writeFileSync(badPath, JSON.stringify({ foo: 1 }));
  await go("/settings");
  await page.getByLabel("복원할 데이터 파일").setInputFiles(badPath);
  t = await waitText(page, "이 사이트에서 내보낸 데이터 파일이 아닙니다");
  check(`${P}복원: 형식이 다른 파일 거부`, t.includes("이 사이트에서 내보낸 데이터 파일이 아닙니다"));
  // 암호화 백업 복원 (틀린 비밀번호 → 맞는 비밀번호)
  await page.getByLabel("복원할 데이터 파일").setInputFiles(encPath);
  await waitText(page, "암호화된 백업입니다");
  await page.getByLabel("복원 비밀번호").fill("wrong-password");
  await page.getByRole("button", { name: "복호화" }).click();
  t = await waitText(page, "비밀번호가 맞지 않거나");
  check(`${P}복원: 틀린 비밀번호 거부`, t.includes("비밀번호가 맞지 않거나 파일이 손상되었습니다"));
  await page.getByLabel("복원 비밀번호").fill("test-password-1");
  await page.getByRole("button", { name: "복호화" }).click();
  await waitText(page, "현재 데이터를 지우고 복원");
  await page.getByRole("button", { name: "현재 데이터를 지우고 복원" }).click();
  await page.waitForTimeout(2000);
  await go("/portfolio");
  t = await waitText(page, money(value + cash));
  check(`${P}복원: 암호화 백업에서 자산·거래 내역 복원`, t.includes(money(value + cash)) && t.includes("분배금 재투자"));
  await go("/strategies");
  t = await waitText(page, "(복사본)");
  check(`${P}복원: 전략도 복원`, t.includes("(복사본)"));

  // ── 모바일 가로 넘침 ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
  const m = await mctx.newPage();
  for (const u of ["/portfolio", "/paper", "/backtest", "/simulate", "/stress", "/strategies", "/settings"]) {
    await m.goto(`${base}${u}`, { waitUntil: "networkidle" });
    await m.waitForTimeout(600);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${P}모바일(390px) ${u}: 가로 넘침 없음`, overflow <= 1, `넘침 ${overflow}px`);
    await m.screenshot({ path: path.join(out, `${slug}-mobile${u.replace(/\//g, "-")}.png`), fullPage: true });
  }
  await mctx.close();
  check(`${P}새 기능 페이지 스크립트 오류 없음`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}
