/**
 * SEC EDGAR XBRL companyfacts (미국 증권거래위원회 공식 공개 데이터, 무료)
 * https://www.sec.gov/edgar/sec-api-documentation
 * - 요청 시 연락처가 포함된 User-Agent 헤더 필수 (SEC_USER_AGENT)
 * - 초당 10회 이하 호출
 */
import { env } from "../env";
import { ProviderError, requestJson } from "../http";

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
