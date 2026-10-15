/**
 * FINRA 공개 데이터 (무료, 인증 불필요)
 * 1) 공매도 잔고 (Consolidated Short Interest) — api.finra.org, 월 2회 결제일 기준, 약 8영업일 뒤 공표.
 *    거래소 상장 종목 전체(NYSE·Nasdaq·Arca 등)의 회원사 보고 공매도 잔고. 최근 1년치만 온라인 제공.
 * 2) 일일 공매도 거래량 (Reg SHO Daily Short Sale Volume) — cdn.finra.org, 매 거래일 오후 6시(ET)까지 게시.
 *    FINRA 장외 보고 시설(TRF·ADF)에 보고된 거래만 포함하며 거래소에서 체결된 거래는 들어 있지 않다.
 *    → '공매도 잔고'(보유 중인 숏 포지션)와 '공매도 거래량'(그날 새로 판 공매도 거래)은 서로 다른 지표다.
 */
import { env } from "../env";
import { ProviderError, request, requestText } from "../http";

const P = "finra";

export interface ShortInterestRow {
  symbol: string;
  settlementDate: string;
  shortQty: number;
  prevQty: number | null;
  /** FINRA 평균 일일 거래량 (미디어 보고 거래 기준) */
  avgDailyVolume: number | null;
  /** FINRA 가 계산한 Days to Cover (반올림·최소 1로 보이는 값이 있어 화면에서는 직접 계산값을 쓴다) */
  daysToCoverReported: number | null;
  changePct: number | null;
  /** 직전 결제일 수치가 정정됨 */
  revised: boolean;
  /** 이번 주기에 주식분할 */
  split: boolean;
  issueName: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const isoDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** consolidatedShortInterest 응답 → 행. 수량이 숫자가 아니거나 음수면 버린다(0으로 채우지 않음) */
export function parseShortInterest(json: unknown): ShortInterestRow[] {
  if (!Array.isArray(json)) throw new ProviderError(P, "공매도 잔고 응답 형식이 예상과 다릅니다");
  const out: ShortInterestRow[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const symbol = typeof r.symbolCode === "string" ? r.symbolCode.trim().toUpperCase() : "";
    const date = isoDate(r.settlementDate);
    const qty = num(r.currentShortPositionQuantity);
    if (!symbol || !date || qty === null || qty < 0) continue;
    const prev = num(r.previousShortPositionQuantity);
    const adv = num(r.averageDailyVolumeQuantity);
    const dtc = num(r.daysToCoverQuantity);
    out.push({
      symbol,
      settlementDate: date,
      shortQty: qty,
      prevQty: prev !== null && prev >= 0 ? prev : null,
      // FINRA 는 값이 없으면 0 을 넣는다 → 0 은 '없음'으로 본다
      avgDailyVolume: adv !== null && adv > 0 ? adv : null,
      daysToCoverReported: dtc !== null && dtc > 0 ? dtc : null,
      changePct: num(r.changePercent),
      revised: r.revisionFlag === "R",
      split: r.stockSplitFlag === "S",
      issueName: typeof r.issueName === "string" ? r.issueName : null,
    });
  }
  return out;
}

/** 여러 종목의 결제일 범위 공매도 잔고 (한 번에, 5000건씩 나눠 받음) */
export async function fetchShortInterest(symbols: string[], startDate: string, endDate: string): Promise<ShortInterestRow[]> {
  const out: ShortInterestRow[] = [];
  const limit = 5000;
  for (let offset = 0; offset < 50_000; offset += limit) {
    const res = await request(P, `${env.finraApiBase}/data/group/otcMarket/name/consolidatedShortInterest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        limit,
        offset,
        domainFilters: [{ fieldName: "symbolCode", values: symbols }],
        dateRangeFilters: [{ fieldName: "settlementDate", startDate, endDate }],
      }),
      timeoutMs: 45000,
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(P, `HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
    // 결과가 없으면 빈 본문(204)일 수 있다
    const rows = text.trim() ? parseShortInterest(JSON.parse(text)) : [];
    out.push(...rows);
    const total = Number(res.headers.get("record-total"));
    if (!Number.isFinite(total) || offset + limit >= total || rows.length === 0) break;
  }
  return out;
}

export interface ShortVolumeRow {
  symbol: string;
  date: string;
  shortVolume: number;
  shortExemptVolume: number | null;
  totalVolume: number;
  markets: string | null;
}

/**
 * Reg SHO 일일 파일(파이프 구분): Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market, 마지막 줄은 건수.
 * 거래량이 숫자가 아니거나 음수, 공매도 > 전체(파일 오류)인 행은 버린다.
 */
export function parseShortVolumeFile(text: string, want?: Set<string>): { date: string | null; rows: ShortVolumeRow[]; declared: number | null } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length || !/^Date\|Symbol\|ShortVolume\|ShortExemptVolume\|TotalVolume\|Market/i.test(lines[0])) {
    throw new ProviderError(P, "공매도 거래량 파일 형식이 예상과 다릅니다");
  }
  const rows: ShortVolumeRow[] = [];
  let date: string | null = null;
  let declared: number | null = null;
  for (const line of lines.slice(1)) {
    const f = line.split("|");
    if (f.length === 1 && /^\d+$/.test(f[0].trim())) {
      declared = Number(f[0]);
      continue;
    }
    if (f.length < 5) continue;
    const m = f[0].trim().match(/^(\d{4})(\d{2})(\d{2})$/);
    const symbol = f[1].trim().toUpperCase();
    if (!m || !symbol) continue;
    if (want && !want.has(symbol)) continue;
    const sv = Number(f[2]);
    const ex = f[3].trim() === "" ? null : Number(f[3]);
    const tv = Number(f[4]);
    if (!Number.isFinite(sv) || !Number.isFinite(tv) || sv < 0 || tv < 0 || sv > tv * 1.000001) continue;
    const d = `${m[1]}-${m[2]}-${m[3]}`;
    date ??= d;
    rows.push({ symbol, date: d, shortVolume: sv, shortExemptVolume: ex !== null && Number.isFinite(ex) && ex >= 0 ? ex : null, totalVolume: tv, markets: f[5]?.trim() || null });
  }
  return { date, rows, declared };
}

/** 해당 거래일 파일. 아직 게시 전·휴장일이면 null */
export async function fetchShortVolumeFile(date: string): Promise<string | null> {
  const ymd = date.replace(/-/g, "");
  try {
    return await requestText(P, `${env.finraCdnBase}/equity/regsho/daily/CNMSshvol${ymd}.txt`, { retries: 1, timeoutMs: 45000 });
  } catch (e) {
    if (e instanceof ProviderError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}
