/**
 * 지원 종목 설정 파일
 * ---------------------------------------------------------------------------
 * 사이트에서 다루는 모든 종목(미국 주식·미국 상장 ETF)은 이 파일 하나로 관리한다.
 * - 종목을 추가하려면 INSTRUMENTS 배열에 항목을 하나 추가하면 된다.
 * - 종목을 제거하려면 해당 항목을 삭제하면 된다. (DB 에 남은 과거 데이터는 표시되지 않는다)
 * - core: true 인 종목은 대시보드 "핵심 종목"과 브리핑 목록 상단에 표시된다.
 *
 * 여기 적는 정보는 운용사가 공시한 "상품 구조"에 관한 정성적 정보(추종 지수, 레버리지 배수,
 * 운용 전략 요약)만 담는다. 가격·총보수·운용자산·편입 종목·분배금 같은 수치는 절대 여기에
 * 하드코딩하지 않고 데이터 제공처(API)에서 수집한다. API 가 제공하지 않으면 화면에
 * "데이터 미제공"으로 표시된다.
 */

export type InstrumentKind = "stock" | "etf";

export type Category =
  | "m7"
  | "index"
  | "leveraged"
  | "dividend_growth"
  | "income"
  | "gold"
  | "semis_tech";

export type EtfStrategy =
  | "index"
  | "leveraged"
  | "covered_call_index" // 지수 바이라이트(커버드콜) 규칙 기반
  | "option_income_active" // 액티브 옵션 인컴 (ELN, 지수옵션 등)
  | "dividend"
  | "physical_gold"
  | "sector";

export interface InstrumentConfig {
  symbol: string;
  /** 영문 공식 명칭(대체 표기용). 실제 화면에는 데이터 제공처의 최신 명칭을 우선 사용한다. */
  name: string;
  /** 한국어 표시명 */
  nameKo: string;
  kind: InstrumentKind;
  category: Category;
  core?: boolean;
  /** 상장 거래소(대체 표기용) */
  exchange?: string;
  issuer?: string;
  /** 운용사/기업 공식 페이지 */
  officialUrl?: string;
  /** SEC CIK (개별 기업 재무제표 수집용) */
  cik?: string;
  /** 추종 지수 또는 기초자산 (운용사 공시 기준의 정성 정보) */
  underlying?: string;
  /** 레버리지 ETF 의 일일 목표 배수 */
  leverage?: number;
  strategy?: EtfStrategy;
  /** 운용 전략 요약 (운용사 공시 내용을 요약한 정성 정보) */
  strategyNote?: string;
  /** 브리핑에서 비교할 기준 지수/종목 (첫 번째가 주 기준) */
  benchmarks?: string[];
  /** 뉴스 검색어 (티커 검색 외 추가) */
  newsQueries?: string[];
  /** 과거 티커 */
  formerSymbols?: string[];
  /** 비교 페이지 추천 짝 */
  peers?: string[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  m7: "M7 대형 기술주",
  index: "미국 대표 지수 ETF",
  leveraged: "레버리지 ETF",
  dividend_growth: "배당 성장 ETF",
  income: "월분배금·인컴 ETF",
  gold: "금 ETF",
  semis_tech: "반도체·기술주 ETF",
};

export const CATEGORY_ORDER: Category[] = [
  "m7",
  "index",
  "leveraged",
  "dividend_growth",
  "income",
  "gold",
  "semis_tech",
];

export const INSTRUMENTS: InstrumentConfig[] = [
  // ───────────────────────── A. M7 대형 기술주 ─────────────────────────
  {
    symbol: "AAPL", name: "Apple Inc.", nameKo: "애플", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0000320193", officialUrl: "https://investor.apple.com/",
    benchmarks: ["QQQ", "^NDX"], peers: ["MSFT", "QQQ"], newsQueries: ["Apple"],
  },
  {
    symbol: "MSFT", name: "Microsoft Corporation", nameKo: "마이크로소프트", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0000789019", officialUrl: "https://www.microsoft.com/en-us/investor",
    benchmarks: ["QQQ", "^NDX"], peers: ["AAPL", "GOOGL"], newsQueries: ["Microsoft"],
  },
  {
    symbol: "NVDA", name: "NVIDIA Corporation", nameKo: "엔비디아", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0001045810", officialUrl: "https://investor.nvidia.com/",
    benchmarks: ["SMH", "QQQ"], peers: ["SMH", "SOXX"], newsQueries: ["Nvidia"],
  },
  {
    symbol: "AMZN", name: "Amazon.com, Inc.", nameKo: "아마존", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0001018724", officialUrl: "https://ir.aboutamazon.com/",
    benchmarks: ["QQQ", "^NDX"], peers: ["MSFT", "GOOGL"], newsQueries: ["Amazon"],
  },
  {
    symbol: "GOOGL", name: "Alphabet Inc. Class A", nameKo: "알파벳 A", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0001652044", officialUrl: "https://abc.xyz/investor/",
    benchmarks: ["QQQ", "^NDX"], peers: ["META", "MSFT"], newsQueries: ["Alphabet Google"],
  },
  {
    symbol: "GOOG", name: "Alphabet Inc. Class C", nameKo: "알파벳 C", kind: "stock", category: "m7",
    exchange: "NASDAQ", cik: "0001652044", officialUrl: "https://abc.xyz/investor/",
    benchmarks: ["QQQ", "^NDX"], peers: ["GOOGL", "META"], newsQueries: ["Alphabet Google"],
  },
  {
    symbol: "META", name: "Meta Platforms, Inc.", nameKo: "메타 플랫폼스", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0001326801", officialUrl: "https://investor.atmeta.com/",
    benchmarks: ["QQQ", "^NDX"], peers: ["GOOGL", "AMZN"], newsQueries: ["Meta Platforms"],
  },
  {
    symbol: "TSLA", name: "Tesla, Inc.", nameKo: "테슬라", kind: "stock", category: "m7", core: true,
    exchange: "NASDAQ", cik: "0001318605", officialUrl: "https://ir.tesla.com/",
    benchmarks: ["QQQ", "^NDX"], peers: ["NVDA", "QQQ"], newsQueries: ["Tesla"],
  },

  // ───────────────────────── B. 미국 대표 지수 ETF ─────────────────────────
  {
    symbol: "QQQ", name: "Invesco QQQ Trust, Series 1", nameKo: "인베스코 QQQ", kind: "etf", category: "index", core: true,
    issuer: "Invesco", officialUrl: "https://www.invesco.com/qqq-etf/en/home.html",
    underlying: "Nasdaq-100 Index", strategy: "index",
    strategyNote: "나스닥에 상장된 비금융 대형주 100개로 구성된 Nasdaq-100 지수를 추종하는 패시브 ETF(UIT 구조)입니다.",
    benchmarks: ["^NDX"], peers: ["VOO", "QQQM", "TQQQ"], newsQueries: ["Nasdaq 100"],
  },
  {
    symbol: "QQQM", name: "Invesco NASDAQ 100 ETF", nameKo: "인베스코 나스닥100 (QQQM)", kind: "etf", category: "index",
    issuer: "Invesco",
    underlying: "Nasdaq-100 Index", strategy: "index",
    strategyNote: "QQQ 와 동일한 Nasdaq-100 지수를 추종하는 패시브 ETF(오픈엔드 펀드 구조)입니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["QQQ"], newsQueries: ["Nasdaq 100"],
  },
  {
    symbol: "VOO", name: "Vanguard S&P 500 ETF", nameKo: "뱅가드 S&P 500", kind: "etf", category: "index", core: true,
    issuer: "Vanguard", officialUrl: "https://investor.vanguard.com/investment-products/etfs/profile/voo",
    underlying: "S&P 500 Index", strategy: "index",
    strategyNote: "미국 대형주 500개로 구성된 S&P 500 지수를 추종하는 패시브 ETF입니다.",
    benchmarks: ["^GSPC"], peers: ["SPY", "IVV", "QQQ"], newsQueries: ["S&P 500"],
  },
  {
    symbol: "SPY", name: "SPDR S&P 500 ETF Trust", nameKo: "SPDR S&P 500", kind: "etf", category: "index", core: true,
    issuer: "State Street", officialUrl: "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy",
    underlying: "S&P 500 Index", strategy: "index",
    strategyNote: "S&P 500 지수를 추종하는 최초의 미국 상장 ETF(UIT 구조)입니다.",
    benchmarks: ["^GSPC"], peers: ["VOO", "IVV"], newsQueries: ["S&P 500"],
  },
  {
    symbol: "IVV", name: "iShares Core S&P 500 ETF", nameKo: "아이셰어즈 코어 S&P 500", kind: "etf", category: "index",
    issuer: "BlackRock iShares", officialUrl: "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf",
    underlying: "S&P 500 Index", strategy: "index",
    strategyNote: "S&P 500 지수를 추종하는 패시브 ETF입니다.",
    benchmarks: ["^GSPC"], peers: ["VOO", "SPY"], newsQueries: ["S&P 500"],
  },
  {
    symbol: "SPYM", name: "State Street SPDR Portfolio S&P 500 ETF", nameKo: "SPDR 포트폴리오 S&P 500 (구 SPLG)", kind: "etf", category: "index",
    issuer: "State Street", formerSymbols: ["SPLG"],
    underlying: "S&P 500 Index", strategy: "index",
    strategyNote: "S&P 500 지수를 추종하는 패시브 ETF입니다. 2025-10-31 티커가 SPLG 에서 SPYM 으로 변경되었습니다(운용사 공지).",
    benchmarks: ["^GSPC"], peers: ["VOO", "SPY"], newsQueries: ["SPYM ETF"],
  },
  {
    symbol: "VTI", name: "Vanguard Total Stock Market ETF", nameKo: "뱅가드 토탈 스톡마켓", kind: "etf", category: "index",
    issuer: "Vanguard", officialUrl: "https://investor.vanguard.com/investment-products/etfs/profile/vti",
    underlying: "CRSP US Total Market Index", strategy: "index",
    strategyNote: "대형·중형·소형주를 포함한 미국 주식시장 전체를 대표하는 CRSP US Total Market 지수를 추종합니다.",
    benchmarks: ["^GSPC"], peers: ["VOO", "SPY"],
  },
  {
    symbol: "SCHG", name: "Schwab U.S. Large-Cap Growth ETF", nameKo: "슈왑 미국 대형 성장주", kind: "etf", category: "index",
    issuer: "Charles Schwab", officialUrl: "https://www.schwabassetmanagement.com/products/schg",
    underlying: "Dow Jones U.S. Large-Cap Growth Total Stock Market Index", strategy: "index",
    strategyNote: "미국 대형 성장주 지수를 추종하는 패시브 ETF입니다.",
    benchmarks: ["^GSPC", "QQQ"], peers: ["VUG", "QQQ"],
  },
  {
    symbol: "VUG", name: "Vanguard Growth ETF", nameKo: "뱅가드 성장주", kind: "etf", category: "index",
    issuer: "Vanguard", officialUrl: "https://investor.vanguard.com/investment-products/etfs/profile/vug",
    underlying: "CRSP US Large Cap Growth Index", strategy: "index",
    strategyNote: "미국 대형 성장주로 구성된 CRSP US Large Cap Growth 지수를 추종합니다.",
    benchmarks: ["^GSPC", "QQQ"], peers: ["SCHG", "QQQ"],
  },

  // ───────────────────────── C. 레버리지 ETF ─────────────────────────
  {
    symbol: "TQQQ", name: "ProShares UltraPro QQQ", nameKo: "프로셰어즈 울트라프로 QQQ (3배)", kind: "etf", category: "leveraged", core: true,
    issuer: "ProShares", officialUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq",
    underlying: "Nasdaq-100 Index", leverage: 3, strategy: "leveraged",
    strategyNote: "Nasdaq-100 지수 '일일' 수익률의 3배(수수료·비용 차감 전)를 목표로 합니다. 하루를 넘는 기간의 수익률은 지수 수익률의 3배와 크게 다를 수 있습니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["QLD", "QQQ"], newsQueries: ["Nasdaq 100"],
  },
  {
    symbol: "QLD", name: "ProShares Ultra QQQ", nameKo: "프로셰어즈 울트라 QQQ (2배)", kind: "etf", category: "leveraged", core: true,
    issuer: "ProShares", officialUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/qld",
    underlying: "Nasdaq-100 Index", leverage: 2, strategy: "leveraged",
    strategyNote: "Nasdaq-100 지수 '일일' 수익률의 2배(수수료·비용 차감 전)를 목표로 합니다. 하루를 넘는 기간의 수익률은 지수 수익률의 2배와 다를 수 있습니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["TQQQ", "QQQ"], newsQueries: ["Nasdaq 100"],
  },
  {
    symbol: "UPRO", name: "ProShares UltraPro S&P500", nameKo: "프로셰어즈 울트라프로 S&P500 (3배)", kind: "etf", category: "leveraged",
    issuer: "ProShares", officialUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/upro",
    underlying: "S&P 500 Index", leverage: 3, strategy: "leveraged",
    strategyNote: "S&P 500 지수 '일일' 수익률의 3배(수수료·비용 차감 전)를 목표로 합니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["SPXL", "SSO"],
  },
  {
    symbol: "SSO", name: "ProShares Ultra S&P500", nameKo: "프로셰어즈 울트라 S&P500 (2배)", kind: "etf", category: "leveraged",
    issuer: "ProShares", officialUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/sso",
    underlying: "S&P 500 Index", leverage: 2, strategy: "leveraged",
    strategyNote: "S&P 500 지수 '일일' 수익률의 2배(수수료·비용 차감 전)를 목표로 합니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["UPRO", "SPY"],
  },
  {
    symbol: "SPXL", name: "Direxion Daily S&P 500 Bull 3X Shares", nameKo: "디렉시온 S&P 500 불 3X", kind: "etf", category: "leveraged",
    issuer: "Direxion", officialUrl: "https://www.direxion.com/product/daily-sp-500-bull-bear-3x-etf",
    underlying: "S&P 500 Index", leverage: 3, strategy: "leveraged",
    strategyNote: "S&P 500 지수 '일일' 수익률의 300%(수수료·비용 차감 전)를 목표로 합니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["UPRO"],
  },
  {
    symbol: "SOXL", name: "Direxion Daily Semiconductor Bull 3X Shares", nameKo: "디렉시온 반도체 불 3X", kind: "etf", category: "leveraged",
    issuer: "Direxion", officialUrl: "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etf",
    underlying: "NYSE Semiconductor Index (구 ICE Semiconductor Index)", leverage: 3, strategy: "leveraged",
    strategyNote: "미국 상장 반도체 기업 지수 '일일' 수익률의 300%(수수료·비용 차감 전)를 목표로 합니다. 업종 집중과 3배 레버리지가 결합되어 변동성이 매우 큽니다.",
    benchmarks: ["SOXX", "^SOX"], peers: ["SOXX", "SMH"], newsQueries: ["semiconductor stocks"],
  },

  // ───────────────────────── D. 배당 성장 ETF ─────────────────────────
  {
    symbol: "DGRO", name: "iShares Core Dividend Growth ETF", nameKo: "아이셰어즈 코어 배당성장", kind: "etf", category: "dividend_growth", core: true,
    issuer: "BlackRock iShares", officialUrl: "https://www.ishares.com/us/products/264623/ishares-core-dividend-growth-etf",
    underlying: "Morningstar US Dividend Growth Index", strategy: "dividend",
    strategyNote: "배당을 꾸준히 늘려 온 미국 기업에 투자하는 배당 성장 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["SCHD", "VIG"],
  },
  {
    symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", nameKo: "슈왑 미국 배당주", kind: "etf", category: "dividend_growth",
    issuer: "Charles Schwab", officialUrl: "https://www.schwabassetmanagement.com/products/schd",
    underlying: "Dow Jones U.S. Dividend 100 Index", strategy: "dividend",
    strategyNote: "배당 지속성과 재무 건전성 기준으로 선별한 미국 배당주 100개 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["DGRO", "VYM"],
  },
  {
    symbol: "VIG", name: "Vanguard Dividend Appreciation ETF", nameKo: "뱅가드 배당성장", kind: "etf", category: "dividend_growth",
    issuer: "Vanguard", officialUrl: "https://investor.vanguard.com/investment-products/etfs/profile/vig",
    underlying: "S&P U.S. Dividend Growers Index", strategy: "dividend",
    strategyNote: "장기간 배당을 늘려 온 미국 기업으로 구성된 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["DGRO", "SCHD"],
  },
  {
    symbol: "VYM", name: "Vanguard High Dividend Yield ETF", nameKo: "뱅가드 고배당", kind: "etf", category: "dividend_growth",
    issuer: "Vanguard", officialUrl: "https://investor.vanguard.com/investment-products/etfs/profile/vym",
    underlying: "FTSE High Dividend Yield Index", strategy: "dividend",
    strategyNote: "예상 배당수익률이 높은 미국 기업으로 구성된 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["SCHD", "HDV"],
  },
  {
    symbol: "HDV", name: "iShares Core High Dividend ETF", nameKo: "아이셰어즈 코어 고배당", kind: "etf", category: "dividend_growth",
    issuer: "BlackRock iShares", officialUrl: "https://www.ishares.com/us/products/239563/ishares-high-dividend-etf",
    underlying: "Morningstar Dividend Yield Focus Index", strategy: "dividend",
    strategyNote: "재무 건전성 기준을 통과한 고배당 미국 기업 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["VYM", "SCHD"],
  },
  {
    symbol: "NOBL", name: "ProShares S&P 500 Dividend Aristocrats ETF", nameKo: "프로셰어즈 배당귀족", kind: "etf", category: "dividend_growth",
    issuer: "ProShares", officialUrl: "https://www.proshares.com/our-etfs/strategic/nobl",
    underlying: "S&P 500 Dividend Aristocrats Index", strategy: "dividend",
    strategyNote: "S&P 500 구성 종목 중 장기간(25년 이상) 배당을 늘려 온 기업을 동일가중으로 담는 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["VIG", "SCHD"],
  },
  {
    symbol: "FDVV", name: "Fidelity High Dividend ETF", nameKo: "피델리티 고배당", kind: "etf", category: "dividend_growth",
    issuer: "Fidelity",
    underlying: "Fidelity High Dividend Index", strategy: "dividend",
    strategyNote: "배당 지급 여력과 성장성을 고려해 선정한 대형·중형 고배당주 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["SCHD", "VYM"],
  },
  {
    symbol: "DGRW", name: "WisdomTree U.S. Quality Dividend Growth Fund", nameKo: "위즈덤트리 퀄리티 배당성장", kind: "etf", category: "dividend_growth",
    issuer: "WisdomTree", officialUrl: "https://www.wisdomtree.com/investments/etfs/equity/dgrw",
    underlying: "WisdomTree U.S. Quality Dividend Growth Index", strategy: "dividend",
    strategyNote: "수익성·성장성 등 퀄리티 요인을 반영한 배당 성장 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["DGRO", "VIG"],
  },
  {
    symbol: "SPYD", name: "SPDR Portfolio S&P 500 High Dividend ETF", nameKo: "SPDR 포트폴리오 S&P 500 고배당", kind: "etf", category: "dividend_growth",
    issuer: "State Street",
    underlying: "S&P 500 High Dividend Index", strategy: "dividend",
    strategyNote: "S&P 500 중 배당수익률 상위 종목을 동일가중으로 담는 지수를 추종합니다.",
    benchmarks: ["^GSPC", "VOO"], peers: ["HDV", "VYM"],
  },

  // ───────────────────────── E. 월분배금·인컴 ETF ─────────────────────────
  {
    symbol: "JEPI", name: "JPMorgan Equity Premium Income ETF", nameKo: "JP모건 에쿼티 프리미엄 인컴", kind: "etf", category: "income", core: true,
    issuer: "J.P. Morgan Asset Management",
    officialUrl: "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332",
    underlying: "액티브 운용 (비교지수: S&P 500)", strategy: "option_income_active",
    strategyNote: "변동성이 낮은 미국 대형주 포트폴리오를 보유하면서, 주가연계증권(ELN)을 통해 S&P 500 지수 콜옵션을 매도해 옵션 프리미엄을 확보하는 액티브 전략입니다. 분배금은 보유 주식 배당과 옵션 프리미엄 수입 등에 따라 매달 달라집니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["JEPQ", "DIVO", "SPYI"], newsQueries: ["JEPI ETF"],
  },
  {
    symbol: "JEPQ", name: "JPMorgan Nasdaq Equity Premium Income ETF", nameKo: "JP모건 나스닥 에쿼티 프리미엄 인컴", kind: "etf", category: "income", core: true,
    issuer: "J.P. Morgan Asset Management",
    officialUrl: "https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-nasdaq-equity-premium-income-etf-etf-shares-46654q203",
    underlying: "액티브 운용 (비교지수: Nasdaq-100)", strategy: "option_income_active",
    strategyNote: "Nasdaq-100 중심의 주식 포트폴리오를 보유하면서, ELN 을 통해 Nasdaq-100 지수 콜옵션을 매도해 옵션 프리미엄을 확보하는 액티브 전략입니다. 분배금은 옵션 시장 변동성 등에 따라 매달 달라집니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["JEPI", "QYLD", "QQQI", "GPIQ"], newsQueries: ["JEPQ ETF"],
  },
  {
    symbol: "DIVO", name: "Amplify CWP Enhanced Dividend Income ETF", nameKo: "앰플리파이 CWP 배당 인컴", kind: "etf", category: "income", core: true,
    issuer: "Amplify ETFs", officialUrl: "https://amplifyetfs.com/divo/",
    underlying: "액티브 운용 (비교지수: S&P 500)", strategy: "option_income_active",
    strategyNote: "배당을 지급하는 우량 대형주를 보유하면서 개별 종목에 대해 전술적으로 커버드콜을 매도하는 액티브 전략입니다(서브어드바이저: Capital Wealth Planning). 분배금은 배당과 옵션 프리미엄 등으로 구성됩니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["JEPI", "SCHD"], newsQueries: ["DIVO ETF"],
  },
  {
    symbol: "QYLD", name: "Global X NASDAQ 100 Covered Call ETF", nameKo: "글로벌X 나스닥100 커버드콜", kind: "etf", category: "income",
    issuer: "Global X", officialUrl: "https://www.globalxetfs.com/funds/qyld/",
    underlying: "Cboe Nasdaq-100 BuyWrite V2 Index", strategy: "covered_call_index",
    strategyNote: "Nasdaq-100 주식을 보유하고 Nasdaq-100 지수 콜옵션(등가격 근처)을 매월 매도하는 규칙 기반 바이라이트 지수를 추종합니다. 상승장에서 지수 상승분 참여가 제한됩니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["JEPQ", "QQQI"], newsQueries: ["QYLD ETF"],
  },
  {
    symbol: "XYLD", name: "Global X S&P 500 Covered Call ETF", nameKo: "글로벌X S&P500 커버드콜", kind: "etf", category: "income",
    issuer: "Global X", officialUrl: "https://www.globalxetfs.com/funds/xyld/",
    underlying: "Cboe S&P 500 BuyWrite Index", strategy: "covered_call_index",
    strategyNote: "S&P 500 주식을 보유하고 S&P 500 지수 콜옵션을 매월 매도하는 바이라이트 지수를 추종합니다. 상승장에서 지수 상승분 참여가 제한됩니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["JEPI", "SPYI"], newsQueries: ["XYLD ETF"],
  },
  {
    symbol: "RYLD", name: "Global X Russell 2000 Covered Call ETF", nameKo: "글로벌X 러셀2000 커버드콜", kind: "etf", category: "income",
    issuer: "Global X", officialUrl: "https://www.globalxetfs.com/funds/ryld/",
    underlying: "Cboe Russell 2000 BuyWrite Index", strategy: "covered_call_index",
    strategyNote: "러셀 2000 소형주 지수에 대해 콜옵션을 매월 매도하는 바이라이트 지수를 추종합니다.",
    benchmarks: ["^RUT"], peers: ["QYLD", "XYLD"], newsQueries: ["RYLD ETF", "Russell 2000"],
  },
  {
    symbol: "SPYI", name: "NEOS S&P 500 High Income ETF", nameKo: "NEOS S&P 500 하이인컴", kind: "etf", category: "income",
    issuer: "NEOS Investments", officialUrl: "https://neosfunds.com/spyi/",
    underlying: "액티브 운용 (비교지수: S&P 500)", strategy: "option_income_active",
    strategyNote: "S&P 500 구성 종목을 보유하면서 S&P 500 지수옵션(콜 매도, 콜 스프레드 등)을 활용해 월 분배 수입을 추구하는 액티브 전략입니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["JEPI", "XYLD"], newsQueries: ["SPYI ETF"],
  },
  {
    symbol: "QQQI", name: "NEOS Nasdaq-100 High Income ETF", nameKo: "NEOS 나스닥100 하이인컴", kind: "etf", category: "income",
    issuer: "NEOS Investments", officialUrl: "https://neosfunds.com/qqqi/",
    underlying: "액티브 운용 (비교지수: Nasdaq-100)", strategy: "option_income_active",
    strategyNote: "Nasdaq-100 구성 종목을 보유하면서 Nasdaq-100 지수옵션을 활용해 월 분배 수입을 추구하는 액티브 전략입니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["JEPQ", "QYLD"], newsQueries: ["QQQI ETF"],
  },
  {
    symbol: "GPIQ", name: "Goldman Sachs Nasdaq-100 Core Premium Income ETF", nameKo: "골드만삭스 나스닥100 프리미엄 인컴", kind: "etf", category: "income",
    issuer: "Goldman Sachs Asset Management",
    underlying: "액티브 운용 (비교지수: Nasdaq-100)", strategy: "option_income_active",
    strategyNote: "Nasdaq-100 주식 포트폴리오를 보유하면서 포트폴리오 일부에 대해 지수 콜옵션을 매도하는 액티브 인컴 전략입니다.",
    benchmarks: ["^NDX", "QQQ"], peers: ["JEPQ", "QQQI"], newsQueries: ["GPIQ ETF"],
  },
  {
    symbol: "GPIX", name: "Goldman Sachs S&P 500 Core Premium Income ETF", nameKo: "골드만삭스 S&P500 프리미엄 인컴", kind: "etf", category: "income",
    issuer: "Goldman Sachs Asset Management",
    underlying: "액티브 운용 (비교지수: S&P 500)", strategy: "option_income_active",
    strategyNote: "S&P 500 주식 포트폴리오를 보유하면서 포트폴리오 일부에 대해 지수 콜옵션을 매도하는 액티브 인컴 전략입니다.",
    benchmarks: ["^GSPC", "SPY"], peers: ["JEPI", "SPYI"], newsQueries: ["GPIX ETF"],
  },

  // ───────────────────────── F. 금 ETF ─────────────────────────
  {
    symbol: "GLD", name: "SPDR Gold Shares", nameKo: "SPDR 골드 셰어즈", kind: "etf", category: "gold", core: true,
    issuer: "World Gold Trust Services / State Street", officialUrl: "https://www.spdrgoldshares.com/",
    underlying: "금 현물 (실물 금괴 보유)", strategy: "physical_gold",
    strategyNote: "신탁이 런던 금고 등에 실물 금괴를 보관하며, 신탁 비용 차감 후 금 가격의 성과를 반영하도록 설계된 그랜터 트러스트 구조입니다. 기업 실적이 아니라 금 가격이 주된 가격 결정 요인입니다.",
    benchmarks: ["GC=F"], peers: ["IAU", "GLDM"], newsQueries: ["gold price"],
  },
  {
    symbol: "IAU", name: "iShares Gold Trust", nameKo: "아이셰어즈 골드 트러스트", kind: "etf", category: "gold",
    issuer: "BlackRock iShares", officialUrl: "https://www.ishares.com/us/products/239561/ishares-gold-trust",
    underlying: "금 현물 (실물 금괴 보유)", strategy: "physical_gold",
    strategyNote: "실물 금괴를 보유하는 신탁 구조로, 비용 차감 후 금 가격의 성과를 반영하도록 설계되어 있습니다.",
    benchmarks: ["GC=F", "GLD"], peers: ["GLD", "GLDM"], newsQueries: ["gold price"],
  },
  {
    symbol: "GLDM", name: "SPDR Gold MiniShares Trust", nameKo: "SPDR 골드 미니셰어즈", kind: "etf", category: "gold",
    issuer: "World Gold Trust Services / State Street",
    underlying: "금 현물 (실물 금괴 보유)", strategy: "physical_gold",
    strategyNote: "실물 금괴를 보유하는 신탁 구조로, 비용 차감 후 금 가격의 성과를 반영하도록 설계되어 있습니다.",
    benchmarks: ["GC=F", "GLD"], peers: ["GLD", "IAU"], newsQueries: ["gold price"],
  },

  // ───────────────────────── G. 반도체·기술주 ETF ─────────────────────────
  {
    symbol: "SMH", name: "VanEck Semiconductor ETF", nameKo: "반에크 반도체", kind: "etf", category: "semis_tech",
    issuer: "VanEck", officialUrl: "https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/",
    underlying: "MVIS US Listed Semiconductor 25 Index", strategy: "sector",
    strategyNote: "미국에 상장된 대형 반도체 기업 25개 내외로 구성된 지수를 추종합니다. 상위 종목 비중이 높을 수 있습니다.",
    benchmarks: ["^SOX", "QQQ"], peers: ["SOXX", "NVDA"], newsQueries: ["semiconductor stocks"],
  },
  {
    symbol: "SOXX", name: "iShares Semiconductor ETF", nameKo: "아이셰어즈 반도체", kind: "etf", category: "semis_tech",
    issuer: "BlackRock iShares", officialUrl: "https://www.ishares.com/us/products/239705/ishares-phlx-semiconductor-etf",
    underlying: "NYSE Semiconductor Index", strategy: "sector",
    strategyNote: "미국 상장 반도체 기업 지수를 추종합니다.",
    benchmarks: ["^SOX", "QQQ"], peers: ["SMH", "SOXL"], newsQueries: ["semiconductor stocks"],
  },
  {
    symbol: "XLK", name: "Technology Select Sector SPDR Fund", nameKo: "테크놀로지 셀렉트 섹터 SPDR", kind: "etf", category: "semis_tech",
    issuer: "State Street", officialUrl: "https://www.sectorspdrs.com/mainfund/xlk",
    underlying: "Technology Select Sector Index", strategy: "sector",
    strategyNote: "S&P 500 구성 종목 중 정보기술 섹터 기업으로 구성된 지수를 추종합니다.",
    benchmarks: ["^GSPC", "QQQ"], peers: ["QQQ", "SMH"],
  },
];

/** 대시보드 시장 요약에 사용하는 지수·시장 지표 (데이터 제공처가 지원하는 경우에만 표시) */
export interface MarketSymbolConfig {
  symbol: string;
  nameKo: string;
  group: "index" | "rates" | "fx" | "commodity" | "volatility";
  /** 표시 단위 */
  unit?: "pt" | "%" | "usd" | "krw";
  /** 대시보드 상단 지수 카드에 표시 */
  headline?: boolean;
  note?: string;
}

export const MARKET_SYMBOLS: MarketSymbolConfig[] = [
  { symbol: "^GSPC", nameKo: "S&P 500", group: "index", unit: "pt", headline: true },
  { symbol: "^IXIC", nameKo: "NASDAQ Composite", group: "index", unit: "pt", headline: true },
  { symbol: "^NDX", nameKo: "NASDAQ 100", group: "index", unit: "pt", headline: true },
  { symbol: "^DJI", nameKo: "Dow Jones Industrial Average", group: "index", unit: "pt", headline: true },
  { symbol: "^RUT", nameKo: "Russell 2000", group: "index", unit: "pt" },
  { symbol: "^SOX", nameKo: "PHLX 반도체 지수", group: "index", unit: "pt" },
  { symbol: "^VIX", nameKo: "VIX 변동성 지수", group: "volatility", unit: "pt" },
  { symbol: "^TNX", nameKo: "미국 10년물 국채금리", group: "rates", unit: "%", note: "CBOE 10년 금리 지수(수익률 %)" },
  { symbol: "^IRX", nameKo: "미국 13주 국채금리", group: "rates", unit: "%", note: "CBOE 13주 금리 지수(할인율 %)" },
  { symbol: "DX-Y.NYB", nameKo: "달러 인덱스 (DXY)", group: "fx", unit: "pt", note: "ICE 미국 달러 지수" },
  { symbol: "KRW=X", nameKo: "원/달러 환율", group: "fx", unit: "krw", note: "1달러당 원화 (Yahoo Finance 외환 시세)" },
  { symbol: "GC=F", nameKo: "금 선물 (COMEX 근월물)", group: "commodity", unit: "usd", note: "현물 가격이 아닌 선물 가격입니다" },
];

/** 일일 브리핑 목록에서 '핵심 종목'으로 먼저 표시할 순서 */
export const CORE_ORDER = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
  "QQQ", "VOO", "SPY", "TQQQ", "QLD", "DGRO", "DIVO", "JEPI", "JEPQ", "GLD",
];
