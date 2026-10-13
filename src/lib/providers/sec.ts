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
