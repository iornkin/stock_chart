/**
 * 내 자산 데이터 점검 (순수 함수) — 잘못된 데이터로 잘못된 결론을 내리지 않도록
 *
 * 분류: 오류 확정 / 확인 필요 / 데이터 부족 / 업데이트 지연 / 정상
 * - 사용자 입력은 고치지 않는다. 고칠 수 있는 항목은 '수정안'(무엇이 어떻게 바뀌는지)만 만든다.
 */
import { computeLedger, sortTxns } from "./ledger";
import type { PortfolioData, Txn } from "./types";
import { TXN_KO } from "./types";
import { addDays, closeOn, type PriceSeries } from "@/lib/sim/series";
import { detectUnadjustedHoldings, detectUnadjustedTrades } from "./splits";

export type CheckStatus = "error" | "check" | "missing" | "stale" | "ok";
export const CHECK_STATUS_KO: Record<CheckStatus, string> = {
  error: "오류 확정",
  check: "확인 필요",
  missing: "데이터 부족",
  stale: "업데이트 지연",
  ok: "정상",
};

export interface CheckItem {
  /** 같은 문제를 다시 찾았을 때 같은 키 (확인함에서 갱신용) */
  key: string;
  status: CheckStatus;
  title: string;
  cause: string;
  /** 영향을 받는 계산 */
  affects: string[];
  fix: string;
  /** 관련 거래 */
  txnIds?: string[];
  /** 지우면 해결되는 중복 거래 (사용자가 확인한 뒤에만) */
  removable?: string[];
  /** 주식분할 반영으로 고칠 수 있는 거래·보유 (사용자가 확인한 뒤에만) */
  splitFix?: { kind: "txn" | "holding"; id: string; factor: number }[];
}

export interface QuoteInfo {
  symbol: string;
  time: number | null;
  source: string | null;
}

export interface DataCheckInput {
  p: PortfolioData;
  today: string;
  now: number;
  /** 보유 종목 시세 (없으면 time null) */
  quotes: QuoteInfo[];
  quotesError: string | null;
  fx: { time: number | null } | null;
  /** 보유 종목의 일봉·분배금 (없는 종목은 빠짐) */
  series: Record<string, PriceSeries | undefined>;
  /** 종목별 연 지급 횟수와 최근 정기 배당락일 */
  income: Record<string, { perYear: number | null; latestEx: string | null } | undefined>;
  staleQuoteMs: number;
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US");
const txnLabel = (t: Txn) => `${t.date} ${TXN_KO[t.type]}${t.symbol ? ` ${t.symbol}` : ""}${t.shares ? ` ${t.shares}주` : ""}${t.price ? ` @$${t.price}` : ""}${t.amount ? ` $${fmt(t.amount)}` : ""}`;

/** 보유 기간에 실제 지급됐지만 거래 내역에 기록되지 않은 분배금 */
export function missingDividendRecords(ledger: Txn[], series: Record<string, PriceSeries | undefined>, today: string): { symbol: string; ex: string; pay: string | null; perShare: number; shares: number }[] {
  const symbols = [...new Set(ledger.filter((t) => t.type !== "deposit" && t.type !== "withdraw").map((t) => t.symbol).filter((x): x is string => !!x))];
  const out: { symbol: string; ex: string; pay: string | null; perShare: number; shares: number }[] = [];
  for (const sym of symbols) {
    const x = series[sym];
    if (!x) continue;
    const first = ledger.filter((t) => t.symbol === sym).map((t) => t.date).sort()[0];
    for (const d of x.divs) {
      const when = d.pay ?? d.ex;
      if (d.ex <= first || when > today) continue;
      const held = computeLedger(ledger, {}, addDays(d.ex, -1)).positions.find((q) => q.symbol === sym)?.shares ?? 0;
      if (held <= 0) continue;
      const recorded = ledger.some((t) => (t.type === "dividend" || t.type === "reinvest") && t.symbol === sym && t.date >= addDays(d.ex, -3) && t.date <= addDays(when, 20));
      if (!recorded) out.push({ symbol: sym, ex: d.ex, pay: d.pay, perShare: d.amount, shares: held });
    }
  }
  return out.sort((a, b) => b.ex.localeCompare(a.ex));
}

export function checkPortfolioData(input: DataCheckInput): CheckItem[] {
  const { p, today, now } = input;
  const items: CheckItem[] = [];
  const held = p.mode === "simple" ? [...new Set(p.simple.holdings.filter((h) => h.shares > 0).map((h) => h.symbol))] : [...new Set(p.ledger.map((t) => t.symbol).filter((s): s is string => !!s))];

  if (p.mode === "ledger") {
    const sorted = sortTxns(p.ledger);
    // 1) 거래 기록 자체의 오류 (회계 계산이 찾은 문제)
    const l = computeLedger(p.ledger, {});
    for (const iss of l.issues) {
      const t = p.ledger.find((x) => x.id === iss.txnId);
      items.push({
        key: `ledger:${iss.txnId}:${iss.message.slice(0, 20)}`,
        status: iss.level === "error" ? "error" : "check",
        title: iss.level === "error" ? "계산에 반영하지 못한 거래" : "확인이 필요한 거래",
        cause: `${t ? `${txnLabel(t)} — ` : ""}${iss.message}`,
        affects: ["보유 수량", "현금", "총자산·수익률"],
        fix: iss.message.includes("보유 수량") ? "매도 수량이나 이전 매수 기록을 확인하세요." : iss.message.includes("음수") ? "빠진 입금 기록이 있는지 확인하세요." : "거래 입력·내역에서 해당 거래를 고치세요.",
        txnIds: [iss.txnId],
      });
    }
    // 2) 같은 거래가 두 번 들어간 경우 (종류·날짜·종목·수량·가격·금액이 모두 같음)
    const groups = new Map<string, Txn[]>();
    for (const t of sorted) {
      const k = [t.type, t.date, t.symbol ?? "", t.shares ?? "", t.price ?? "", t.amount ?? "", t.fee ?? "", t.tax ?? ""].join("|");
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const isDiv = g[0].type === "dividend" || g[0].type === "reinvest";
      items.push({
        key: `dup:${g.map((t) => t.id).join(",")}`,
        status: "check",
        title: isDiv ? "같은 분배금이 두 번 기록됨" : "같은 거래가 두 번 기록됨",
        cause: `${txnLabel(g[0])} × ${g.length}건 (종류·날짜·종목·수량·가격·금액이 모두 같음)`,
        affects: isDiv ? ["분배금 합계", "현금", "총수익률"] : ["보유 수량", "평균 단가", "현금"],
        fix: "실제로 여러 번 거래했다면 그대로 두세요. 실수로 두 번 넣었다면 하나만 남기고 지우세요.",
        txnIds: g.map((t) => t.id),
        removable: g.slice(1).map((t) => t.id),
      });
    }
    // 3) 분배금 수령과 재투자를 같은 지급에 대해 둘 다 적은 경우
    const divs = sorted.filter((t) => t.type === "dividend" || t.type === "reinvest");
    for (let i = 0; i < divs.length; i++) {
      for (let j = i + 1; j < divs.length; j++) {
        const a = divs[i];
        const b = divs[j];
        if (a.type === b.type || a.symbol !== b.symbol) continue;
        if (b.date > addDays(a.date, 7)) break;
        if (Math.abs((a.amount ?? 0) - (b.amount ?? 0)) > 0.01) continue;
        items.push({
          key: `divboth:${a.id}:${b.id}`,
          status: "check",
          title: "같은 분배금을 '수령'과 '재투자'로 모두 기록했을 수 있음",
          cause: `${txnLabel(a)} / ${txnLabel(b)} — 7일 안에 같은 금액`,
          affects: ["분배금 합계 (두 번 더해질 수 있음)", "현금"],
          fix: "재투자했다면 '분배금 재투자' 하나만, 현금으로 받았다면 '분배금 수령' 하나만 남기세요.",
          txnIds: [a.id, b.id],
        });
      }
    }
    // 4) 거래 금액과 수수료
    for (const t of sorted) {
      if ((t.type === "buy" || t.type === "sell") && t.shares && t.price && t.fee) {
        const value = t.shares * t.price;
        if (t.fee > value * 0.05)
          items.push({ key: `fee:${t.id}`, status: "check", title: "수수료가 거래 금액에 비해 큼", cause: `${txnLabel(t)} — 수수료 $${fmt(t.fee)} (거래 금액의 ${((t.fee / value) * 100).toFixed(1)}%)`, affects: ["실현 손익", "평균 단가", "현금"], fix: "수수료 단위(달러/원)나 자릿수를 확인하세요.", txnIds: [t.id] });
      }
      if ((t.type === "dividend" || t.type === "reinvest") && t.amount && t.tax !== undefined && t.tax > t.amount * 0.5)
        items.push({ key: `divtax:${t.id}`, status: "check", title: "분배금 세금이 분배금의 절반을 넘음", cause: `${txnLabel(t)} — 세금 $${fmt(t.tax)}`, affects: ["세후 분배금"], fix: "세금 금액을 확인하세요 (미국 원천징수는 보통 15%).", txnIds: [t.id] });
    }
    // 5-a) 주식분할 전 기준으로 넣은 거래 (가격 ≈ 분할 반영 종가 × 분할 비율)
    const splitSus = detectUnadjustedTrades(p.ledger, input.series);
    if (splitSus.length)
      items.push({
        key: `split:${splitSus.map((x) => x.id).join(",").slice(0, 200)}`,
        status: "check",
        title: `주식분할 전 기준으로 넣은 것으로 보이는 거래 ${splitSus.length}건`,
        cause: splitSus
          .slice(0, 5)
          .map((x) => `${x.date} ${x.symbol} @$${fmt(x.entered)} — 분할 반영 종가 $${fmt(x.close)}, 이후 분할 ${x.splits.map((s) => `${s.date} ${s.ratio}:1`).join(", ")}`)
          .join(" · ") + (splitSus.length > 5 ? " …" : ""),
        affects: ["보유 수량", "평균 단가", "평가 수익률", "실현 손익", "매도 가능 수량"],
        fix: "맞다면 아래 버튼으로 수량 × 분할 비율, 가격 ÷ 분할 비율로 바꾸세요 (거래 금액은 그대로). 이미 분할을 반영해 넣은 거래라면 그대로 두세요.",
        txnIds: splitSus.map((x) => x.id),
        splitFix: splitSus.map((x) => ({ kind: "txn" as const, id: x.id, factor: x.factor })),
      });
    const splitIds = new Set(splitSus.map((x) => x.id));
    // 5-b) 거래 가격이 그날 실제 종가와 크게 다름 (오타·단위 가능성)
    for (const t of sorted) {
      if (!(t.type === "buy" || t.type === "sell" || t.type === "opening") || !t.symbol || !t.price || splitIds.has(t.id)) continue;
      const s = input.series[t.symbol];
      const c = s ? closeOn(s, t.date) : null;
      if (!c || c.date < addDays(t.date, -7)) continue;
      const ratio = t.price / c.close;
      if (ratio > 1.25 || ratio < 0.8)
        items.push({
          key: `price:${t.id}`,
          status: "check",
          title: "거래 가격이 그날 실제 종가와 크게 다름",
          cause: `${txnLabel(t)} — ${c.date} 종가 $${fmt(c.close)} (${((ratio - 1) * 100).toFixed(0)}% 차이). 일봉은 주식분할을 반영한 가격이라 분할 전 가격을 그대로 넣었다면 차이가 납니다.`,
          affects: ["평균 단가", "평가 수익률", "실현 손익"],
          fix: "가격 단위·오타를 확인하세요. 분할 전 거래라면 분할 비율로 나눈 가격과 곱한 수량으로 고치면 수익률이 맞습니다.",
          txnIds: [t.id],
        });
    }
    // 6) 기록하지 않은 분배금
    const miss = missingDividendRecords(p.ledger, input.series, today);
    if (miss.length)
      items.push({
        key: `divmissing:${miss.map((m) => `${m.symbol}${m.ex}`).join(",").slice(0, 200)}`,
        status: "check",
        title: `보유 중 실제 지급된 분배금 ${miss.length}건이 기록에 없음`,
        cause: miss
          .slice(0, 5)
          .map((m) => `${m.symbol} 배당락 ${m.ex} 주당 $${m.perShare} × ${Math.round(m.shares * 10000) / 10000}주`)
          .join(" · ") + (miss.length > 5 ? " …" : ""),
        affects: ["분배금 합계", "현금", "총수익률"],
        fix: "실제로 받았다면 거래 입력·내역 아래 '기록하지 않은 분배금'에서 추가하세요.",
      });
  } else {
    // 간편 입력: 최초 매수일이 분할 전이고 평균 단가가 분할 전 기준으로 보이면 분할 반영 제안
    const hSus = detectUnadjustedHoldings(p.simple.holdings, input.series);
    if (hSus.length)
      items.push({
        key: `splith:${hSus.map((x) => x.id).join(",")}`,
        status: "check",
        title: `주식분할 전 기준으로 넣은 것으로 보이는 보유 종목 ${hSus.length}개`,
        cause: hSus.map((x) => `${x.symbol} 평균 단가 $${fmt(x.entered)} (최초 매수 ${x.date} 분할 반영 종가 $${fmt(x.close)}, 이후 분할 ${x.splits.map((s) => `${s.date} ${s.ratio}:1`).join(", ")})`).join(" · "),
        affects: ["보유 수량", "평가 수익률", "총수익률"],
        fix: "맞다면 아래 버튼으로 수량 × 분할 비율, 평균 단가 ÷ 분할 비율로 바꾸세요.",
        splitFix: hSus.map((x) => ({ kind: "holding" as const, id: x.id, factor: x.factor })),
      });
    const hSplit = new Set(hSus.map((x) => x.id));
    // 간편 입력: 평균 단가가 보유 기간 실제 가격 범위를 벗어나면 분할 전 가격·오타 가능성
    for (const h of p.simple.holdings) {
      if (!(h.shares > 0) || hSplit.has(h.id)) continue;
      const s = input.series[h.symbol];
      if (!s || !s.close.length) continue;
      const from = h.firstDate ?? s.dates[0];
      const xs = s.close.filter((_, i) => s.dates[i] >= from);
      if (!xs.length) continue;
      const hi = Math.max(...xs);
      const lo = Math.min(...xs);
      if (h.avgCost > hi * 1.3 || h.avgCost < lo * 0.7)
        items.push({
          key: `avg:${h.id}`,
          status: "check",
          title: "평균 매수 단가가 실제 가격 범위를 벗어남",
          cause: `${h.symbol} 평균 단가 $${fmt(h.avgCost)} — ${h.firstDate ? `${h.firstDate} 이후` : "기록된 전체 기간"} 실제 종가 범위 $${fmt(lo)}~$${fmt(hi)} (분할 반영)`,
          affects: ["평가 수익률", "총수익률", "세금 추정"],
          fix: "주식분할 전 단가를 넣었는지, 원화로 넣었는지 확인하세요.",
        });
    }
  }

  // 7) 시세 최신성
  if (input.quotesError) items.push({ key: "quotes:error", status: "missing", title: "시세를 불러오지 못함", cause: input.quotesError, affects: ["평가금액", "수익률", "비중"], fix: "잠시 뒤 다시 열어 보세요. 계속되면 데이터 상태 화면을 확인하세요." });
  else
    for (const sym of held) {
      const q = input.quotes.find((x) => x.symbol === sym);
      if (!q || q.time === null) items.push({ key: `quote:${sym}:none`, status: "missing", title: `${sym} 시세 없음`, cause: "수집된 시세가 없습니다.", affects: ["평가금액", "총자산", "비중"], fix: "지원 종목인지, 데이터 수집이 됐는지 확인하세요." });
      else if (now - q.time > input.staleQuoteMs)
        items.push({ key: `quote:${sym}:stale`, status: "stale", title: `${sym} 시세가 오래됨`, cause: `마지막 시세 ${new Date(q.time).toISOString().slice(0, 16).replace("T", " ")} UTC (${Math.round((now - q.time) / 86400000)}일 전) · ${q.source ?? "출처 미상"}`, affects: ["평가금액", "수익률"], fix: "최신 가격이 아닙니다. 데이터 수집 작업이 실행되면 갱신됩니다." });
    }
  // 8) 환율
  if (input.fx && held.length) {
    if (input.fx.time === null) items.push({ key: "fx:none", status: "missing", title: "원/달러 환율 없음", cause: "환율 시세가 수집되지 않았습니다.", affects: ["원화 기준 수익률", "원화 환산"], fix: "원화 기준 계산을 하지 않습니다." });
    else if (now - input.fx.time > input.staleQuoteMs) items.push({ key: "fx:stale", status: "stale", title: "원/달러 환율이 오래됨", cause: `${Math.round((now - input.fx.time) / 86400000)}일 전 환율`, affects: ["원화 기준 수익률", "원화 환산"], fix: "최신 환율이 아닙니다." });
  }
  // 9) 분배금 기록 최신성 / 일봉 유무
  for (const sym of held) {
    const s = input.series[sym];
    if (!s) items.push({ key: `series:${sym}`, status: "missing", title: `${sym} 일별 가격 기록 없음`, cause: "일봉·분배금 기록을 불러오지 못했습니다.", affects: ["성과 분석(TWR·XIRR)", "자산 추이", "데이터 점검의 가격 비교", "백테스트"], fix: "지원 종목인지, 데이터 수집이 됐는지 확인하세요." });
    const inc = input.income[sym];
    if (inc?.perYear && inc.latestEx) {
      const gapDays = (Date.parse(today) - Date.parse(inc.latestEx)) / 86400000;
      const expect = 365 / inc.perYear;
      if (gapDays > expect * 2 + 20)
        items.push({ key: `div:${sym}:${inc.latestEx}`, status: "stale", title: `${sym} 분배금 기록이 오래됨`, cause: `마지막 정기 배당락 ${inc.latestEx} (${Math.round(gapDays)}일 전), 보통 연 ${inc.perYear}회 지급`, affects: ["예상 분배금", "분배금 일정", "알림"], fix: "지급이 중단·변경됐거나 데이터 업데이트가 늦은 것일 수 있습니다. 운용사 공지를 확인하세요." });
    }
  }
  if (!items.length) items.push({ key: "ok", status: "ok", title: "찾은 문제 없음", cause: "점검한 항목에서 문제를 찾지 못했습니다.", affects: [], fix: "" });
  return items;
}
