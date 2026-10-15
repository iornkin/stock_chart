/**
 * SEC EDGAR XBRL companyfacts (미국 증권거래위원회 공식 공개 데이터, 무료)
 * https://www.sec.gov/edgar/sec-api-documentation
 * - 요청 시 연락처가 포함된 User-Agent 헤더 필수 (SEC_USER_AGENT)
 * - 초당 10회 이하 호출
 */
import { env } from "../env";
import { ProviderError, requestJson, requestText } from "../http";

const P = "sec";

export function secEnabled() {
  return Boolean(env.secUserAgent);
}

/** HTTP 헤더에 넣을 수 있는 한 줄짜리 값인지 (값 자체는 오류 문구에 넣지 않는다) */
function validUserAgent(ua: string) {
  return /^[\x20-\x7E]{5,200}$/.test(ua);
}

export interface SecFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units?: Record<string, SecFact[]> }>>;
}

export async function fetchCompanyFacts(cik: string): Promise<CompanyFacts> {
  if (!secEnabled()) throw new ProviderError(P, "SEC_USER_AGENT 미설정 (예: 'MyStockSite contact@example.com')");
  if (!validUserAgent(env.secUserAgent)) {
    throw new ProviderError(P, "SEC_USER_AGENT 형식 오류 — 영문·숫자로 된 한 줄만 넣어야 합니다 (예: 'MyStockSite contact@example.com'). 다른 키를 함께 넣지 마세요.");
  }
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  return requestJson<CompanyFacts>(P, `${env.secBase}/api/xbrl/companyfacts/CIK${padded}.json`, {
    headers: { "User-Agent": env.secUserAgent, "Accept-Encoding": "gzip, deflate" },
    timeoutMs: 60000,
  });
}

export interface SecFiling {
  form: string;
  filingDate: string;
  reportDate: string | null;
  description: string | null;
  url: string;
}

interface Submissions {
  cik?: string | number;
  filings?: { recent?: { form?: string[]; filingDate?: string[]; reportDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; primaryDocDescription?: string[] } };
}

/** 최근 주요 공시 목록 (10-K·10-Q·8-K·주주총회 위임장) — SEC EDGAR submissions */
export async function fetchRecentFilings(cik: string, limit = 20): Promise<SecFiling[]> {
  if (!secEnabled()) throw new ProviderError(P, "SEC_USER_AGENT 미설정");
  if (!validUserAgent(env.secUserAgent)) throw new ProviderError(P, "SEC_USER_AGENT 형식 오류");
  const digits = cik.replace(/\D/g, "");
  const j = await requestJson<Submissions>(P, `${env.secBase}/submissions/CIK${digits.padStart(10, "0")}.json`, {
    headers: { "User-Agent": env.secUserAgent, "Accept-Encoding": "gzip, deflate" },
    timeoutMs: 30000,
  });
  const r = j.filings?.recent;
  if (!r?.form) throw new ProviderError(P, "공시 목록 형식이 예상과 다릅니다");
  const keep = new Set(["10-K", "10-Q", "8-K", "DEF 14A", "10-K/A", "10-Q/A", "8-K/A"]);
  const out: SecFiling[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    if (!keep.has(r.form[i])) continue;
    const acc = (r.accessionNumber?.[i] ?? "").replace(/-/g, "");
    const doc = r.primaryDocument?.[i] ?? "";
    out.push({
      form: r.form[i],
      filingDate: r.filingDate?.[i] ?? "",
      reportDate: r.reportDate?.[i] || null,
      description: r.primaryDocDescription?.[i] || null,
      url: acc && doc ? `https://www.sec.gov/Archives/edgar/data/${Number(digits)}/${acc}/${doc}` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${digits}`,
    });
  }
  return out;
}

// ───────────────────────────── 13F (기관 투자자 분기 보유 공시) ─────────────────────────────

export interface ThirteenFFiling {
  accession: string;
  form: "13F-HR" | "13F-HR/A";
  /** 보고 기간 말일 (분기 말) */
  period: string;
  /** 제출일 */
  filed: string;
}

/** 기관의 13F 제출 목록 (최근 것부터) + SEC 에 등록된 이름 */
export async function fetch13fFilings(cik: number): Promise<{ name: string; filings: ThirteenFFiling[] }> {
  if (!secEnabled()) throw new ProviderError(P, "SEC_USER_AGENT 미설정");
  if (!validUserAgent(env.secUserAgent)) throw new ProviderError(P, "SEC_USER_AGENT 형식 오류");
  const j = await requestJson<Submissions & { name?: string }>(P, `${env.secBase}/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
    headers: { "User-Agent": env.secUserAgent, "Accept-Encoding": "gzip, deflate" },
    timeoutMs: 30000,
  });
  const r = j.filings?.recent;
  if (!r?.form) throw new ProviderError(P, "공시 목록 형식이 예상과 다릅니다");
  const filings: ThirteenFFiling[] = [];
  for (let i = 0; i < r.form.length; i++) {
    const form = r.form[i];
    if (form !== "13F-HR" && form !== "13F-HR/A") continue;
    const period = r.reportDate?.[i] ?? "";
    const filed = r.filingDate?.[i] ?? "";
    const accession = r.accessionNumber?.[i] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(filed) || !accession) continue;
    filings.push({ accession, form, period, filed });
  }
  return { name: typeof j.name === "string" && j.name.trim() ? j.name.trim() : `CIK ${cik}`, filings };
}

export interface ThirteenFRow {
  issuer: string;
  title: string;
  cusip: string;
  /** 달러 (2023-01-03 이전 제출분은 천 달러 단위였으므로 호출 측에서 보정) */
  value: number;
  shares: number;
  /** SH(주식) / PRN(채권 원금) */
  shType: string;
  /** '' = 보유 주식, PUT/CALL = 옵션 (기초자산 기준 수량) */
  putCall: "" | "PUT" | "CALL";
}

const xmlTag = (b: string, t: string) => new RegExp(`<(?:\\w+:)?${t}>([^<]*)</(?:\\w+:)?${t}>`).exec(b)?.[1]?.trim() ?? "";
const unescapeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** 정보 표(XML) → 행. CUSIP·수량·가치가 올바르지 않은 행은 버린다 */
export function parse13fInfoTable(xml: string): ThirteenFRow[] {
  const out: ThirteenFRow[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
    const b = m[1];
    const cusip = xmlTag(b, "cusip").toUpperCase();
    const value = Number(xmlTag(b, "value").replace(/,/g, ""));
    const shares = Number(xmlTag(b, "sshPrnamt").replace(/,/g, ""));
    const pc = xmlTag(b, "putCall").toUpperCase();
    if (!/^[0-9A-Z]{9}$/.test(cusip) || !Number.isFinite(value) || !Number.isFinite(shares) || value < 0 || shares < 0) continue;
    out.push({ issuer: unescapeXml(xmlTag(b, "nameOfIssuer")), title: unescapeXml(xmlTag(b, "titleOfClass")), cusip, value, shares, shType: xmlTag(b, "sshPrnamtType").toUpperCase(), putCall: pc === "PUT" || pc === "CALL" ? pc : "" });
  }
  return out;
}

export interface ThirteenFCover {
  period: string | null;
  isAmendment: boolean;
  /** RESTATEMENT(전체 대체) / NEW HOLDINGS(추가 보고) */
  amendmentType: string | null;
  tableValueTotal: number | null;
  entryTotal: number | null;
}

/** primary_doc.xml (표지) */
export function parse13fCover(xml: string): ThirteenFCover {
  const p = xmlTag(xml, "periodOfReport") || xmlTag(xml, "reportCalendarOrQuarter");
  const m = p.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const num = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
  return {
    period: m ? `${m[3]}-${m[1]}-${m[2]}` : null,
    isAmendment: xmlTag(xml, "isAmendment").toLowerCase() === "true",
    amendmentType: xmlTag(xml, "amendmentType").toUpperCase() || null,
    tableValueTotal: num(xmlTag(xml, "tableValueTotal")),
    entryTotal: num(xmlTag(xml, "tableEntryTotal")),
  };
}

/** 제출 묶음의 표지와 정보 표 (www.sec.gov/Archives) */
export async function fetch13fDocuments(cik: number, accession: string): Promise<{ cover: ThirteenFCover; rows: ThirteenFRow[] }> {
  const dir = `${env.secWwwBase}/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  const headers = { "User-Agent": env.secUserAgent, "Accept-Encoding": "gzip, deflate" };
  const idx = await requestJson<{ directory?: { item?: { name: string }[] } }>(P, `${dir}/index.json`, { headers, timeoutMs: 30000 });
  const items = idx.directory?.item ?? [];
  const xmls = items.filter((x) => /\.xml$/i.test(x.name));
  const coverName = xmls.find((x) => /primary_doc\.xml$/i.test(x.name))?.name;
  const tableName = xmls.find((x) => !/primary_doc\.xml$/i.test(x.name))?.name;
  if (!tableName) throw new ProviderError(P, `13F 정보 표 파일이 없습니다 (${accession})`);
  const cover = coverName ? parse13fCover(await requestText(P, `${dir}/${coverName}`, { headers, timeoutMs: 30000 })) : { period: null, isAmendment: false, amendmentType: null, tableValueTotal: null, entryTotal: null };
  const rows = parse13fInfoTable(await requestText(P, `${dir}/${tableName}`, { headers, timeoutMs: 120000 }));
  return { cover, rows };
}
