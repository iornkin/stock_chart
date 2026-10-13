/** 종목 비교 (서버): DB 에서 입력을 모아 compare-core 로 계산한다 */
import { getInstrument } from "./instruments";
import { getBars, dailyCloses } from "./data/bars";
import { readDividends } from "./data/dividends";
import { etfProfile } from "./data/profile";
import { readQuotes } from "./data/quotes";
import { compareFromInputs, type CompareInput, type CompareResult } from "./compare-core";

export type { CompareInput, CompareResult, CompareRow, CompareSeries } from "./compare-core";

export async function loadCompareInput(symbol: string, opts: { allowFetch?: boolean } = {}): Promise<CompareInput> {
  const r = await getBars(symbol, "1d", opts);
  const prof = getInstrument(symbol)?.kind === "etf" ? etfProfile(symbol) : null;
  return {
    symbol,
    points: r.bars.length ? dailyCloses(r.bars).map((p) => ({ date: p.date, close: p.close, volume: p.volume })) : [],
    error: r.bars.length ? null : (r.meta.error ?? "가격 데이터 없음"),
    fetchedAt: r.meta.fetchedAt,
    dividends: readDividends(symbol),
    price: readQuotes([symbol]).get(symbol)?.price ?? null,
    expenseRatio: prof?.expenseRatio.value ?? null,
    expenseSource: prof?.expenseRatio.source ?? null,
    totalAssets: prof?.totalAssets.value ?? null,
  };
}

export async function computeCompare(symbols: string[], period: string): Promise<CompareResult> {
  const inputs: CompareInput[] = [];
  for (const s of symbols) inputs.push(await loadCompareInput(s));
  return compareFromInputs(inputs, period);
}
