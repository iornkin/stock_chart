/** 종목별 편입·섹터 정보 (서버에서 만들고 브라우저가 내 자산 노출 분석에 쓴다) */
import type { Category } from "@/config/instruments";

export interface ExposureHolding {
  symbol: string | null;
  name: string;
  /** % */
  weight: number;
  /** 다른 ETF·펀드(머니마켓 등)로 보이는 편입 — 그 안의 종목까지 펼치지 않음 */
  fund: boolean;
}

export interface ExposureInfo {
  symbol: string;
  kind: "stock" | "etf";
  category: Category;
  leverage: number | null;
  strategy: string | null;
  /** 제공처가 준 상위 편입 종목 (보통 10개, 전체 보유 내역 아님) */
  holdings: ExposureHolding[];
  holdingsSource: string | null;
  /** ETF 섹터 비중 (%) */
  sectors: { sector: string; weight: number }[];
  sectorsSource: string | null;
  /** 개별 주식의 섹터 */
  stockSector: string | null;
  expenseRatio: number | null;
  /** 이 정보를 제공처에서 받은 시각 */
  fetchedAt: number | null;
}

export interface ExposureResponse {
  asOf: number;
  items: Record<string, ExposureInfo>;
}
