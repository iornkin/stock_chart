/**
 * 내 자산(수익률·원화 기준)·백테스트·시뮬레이터·스트레스 테스트·전략·백업 e2e 확인 (서버 모드·정적 모드 공용)
 * ⚠ 합성(테스트용) 시장 데이터로 실행한다. 실제 시세가 아니다.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { fmtPct } from "@/lib/format";

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
  let t = await waitText(page, "입력 전에는 금액을 표시하지 않습니다");
  check(`${P}대시보드: 자산 입력 전 개인 금액 표시 안 함`, t.includes("입력 전에는 금액을 표시하지 않습니다") && t.includes("내 자산 입력"));

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
  // 간편 입력 수익률 = (평가금액 − 매수 원가 9,500) ÷ 9,500 (최초 매수일이 없어 분배금 추정 없음)
  const simpleRet = fmtPct(((10 * qqq + 100 * jepi - 9500) / 9500) * 100, 2);
  check(`${P}내 자산(간편): 입력하자마자 총수익률·평가 수익률`, t.includes("총수익률") && t.includes("평가 수익률") && t.includes(simpleRet), simpleRet);
  await page.getByRole("button", { name: "원화 기준 (환율 반영)" }).click();
  t = await waitText(page, "원화 기준으로 계산할 수 없습니다");
  check(`${P}내 자산(간편): 매수 환율·최초 매수일이 없으면 원화 기준 계산 안 함 (안내)`, t.includes("평균 매수 환율이나 최초 매수일을 넣으면"));
  await page.getByRole("button", { name: "달러 기준" }).click();
  const tabs = page.getByRole("tablist", { name: "내 자산 화면" });
  await tabs.getByRole("tab", { name: "분배금" }).click();
  t = await waitText(page, "예상 연간 분배금 (추정)");
  check(`${P}내 자산(간편): 예상 연간 분배금은 추정으로 구분`, t.includes("예상 연간 분배금 (추정)") && t.includes("확정 아님"));
  await page.reload({ waitUntil: "networkidle" });
  t = await waitText(page, money(total));
  check(`${P}내 자산: 새로고침 후 데이터 유지 (IndexedDB)·요약과 보유 종목 탭`, t.includes("QQQ") && t.includes("JEPI") && t.includes(money(total)) && t.includes("비중"));
  await tabs.getByRole("tab", { name: "세금" }).click();
  t = await waitText(page, "해외주식 양도소득세");
  check(`${P}내 자산: 세금 탭 (양도세·금융소득 기준)`, t.includes("해외주식 양도소득세") && t.includes("2,000만 원"));

  // ── 간편 입력 → 거래 내역 전환 (중복 계산 없음) ──
  await tabs.getByRole("tab", { name: "보유 종목 입력" }).click();
  await page.getByRole("button", { name: "거래 내역 관리로 전환" }).click();
  t = await waitText(page, "기초 보유");
  check(`${P}전환: 기초 보유·입금 기록 생성`, t.includes("기초 보유") && t.includes("입금"));
  check(`${P}전환: 총자산이 그대로 (수량·원가 중복 없음)`, t.includes(money(total)) && t.includes(`투자 원금 ${money(10500)}`));

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
  await tabs.getByRole("tab", { name: "분배금" }).click();
  t = await waitText(page, money(90));
  check(`${P}거래 내역: 실제 분배금 누적 (수령+재투자)`, t.includes(money(90)));
  check(`${P}거래 내역: 외부 입출금은 원금으로 구분`, t.includes(`투자 원금 ${money(10800)}`));
  const cash = 1000 + 500 - 1001 + 2599 + 42.5 + (34 - 33) - 200;
  const value = 7 * qqq + 100.6 * jepi;
  t = await waitText(page, money(value + cash));
  check(`${P}거래 내역: 총자산 = 평가금액 + 현금`, t.includes(money(value + cash)), `기대 ${money(value + cash)}`);
  await tabs.getByRole("tab", { name: "세금" }).click();
  t = await waitText(page, "년 실현 손익 (원화)");
  check(`${P}거래 내역: 세금 탭 — 매도 차익 원화 환산·기본공제`, t.includes("년 실현 손익 (원화)") && t.includes("250만 원") && !t.includes("매도 없음"));
  await page.reload({ waitUntil: "networkidle" });
  await tabs.getByRole("tab", { name: "거래 입력·내역" }).click();
  t = await waitText(page, "분배금 재투자");
  check(`${P}거래 내역: 새로고침 후 유지`, t.includes("분배금 재투자") && t.includes(money(value + cash)));
  await page.screenshot({ path: path.join(out, `${slug}-portfolio.png`), fullPage: true });

  // ── 수익률: 달러 기준 ↔ 원화 기준 (거래 환율이 없으면 그날 원/달러 종가로 근사) ──
  await tabs.getByRole("tab", { name: "보유 종목", exact: true }).click();
  t = await waitText(page, "종목별 수익률");
  check(`${P}수익률: 종목별 평가 수익률·총수익률 (달러 기준)`, t.includes("총손익 (총수익률)") && t.includes("QQQ") && t.includes("JEPI"));
  await page.getByRole("button", { name: "원화 기준 (환율 반영)" }).click();
  t = await waitText(page, "환율 효과");
  check(`${P}수익률: 원화 기준 버튼 → 환율 효과·원화 총수익률`, t.includes("환율 효과") && /달러 기준 [+−-]?[\d.]+% → 원화 기준 [+−-]?[\d.]+%/.test(t) && t.includes("₩") && t.includes("그날 원/달러 종가로 근사"));
  await page.getByRole("button", { name: "달러 기준" }).click();
  await page.screenshot({ path: path.join(out, `${slug}-portfolio-returns.png`), fullPage: true });

  // ── 성과 분석·목표 비중·노출 분석·세후 분배금 ──
  await tabs.getByRole("tab", { name: "성과 분석" }).click();
  t = await waitText(page, /시간가중수익률 \(TWR\)|수익률을 계산할 수 없습니다/);
  check(`${P}성과 분석: TWR·XIRR 따로 표시 또는 계산 불가 사유`, (t.includes("시간가중수익률 (TWR)") && t.includes("금액가중수익률 (XIRR") && t.includes("검증 통과")) || t.includes("수익률을 계산할 수 없습니다"), t.slice(t.indexOf("성과 분석"), t.indexOf("성과 분석") + 200));
  check(`${P}성과 분석: NaN·undefined 없음`, !/NaN|undefined/.test(t));
  await tabs.getByRole("tab", { name: "목표 비중" }).click();
  await waitText(page, "현재 비중으로 채우기");
  await page.getByRole("button", { name: "현재 비중으로 채우기" }).click();
  await page.getByRole("button", { name: "목표 저장" }).click();
  t = await waitText(page, "거래 비용 반영 전후");
  check(`${P}목표 비중: 현재 비중 저장 → 매수·매도 계산·비용 전후 비교`, t.includes("매수(+) / 매도(−)") && t.includes("거래 비용 반영 전후") && t.includes("계산에 쓴 시세"));
  await page.getByRole("button", { name: "추가 투자금만" }).click();
  await page.getByLabel("새로 넣을 금액 (달러)").fill("1000");
  t = await waitText(page, "현금 행의 현재 비중은 새로 넣을 금액을 더한 뒤 기준");
  check(`${P}목표 비중: 추가 투자금만 (매도 없음)`, t.includes("새로 넣을 금액을 더한 뒤") && !t.includes("NaN"));
  await tabs.getByRole("tab", { name: "노출 분석" }).click();
  t = await waitText(page, /종목까지 확인한 비율|편입 종목 자료를 불러오지 못했습니다/);
  check(`${P}노출 분석: 확인 비율·섹터·유형 (상위 편입 기준)`, t.includes("종목까지 확인한 비율") && t.includes("유형별 비중") && t.includes("상위 편입"));
  t = await waitText(page, /ETF 구성 변화 \(기록 기준\)[\s\S]*(기록 \d+건|아직 기록 없음)/);
  check(`${P}노출 분석: ETF 구성 변화 (이 사이트가 쌓은 기록끼리만 비교)`, t.includes("ETF 구성 변화 (기록 기준)") && t.includes("기록을 시작하기 전의 변화는 알 수 없어") && /기록 \d+건|아직 기록 없음/.test(t));
  await tabs.getByRole("tab", { name: "분배금" }).click();
  t = await waitText(page, "세후 분배금 (세율 가정별)");
  check(`${P}분배금: 세율 가정별 세후 비교·재투자 가정`, t.includes("15% (한·미 조세조약)") && t.includes("30% (조약 미적용)") && t.includes("세후 재투자 가정"));
  await page.getByRole("group", { name: "분배금 세율 가정" }).getByRole("button", { name: "직접 입력" }).click();
  await page.getByLabel("직접 입력 세율").fill("22");
  t = await waitText(page, "직접 입력 22%");
  check(`${P}분배금: 직접 입력한 세율로 계산`, t.includes("직접 입력 22%"));

  // ── 변화 분석·데이터 점검·타임머신 (거래 내역 모드) ──
  await tabs.getByRole("tab", { name: "변화 분석" }).click();
  t = await waitText(page, /매매 시점 차이|분석하지 않았습니다/);
  check(`${P}변화 분석: 가격 변화·매매 시점·입출금을 나눠 표시 (또는 분석 불가 사유)`, ((t.includes("가격 변화") && t.includes("매매 시점 차이")) || t.includes("분석하지 않았습니다")) && !/NaN|undefined/.test(t), t.slice(t.indexOf("변화 분석"), t.indexOf("변화 분석") + 160));
  await page.getByRole("group", { name: "기간" }).getByRole("button", { name: "직접 선택" }).click();
  check(`${P}변화 분석: 기간 직접 선택`, (await page.getByLabel("변화 분석 시작일").count()) === 1);
  await tabs.getByRole("tab", { name: "데이터 점검" }).click();
  t = await waitText(page, "점검 범위");
  check(`${P}데이터 점검: 상태별 개수(오류 확정·확인 필요·데이터 부족·업데이트 지연·정상)`, ["오류 확정", "확인 필요", "데이터 부족", "업데이트 지연", "정상", "점검 범위"].every((x) => t.includes(x)) && !/NaN|undefined/.test(t));
  await tabs.getByRole("tab", { name: "자산 추이" }).click();
  t = await waitText(page, "타임머신 — 과거 날짜의 실제 보유 상태");
  check(`${P}자산 추이: 타임머신 (두 날짜 비교)`, t.includes("타임머신") && (await page.getByLabel("타임머신 날짜 A").count()) === 1);

  // ── CSV 가져오기: 열 자동 인식 → 검증 → 중복 제외 → 반영 전후 미리보기 → 확인 후 반영 → 되돌리기 ──
  await tabs.getByRole("tab", { name: "거래 입력·내역" }).click();
  await page.getByText("CSV 파일로 거래 내역 가져오기").click();
  const csvPath = path.join(out, `${slug}-import.csv`);
  fs.writeFileSync(csvPath, ["날짜,종류,티커,수량,가격,수수료,금액", "2026-01-05,입금,,,,,300", "2026-01-06,매수,QQQ,1,250,0,", "2026-01-06,매수,QQQ,1,250,0,", "2099-01-01,매수,QQQ,1,250,0,", "2026-01-07,매수,ZZZZ,1,10,0,"].join("\n"));
  await page.getByLabel("가져올 CSV 파일").setInputFiles(csvPath);
  t = await waitText(page, "건 반영");
  check(`${P}CSV: 열 자동 인식·미래 날짜·지원 안 하는 종목 표시·파일 안 중복 제외`, t.includes("미래 날짜") && t.includes("ZZZZ") && t.includes("확인하고 2건 반영"), t.slice(t.indexOf("CSV"), t.indexOf("CSV") + 300));
  check(`${P}CSV: 반영 전후 미리보기 (현금·보유 수량)`, t.includes("QQQ 7 → 8주") || /QQQ [\d.]+ → [\d.]+주/.test(t));
  await page.getByRole("button", { name: "확인하고 2건 반영" }).click();
  t = await waitText(page, "되돌리기 (2건)");
  check(`${P}CSV: 반영 후 가져온 묶음 되돌리기 버튼`, t.includes("되돌리기 (2건)"));
  await page.getByRole("button", { name: /되돌리기 \(2건\)/ }).click();
  await page.waitForTimeout(500);
  t = await waitText(page, money(value + cash));
  check(`${P}CSV: 되돌리면 원래 총자산`, t.includes(money(value + cash)) && !t.includes("되돌리기 (2건)"));

  // ── 백테스트 ──
  await go("/backtest");
  await waitText(page, "종목별 실제 데이터 범위");
  await page.getByRole("button", { name: "5년", exact: true }).click();
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "4. 결과");
  check(`${P}백테스트: 두 포트폴리오·벤치마크 동일 조건 비교`, t.includes("최종 평가금액") && t.includes("연환산 수익률 (CAGR)") && t.includes("최대 낙폭") && t.includes("샤프 비율") && t.includes("벤치마크 대비 초과 총수익률"));
  check(`${P}백테스트: 분배금 재투자 효과·가격만 수익률 구분`, t.includes("재투자 효과") && t.includes("가격만의 수익률"));
  check(`${P}백테스트: 종목별 분배금·회복 기간·최악의 기간·연도별 변동`, t.includes("└ 종목별 분배금 (세후)") && t.includes("최대 낙폭 회복 기간") && t.includes("최악의 12개월 / 최악의 달") && t.includes("연도별 수익률 변동"));
  const btTabs = page.getByRole("tablist", { name: "백테스트 결과" });
  await btTabs.getByRole("tab", { name: "자산 추이·낙폭" }).click();
  await page.waitForTimeout(500);
  const btCanvas = await page.locator("canvas").count();
  await btTabs.getByRole("tab", { name: "연도·월별" }).click();
  t = await waitText(page, "월별 수익률 히트맵");
  check(`${P}백테스트: 차트·히트맵·연도별 (탭)`, btCanvas >= 2 && t.includes("월별 수익률 히트맵") && (await page.getByRole("img", { name: "연도별 수익률 비교" }).count()) === 1, `canvas ${btCanvas}`);
  check(`${P}백테스트: 과거 성과 미보장 안내`, t.includes("과거 성과는 미래 수익을 보장하지 않습니다"));
  await btTabs.getByRole("tab", { name: "검증·재현" }).click();
  t = await waitText(page, "요청한 기간");
  check(`${P}백테스트: 검증·재현 (요청·실제 기간, 종목별 데이터, 재현 코드)`, t.includes("실제 계산 기간") && t.includes("종목별 데이터") && /데이터 코드 [0-9a-f]{8}/.test(t) && t.includes("한계"));
  check(`${P}백테스트: 비교 공정성 점검 (같은 기간·조건·상장 전 데이터)`, t.includes("비교 공정성 점검") && /통과|주의|문제/.test(t));
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
  await page.getByRole("tablist", { name: "백테스트 결과" }).getByRole("tab", { name: "종목별" }).click();
  t = await waitText(page, "각 종목의 전체 이용 가능 기간 성과");
  check(`${P}백테스트: 공통 기간으로 맞춰 계산 + 종목별 전체 기간 결과 따로`, t.includes("계산 기간 2022-05-04") && t.includes("각 종목의 전체 이용 가능 기간 성과"));
  // 비중 합계 확인과 자동 정규화
  await page.getByLabel("포트폴리오 B 비중 2").fill("40");
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "비중 합계가 90%");
  check(`${P}백테스트: 비중 합계 100% 확인`, t.includes("비중 합계가 90%"));
  await page.getByLabel("비중 합계가 100%가 아니면 자동 정규화 (끄면 오류로 알림)").check();
  await page.getByRole("button", { name: "백테스트 실행" }).click();
  t = await waitText(page, "자동 정규화했습니다");
  check(`${P}백테스트: 자동 정규화 선택 시 계산 (결과 위에 안내)`, t.includes("100%로 자동 정규화했습니다") && t.includes("4. 결과"));

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
  await page.getByLabel("포트폴리오 A 이름", { exact: true }).fill("내 배당 계획");
  await page.getByLabel("포트폴리오 A 비중 1").fill("60");
  await page.getByLabel("포트폴리오 A 비중 2").fill("40");
  await page.waitForTimeout(300);
  check(`${P}미래: 포트폴리오 이름 직접 입력 (비중을 바꿔도 유지)`, (await page.getByLabel("포트폴리오 A 이름", { exact: true }).inputValue()) === "내 배당 계획");
  const scen = page.getByRole("tablist", { name: "시나리오 결과" });
  await scen.getByRole("tab", { name: "분배금 (종목별)" }).click();
  t = await waitText(page, "종목별");
  check(`${P}미래: 분배금 종목별 (세전·세후, 연도별)`, /SCHD|JEPI|QQQ|DIVO|VOO/.test(t) && t.includes("세후") && !/NaN|undefined/.test(t));
  await scen.getByRole("tab", { name: "연도별 상세" }).click();
  t = await waitText(page, "월별 CSV");
  check(`${P}미래: 연도별 상세 (시작·납입·가격·분배금·비용·끝) + CSV`, t.includes("월별 CSV") && t.includes("납입") && !/NaN|undefined/.test(t));
  await page.getByRole("tab", { name: "몬테카를로 (과거 수익률 분포)" }).click();
  await page.getByRole("button", { name: "몬테카를로 실행" }).click();
  t = await waitText(page, "원금 손실 확률");
  check(`${P}미래: 몬테카를로 분위수·손실 확률`, t.includes("중앙값") && t.includes("하위 5%") && t.includes("원금 손실 확률") && t.includes("사용한 과거 기간"));
  check(`${P}미래: 몬테카를로 연환산 수익률 분포·목표 확률`, t.includes("연환산") && t.includes("목표") && !/NaN|undefined/.test(t));
  await page.screenshot({ path: path.join(out, `${slug}-simulate.png`), fullPage: true });

  // ── 스트레스 테스트 ──
  await go("/stress");
  t = await waitText(page, "전체 30% 감소");
  check(`${P}스트레스: 지금 대비 분배금 10·20·30% 감소 (내 자산 기준)`, t.includes("지금 (최근 12개월 실제)") && t.includes("전체 10% 감소") && t.includes("전체 30% 감소") && t.includes("예측이 아닙니다"));
  await page.getByLabel("JEPI 감소율").fill("50");
  t = await waitText(page, "특정 종목만 감소");
  check(`${P}스트레스: 특정 종목만 감소 시나리오 구분`, t.includes("특정 종목만 감소 (JEPI 50%)") && t.includes("연간 세후"));
  await page.getByRole("tab", { name: "하락장" }).click();
  t = await waitText(page, "과거 실제 하락 구간", 20000);
  check(`${P}스트레스: 하락장 경로 계산·종목별 베타·과거 구간`, t.includes("지수가 하락하면") && t.includes("예상 손익률") && t.includes("베타") && t.includes("과거 실제 하락 구간"));
  await page.getByRole("tab", { name: "위험 예산" }).click();
  t = await waitText(page, "종목별 비중과 위험 요인", 20000);
  check(`${P}위험 예산: 시나리오별 손실 vs 최대 손실 기준`, t.includes("시나리오별 예상 손실") && t.includes("기준 대비") && t.includes("기술주 전체 하락") && t.includes("장기 금리 상승") && t.includes("분배금 −30% + 시장 −20%") && t.includes("레버리지 ETF 급락"));
  check(`${P}위험 예산: 종목별 변동성·베타·낙폭·위험 기여·금리 민감도`, t.includes("위험 기여") && t.includes("금리 +1%p 때") && t.includes("예측이 아니라 가정에 따른 계산") && !/NaN|undefined/.test(t));
  await page.getByLabel("최대 손실 기준").fill("1");
  t = await waitText(page, "기준을 넘습니다");
  check(`${P}위험 예산: 기준을 낮추면 초과 표시`, t.includes("초과"));
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
  check(`${P}전략: 전략별 백테스트로 불러오기`, (await page.getByLabel("포트폴리오 A 이름", { exact: true }).inputValue()) === "SCHD 50% + DIVO 50%");

  // ── 대시보드: 개인 영역 ──
  await go("/");
  t = await waitText(page, "저장한 전략 6개");
  check(`${P}대시보드: 내 총자산·분배금·전략·최근 결과 수`, t.includes(money(value + cash)) && t.includes("최근 12개월 실제 분배금") && t.includes("저장한 전략 6개") && /최근 계산 결과 [1-9]\d*개/.test(t) && t.includes("총수익률 (달러 기준)"));

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
  check(`${P}백업: 일반 내보내기 (자산·전략·설정 포함)`, plain.format === "usi-userdata" && plain.data.portfolio.ledger.length >= 8 && plain.data.virtual === undefined && plain.data.strategies.length === 6 && Object.keys(plain.browser).some((k) => k === "usi-prefs-v1"));
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
  await waitText(page, money(value + cash));
  await tabs.getByRole("tab", { name: "거래 입력·내역" }).click();
  t = await waitText(page, "분배금 재투자");
  check(`${P}복원: 암호화 백업에서 자산·거래 내역 복원`, t.includes(money(value + cash)) && t.includes("분배금 재투자"));
  await go("/strategies");
  t = await waitText(page, "(복사본)");
  check(`${P}복원: 전략도 복원`, t.includes("(복사본)"));

  // ── 투자 판단 기록장 ──
  await go("/journal");
  await waitText(page, "새 기록");
  await page.getByLabel("기록 종목").fill("QQQ");
  await page.getByLabel("기록 날짜").fill("2026-03-02");
  await page.getByLabel("투자 이유").fill("장기 성장 기대 (e2e 테스트)");
  await page.getByLabel("감수할 손실").fill("15");
  await page.getByLabel("다시 볼 날짜").fill("2026-06-01");
  await page.getByRole("button", { name: "기록 저장" }).click();
  t = await waitText(page, "기록 후 최대 하락", 20000);
  check(`${P}투자 기록: 원래 기록 보존 + 기록 이후 실제 가격·낙폭`, t.includes("장기 성장 기대 (e2e 테스트)") && t.includes("이 내용은 고치지 않습니다") && t.includes("기록 후 최대 하락") && t.includes("(지남)") && !/NaN|undefined/.test(t), t.slice(t.indexOf("기록 이후"), t.indexOf("기록 이후") + 200));

  // ── 투자 보고서 ──
  await go("/report");
  t = await waitText(page, "다음 검토 때 확인할 것", 20000);
  check(`${P}보고서: 11개 항목·인쇄`, ["전체 자산 현황", "투자 원금과 평가금액", "기간별 수익률", "종목별 수익 기여도", "자산 배분", "ETF 중복 노출", "배당·분배금 수령 현황", "데이터 오류·확인 사항", "주요 위험 요인", "재검토할 투자 기록", "다음 검토 때 확인할 것"].every((x) => t.includes(x)) && t.includes("인쇄 / PDF 로 저장") && !/NaN|undefined/.test(t));
  check(`${P}보고서: 재검토할 기록에 지난 투자 기록 포함`, t.includes("QQQ 2026-03-02 기록 — 다시 볼 날 2026-06-01 지남"));
  await page.screenshot({ path: path.join(out, `${slug}-report.png`), fullPage: true });

  // ── 목표 역산 ──
  await go("/income/target");
  t = await waitText(page, "4. 목표 달성 계획", 20000);
  check(`${P}목표 계산: 기간·월 투자 역산·시나리오`, t.includes("4. 목표 달성 계획 (기간·월 투자)") && !/NaN|undefined/.test(t));

  // ── 알림 (이 브라우저에서만) ──
  await go("/alerts");
  await waitText(page, "규칙 추가");
  await page.getByLabel("알림 종류").selectOption("price");
  await page.getByLabel("알림 종목").fill("QQQ");
  await page.getByLabel("가격 (달러)").fill("1");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  t = await waitText(page, "QQQ 가격 이상 도달");
  check(`${P}알림: 규칙 추가 → 사이트 안에서 확인·기록`, t.includes("QQQ 가격 이상 도달") && t.includes("지원하지 않습니다"));
  check(`${P}확인함: 확인할 일 (알림·데이터 점검·투자 기록) 한곳에`, /확인할 일 \d+건/.test(t));
  const bell = (await page.locator('header a[href*="/alerts"]').first().getAttribute("aria-label")) ?? "";
  check(`${P}알림: 머리글 읽지 않은 알림 수`, bell.includes("1개 읽지 않음"), bell);
  check(`${P}확인함: 머리글에 다시 볼 투자 기록 수`, bell.includes("다시 볼 투자 기록 1건"), bell);

  // ── 모바일 가로 넘침 ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
  const m = await mctx.newPage();
  for (const u of ["/portfolio", "/backtest", "/simulate", "/stress", "/strategies", "/settings", "/alerts", "/journal", "/report", "/income/target"]) {
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
