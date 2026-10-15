/**
 * 포지션·심리 분석 설정
 *
 * CUSIP (13F 공시의 종목 식별 번호 → 이 사이트의 티커)
 * - SEC 공식 13(f) 증권 목록(2026년 3분기)에서 후보를 찾고,
 *   Morgan Stanley·BlackRock·JPMorgan 의 2026-06-30 13F 에서 '신고 가치 ÷ 수량'이 그날 실제 종가와 일치(오차 0.1% 이내)하는 것만 넣었다.
 * - SPXL 은 일치하는 CUSIP 을 확인하지 못해 넣지 않았다 (기관 보유 현황을 '매핑 없음'으로 표시).
 */
export const CUSIPS: Record<string, string> = {
  AAPL: "037833100",
  MSFT: "594918104",
  NVDA: "67066G104",
  AMZN: "023135106",
  GOOGL: "02079K305",
  GOOG: "02079K107",
  META: "30303M102",
  TSLA: "88160R101",
  QQQ: "46090E103",
  QQQM: "46138G649",
  VOO: "922908363",
  SPY: "78462F103",
  IVV: "464287200",
  SPYM: "78464A854",
  VTI: "922908769",
  SCHG: "808524300",
  VUG: "922908736",
  TQQQ: "74347X831",
  QLD: "74347R206",
  UPRO: "74347X864",
  SSO: "74347R107",
  SOXL: "25459W458",
  DGRO: "46434V621",
  SCHD: "808524797",
  VIG: "921908844",
  VYM: "921946406",
  HDV: "46429B663",
  NOBL: "74348A467",
  FDVV: "316092840",
  DGRW: "97717X669",
  SPYD: "78468R788",
  JEPI: "46641Q332",
  JEPQ: "46654Q203",
  DIVO: "032108409",
  QYLD: "37954Y483",
  XYLD: "37954Y475",
  RYLD: "37954Y459",
  SPYI: "78433H303",
  QQQI: "78433H675",
  GPIQ: "38149W630",
  GPIX: "38149W622",
  GLD: "78463V107",
  IAU: "464285204",
  GLDM: "98149E303",
  SMH: "92189F676",
  SOXX: "464287523",
  XLK: "81369Y803",
};

export type InstitutionGroup = "운용사·연기금" | "은행·증권" | "헤지펀드·투자회사" | "지주회사";

/**
 * 13F 보유 현황을 추적하는 기관 (SEC EDGAR CIK — 이름은 화면에 SEC 가 보고한 이름을 그대로 쓴다)
 * 미국 기관 전체가 아니라 이 사이트가 고른 일부다. 13F 는 운용자산 1억 달러 이상 기관의 분기 말 미국 상장 주식 등 '롱' 보유만 보고한다.
 */
export const INSTITUTIONS: { cik: number; group: InstitutionGroup }[] = [
  { cik: 2012383, group: "운용사·연기금" }, // BlackRock, Inc.
  { cik: 102909, group: "운용사·연기금" }, // Vanguard Group
  { cik: 93751, group: "운용사·연기금" }, // State Street
  { cik: 315066, group: "운용사·연기금" }, // FMR (Fidelity)
  { cik: 1214717, group: "운용사·연기금" }, // Geode Capital Management
  { cik: 1374170, group: "운용사·연기금" }, // Norges Bank
  { cik: 1697748, group: "운용사·연기금" }, // ARK Investment Management
  { cik: 19617, group: "은행·증권" }, // JPMorgan Chase
  { cik: 895421, group: "은행·증권" }, // Morgan Stanley
  { cik: 886982, group: "은행·증권" }, // Goldman Sachs Group
  { cik: 1067983, group: "지주회사" }, // Berkshire Hathaway
  { cik: 1350694, group: "헤지펀드·투자회사" }, // Bridgewater
  { cik: 1037389, group: "헤지펀드·투자회사" }, // Renaissance Technologies
  { cik: 1423053, group: "헤지펀드·투자회사" }, // Citadel Advisors
  { cik: 1179392, group: "헤지펀드·투자회사" }, // Two Sigma Investments
  { cik: 1167483, group: "헤지펀드·투자회사" }, // Tiger Global
  { cik: 1029160, group: "헤지펀드·투자회사" }, // Soros Fund Management
  { cik: 1536411, group: "헤지펀드·투자회사" }, // Duquesne Family Office
  { cik: 1656456, group: "헤지펀드·투자회사" }, // Appaloosa
  { cik: 1336528, group: "헤지펀드·투자회사" }, // Pershing Square
];

/** 지표별 '오래된 데이터' 기준 (일) — 갱신 주기와 공표 지연을 감안 */
export const STALE_DAYS = {
  sentiment: 14, // 주 1회 (목요일 공표)
  shortInterest: 40, // 월 2회 결제일 기준, 약 8영업일 뒤 공표
  shortVolume: 7, // 매 거래일
  options: 7, // 매 거래일 (장 마감 후 수집)
  marketOptions: 7,
  thirteenF: 200, // 분기 말 + 45일 이내 제출 → 다음 분기 공시 전까지 쓰임
};
