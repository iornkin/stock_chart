/**
 * CSV 거래 내역·보유 종목 가져오기 (순수 함수, 브라우저 안에서만 처리)
 *
 * 1) parseCsv: 쉼표·세미콜론·탭 구분, 따옴표, BOM 처리
 * 2) guessMapping: 열 이름(한글·영문)으로 필드를 짐작 — 사용자가 바꿀 수 있다
 * 3) buildTxns: 행마다 검증해 거래 후보를 만들고 문제를 표시 (날짜·숫자·통화·종목·종류)
 * 4) 중복 검사: 이미 있는 거래나 파일 안에서 같은 거래(종류·날짜·종목·수량·가격·금액)를 찾아 기본으로 빼 둔다
 * 실제 반영은 사용자가 미리 보기를 확인한 뒤에만 한다.
 */
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import type { SimpleHolding, Txn, TxnType } from "./types";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

export type TxnField = "date" | "type" | "symbol" | "shares" | "price" | "amount" | "fee" | "tax" | "fx" | "currency" | "memo";
export type HoldingField = "symbol" | "shares" | "avgCost" | "firstDate" | "currency" | "memo";

export const TXN_FIELD_KO: Record<TxnField, string> = {
  date: "날짜",
  type: "거래 종류",
  symbol: "티커",
  shares: "수량",
  price: "단가",
  amount: "금액",
  fee: "수수료",
  tax: "세금",
  fx: "환율",
  currency: "통화",
  memo: "메모",
};
export const HOLDING_FIELD_KO: Record<HoldingField, string> = { symbol: "티커", shares: "수량", avgCost: "평균 단가", firstDate: "최초 매수일", currency: "통화", memo: "메모" };

const ALIASES: Record<string, string[]> = {
  date: ["date", "trade date", "거래일", "거래일자", "날짜", "일자", "체결일", "결제일"],
  type: ["type", "action", "transaction", "side", "거래종류", "거래 종류", "구분", "거래구분", "종류", "매매구분"],
  symbol: ["symbol", "ticker", "code", "티커", "종목", "종목코드", "종목명"],
  shares: ["shares", "quantity", "qty", "units", "수량", "주수", "체결수량"],
  price: ["price", "unit price", "단가", "가격", "체결가", "체결단가", "매입단가"],
  amount: ["amount", "total", "value", "금액", "거래금액", "입출금액", "분배금", "배당금"],
  fee: ["fee", "fees", "commission", "수수료"],
  tax: ["tax", "withholding", "세금", "원천징수", "세액"],
  fx: ["fx", "exchange rate", "rate", "환율"],
  currency: ["currency", "ccy", "통화"],
  memo: ["memo", "note", "notes", "description", "메모", "비고", "적요"],
  avgCost: ["avg cost", "average cost", "cost basis", "avgcost", "평균단가", "평균 단가", "매입가", "평균매입가"],
  firstDate: ["first date", "acquired", "매수일", "최초매수일", "최초 매수일"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()]/g, "");

/** 열 이름 → 필드 짐작 (모르면 null) */
export function guessMapping<F extends string>(headers: string[], fields: F[]): Record<F, number | null> {
  const out = Object.fromEntries(fields.map((f) => [f, null])) as Record<F, number | null>;
  const used = new Set<number>();
  for (const f of fields) {
    const al = (ALIASES[f] ?? [f]).map(norm);
    const i = headers.findIndex((h, k) => !used.has(k) && al.includes(norm(h)));
    if (i >= 0) {
      out[f] = i;
      used.add(i);
    }
  }
  return out;
}

const TYPE_WORDS: [TxnType, string[]][] = [
  ["reinvest", ["reinvest", "drip", "재투자", "분배금재투자", "배당재투자"]],
  ["dividend", ["dividend", "div", "distribution", "배당", "분배", "배당금", "분배금", "배당입금", "분배금입금"]],
  ["buy", ["buy", "bought", "purchase", "매수", "매입", "구매"]],
  ["sell", ["sell", "sold", "매도", "판매"]],
  ["deposit", ["deposit", "transfer in", "입금", "입고", "이체입금"]],
  ["withdraw", ["withdraw", "withdrawal", "transfer out", "출금", "출고", "이체출금"]],
  ["opening", ["opening", "기초", "기초보유", "기존보유"]],
];

export function parseType(s: string): TxnType | null {
  const n = norm(s);
  if (!n) return null;
  for (const [t, words] of TYPE_WORDS) if (words.some((w) => n === norm(w))) return t;
  for (const [t, words] of TYPE_WORDS) if (words.some((w) => norm(w).length >= 2 && n.includes(norm(w)))) return t;
  return null;
}

export function parseDate(s: string): string | null {
  const v = s.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(v);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v); // 미국식 MM/DD/YYYY
  if (m) return valid(+m[3], +m[1], +m[2]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return valid(+m[1], +m[2], +m[3]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "$1,234.50" "(12.3)" "-5" → 숫자. 비어 있으면 undefined, 못 읽으면 NaN */
export function parseNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const v = s.trim();
  if (!v) return undefined;
  const neg = /^\(.*\)$/.test(v);
  const n = Number(v.replace(/[(),$\s]|USD|US\$/gi, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

export interface ImportRow {
  line: number;
  raw: string[];
  txn: Txn | null;
  problems: string[];
  /** 기존 기록이나 파일의 앞 행과 같은 거래 */
  duplicate: "existing" | "file" | null;
  /** 가져올지 (기본: 문제·중복이 없으면 true) */
  include: boolean;
}

export const txnKey = (t: Pick<Txn, "type" | "date" | "symbol" | "shares" | "price" | "amount">) => [t.type, t.date, t.symbol ?? "", t.shares ?? "", t.price ?? "", t.amount ?? ""].join("|");

export function buildTxns(rows: string[][], map: Record<TxnField, number | null>, existing: Txn[], opts: { today: string; batch: string; now: number }): ImportRow[] {
  const have = new Set(existing.map(txnKey));
  const seen = new Set<string>();
  return rows.map((raw, i) => {
    const get = (f: TxnField) => (map[f] === null ? undefined : raw[map[f] as number]);
    const problems: string[] = [];
    const date = parseDate(get("date") ?? "");
    if (!date) problems.push(`날짜를 읽을 수 없음 (${get("date") ?? "없음"})`);
    else if (date > opts.today) problems.push("미래 날짜");
    const type = parseType(get("type") ?? "");
    if (!type) problems.push(`지원하지 않는 거래 종류 (${get("type") || "없음"})`);
    const cur = (get("currency") ?? "").trim().toUpperCase();
    if (cur && cur !== "USD" && cur !== "US$" && cur !== "$" && cur !== "달러") problems.push(`달러가 아닌 통화 (${cur}) — 달러 금액으로 바꿔 넣으세요`);
    const symRaw = get("symbol") ?? "";
    const symbol = symRaw ? normalizeSymbol(symRaw) : undefined;
    const needSym = type !== null && type !== "deposit" && type !== "withdraw";
    if (needSym && !symbol) problems.push("티커 없음");
    else if (needSym && symbol && !getInstrument(symbol)) problems.push(`지원하지 않는 종목 (${symbol})`);
    const num = (f: TxnField) => {
      const v = parseNumber(get(f));
      if (v !== undefined && Number.isNaN(v)) problems.push(`${TXN_FIELD_KO[f]} 숫자를 읽을 수 없음 (${get(f)})`);
      return v !== undefined && !Number.isNaN(v) ? Math.abs(v) : undefined;
    };
    const shares = num("shares");
    const price = num("price");
    let amount = num("amount");
    const fee = num("fee");
    const tax = num("tax");
    const fx = num("fx");
    if (type === "buy" || type === "sell" || type === "opening") {
      if (!(shares && shares > 0)) problems.push("수량 없음");
      if (!(price && price > 0)) problems.push("단가 없음");
      if (shares && price && amount && Math.abs(shares * price - amount) > Math.max(1, amount * 0.02) && Math.abs(shares * price + (fee ?? 0) - amount) > Math.max(1, amount * 0.02) && Math.abs(shares * price - (fee ?? 0) - amount) > Math.max(1, amount * 0.02))
        problems.push(`수량 × 단가(${(shares * price).toFixed(2)})와 금액(${amount.toFixed(2)})이 맞지 않음`);
      amount = undefined;
    }
    if ((type === "deposit" || type === "withdraw" || type === "dividend") && !(amount && amount > 0)) problems.push("금액 없음");
    if (type === "reinvest") {
      if (!(amount && amount > 0)) problems.push("분배금 금액 없음");
      if (!(shares && shares > 0) || !(price && price > 0)) problems.push("재투자 수량·단가 없음");
    }
    if (tax !== undefined && amount !== undefined && tax > amount) problems.push("세금이 금액보다 큼");
    let txn: Txn | null = null;
    if (!problems.length && date && type) {
      txn = {
        id: `csv-${opts.batch}-${i}`,
        type,
        date,
        ...(needSym ? { symbol } : {}),
        ...(shares !== undefined && (type === "buy" || type === "sell" || type === "opening" || type === "reinvest") ? { shares } : {}),
        ...(price !== undefined && (type === "buy" || type === "sell" || type === "opening" || type === "reinvest") ? { price } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(fee !== undefined && (type === "buy" || type === "sell") ? { fee } : {}),
        ...(tax !== undefined && (type === "dividend" || type === "reinvest") ? { tax } : {}),
        ...(fx !== undefined && fx > 0 ? { fx } : {}),
        memo: [get("memo"), `CSV 가져오기 ${opts.batch}`].filter(Boolean).join(" · "),
        importBatch: opts.batch,
        createdAt: opts.now + i,
      };
    }
    let duplicate: ImportRow["duplicate"] = null;
    if (txn) {
      const k = txnKey(txn);
      if (have.has(k)) duplicate = "existing";
      else if (seen.has(k)) duplicate = "file";
      seen.add(k);
    }
    return { line: i + 2, raw, txn, problems, duplicate, include: !!txn && !duplicate };
  });
}

export interface HoldingRow {
  line: number;
  holding: SimpleHolding | null;
  problems: string[];
  /** 이미 같은 종목이 있음 (가져오면 덮어씀) */
  replaces: boolean;
  include: boolean;
}

export function buildHoldings(rows: string[][], map: Record<HoldingField, number | null>, existing: SimpleHolding[], opts: { today: string; batch: string }): HoldingRow[] {
  const seen = new Set<string>();
  return rows.map((raw, i) => {
    const get = (f: HoldingField) => (map[f] === null ? undefined : raw[map[f] as number]);
    const problems: string[] = [];
    const symbol = normalizeSymbol(get("symbol") ?? "");
    if (!symbol) problems.push("티커 없음");
    else if (!getInstrument(symbol)) problems.push(`지원하지 않는 종목 (${symbol})`);
    else if (seen.has(symbol)) problems.push("파일 안에서 같은 종목이 두 번 나옴");
    seen.add(symbol);
    const cur = (get("currency") ?? "").trim().toUpperCase();
    if (cur && cur !== "USD" && cur !== "$") problems.push(`달러가 아닌 통화 (${cur})`);
    const shares = parseNumber(get("shares"));
    const avg = parseNumber(get("avgCost"));
    if (!(shares !== undefined && shares > 0)) problems.push("수량 없음");
    if (!(avg !== undefined && avg > 0)) problems.push("평균 단가 없음");
    const fdRaw = get("firstDate");
    const firstDate = fdRaw ? parseDate(fdRaw) : null;
    if (fdRaw && !firstDate) problems.push(`최초 매수일을 읽을 수 없음 (${fdRaw})`);
    if (firstDate && firstDate > opts.today) problems.push("최초 매수일이 미래");
    const holding: SimpleHolding | null = problems.length ? null : { id: `csvh-${opts.batch}-${i}`, symbol, shares: shares as number, avgCost: avg as number, ...(firstDate ? { firstDate } : {}), ...(get("memo") ? { memo: get("memo") } : {}) };
    return { line: i + 2, holding, problems, replaces: !!holding && existing.some((h) => h.symbol === symbol), include: !!holding };
  });
}
