/** 개별 기업 재무 정보 (서버 컴포넌트) */
import { stockFundamentals, type Field } from "@/lib/data/profile";
import type { PeriodValue, FinancialSeries } from "@/lib/financials";
import { fmtCompact, fmtPct, fmtPrice, fmtUsd, fmtUsdCompact, fmtVolume } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { Empty, Notice, SourceLine } from "./ui";

function FieldTile({ label, f, fmt }: { label: string; f: Field<number> | Field<string>; fmt: (v: never) => string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5" title={[f.source ? `출처: ${f.source}` : "데이터 미제공", f.note].filter(Boolean).join(" · ")}>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold">{f.value === null ? <span className="text-sm font-normal text-muted">미제공</span> : fmt(f.value as never)}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted">{f.source ?? ""}{f.note ? ` · ${f.note}` : ""}</div>
    </div>
  );
}

function byEnd(series: FinancialSeries | undefined, which: "quarterly" | "annual") {
  return new Map((series?.[which] ?? []).map((v) => [v.end, v]));
}

function PeriodTable({ fin, which }: { fin: NonNullable<ReturnType<typeof stockFundamentals>["financials"]>; which: "quarterly" | "annual" }) {
  const rev = byEnd(fin.revenue, which);
  const op = byEnd(fin.operatingIncome, which);
  const ni = byEnd(fin.netIncome, which);
  const eps = byEnd(fin.epsDiluted, which);
  const ocf = byEnd(fin.operatingCashFlow, which);
  const capex = byEnd(fin.capex, which);
  const ends = [...rev.keys()].sort().slice(which === "quarterly" ? -8 : -5).reverse();
  if (!ends.length) return <Empty>SEC 재무제표 데이터가 없습니다.</Empty>;
  const yoy = (end: string) => {
    const cur = rev.get(end);
    if (!cur) return null;
    const t = Date.parse(end) - 365 * 86400000;
    const prior = [...rev.values()].find((v) => Math.abs(Date.parse(v.end) - t) < 20 * 86400000);
    return prior && prior.value > 0 ? (cur.value / prior.value - 1) * 100 : null;
  };
  const mark = (v: PeriodValue | undefined) => (v?.derived ? "*" : "");
  return (
    <div className="overflow-x-auto">
      <table className="table-basic">
        <thead>
          <tr>
            <th>기간 종료</th>
            <th>회계 구분</th>
            <th className="r">매출</th>
            <th className="r">매출 성장률(YoY)</th>
            <th className="r">영업이익</th>
            <th className="r">영업이익률</th>
            <th className="r">순이익</th>
            <th className="r">희석 EPS</th>
            <th className="r">영업현금흐름</th>
            <th className="r">설비투자</th>
            <th className="r">잉여현금흐름</th>
          </tr>
        </thead>
        <tbody>
          {ends.map((e) => {
            const r = rev.get(e);
            const o = op.get(e);
            const c = ocf.get(e);
            const x = capex.get(e);
            return (
              <tr key={e}>
                <td className="num">{e}</td>
                <td className="text-xs">{r?.fy ? `FY${r.fy} ${r.fp ?? ""}` : "-"}</td>
                <td className="r">{fmtUsdCompact(r?.value)}{mark(r)}</td>
                <td className="r">{fmtPct(yoy(e))}</td>
                <td className="r">{fmtUsdCompact(o?.value)}{mark(o)}</td>
                <td className="r">{o && r && r.value ? fmtPct((o.value / r.value) * 100, 1, false) : "-"}</td>
                <td className="r">{fmtUsdCompact(ni.get(e)?.value)}{mark(ni.get(e))}</td>
                <td className="r">{eps.get(e) ? fmtPrice(eps.get(e)!.value) : "-"}</td>
                <td className="r">{fmtUsdCompact(c?.value)}{mark(c)}</td>
                <td className="r">{fmtUsdCompact(x?.value)}{mark(x)}</td>
                <td className="r">{c && x ? `${fmtUsdCompact(c.value - x.value)}*` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function FinancialsView({ symbol, price }: { symbol: string; price: number | null }) {
  const f = stockFundamentals(symbol, price);
  const usd = (v: number) => fmtUsdCompact(v);
  const pct = (v: number) => fmtPct(v, 1, false);
  const x = (v: number) => `${v.toFixed(1)}배`;
  return (
    <div className="flex flex-col gap-5">
      {!f.sources.length && (
        <Notice tone="warn" title="재무 데이터 미수집">
          아직 기업 지표·재무제표를 받지 못했습니다. 참조 데이터 수집 작업(collect_reference)이 실행되면 표시됩니다. SEC 재무제표는 SEC_USER_AGENT 설정이 필요합니다.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <FieldTile label="시가총액" f={f.marketCap} fmt={usd} />
        <FieldTile label="52주 최고가" f={f.fiftyTwoHigh} fmt={(v: number) => fmtUsd(v)} />
        <FieldTile label="52주 최저가" f={f.fiftyTwoLow} fmt={(v: number) => fmtUsd(v)} />
        <FieldTile label="평균 거래량(3개월)" f={f.avgVolume3m} fmt={(v: number) => fmtVolume(v)} />
        <FieldTile label="평균 거래량(10일)" f={f.avgVolume10d} fmt={(v: number) => fmtVolume(v)} />
        <FieldTile label="매출(최근 4분기)" f={f.revenueTTM} fmt={usd} />
        <FieldTile label="매출 성장률(YoY)" f={f.revenueGrowthYoY} fmt={(v: number) => fmtPct(v, 1)} />
        <FieldTile label="영업이익(최근 4분기)" f={f.operatingIncomeTTM} fmt={usd} />
        <FieldTile label="영업이익률" f={f.operatingMargin} fmt={pct} />
        <FieldTile label="순이익(최근 4분기)" f={f.netIncomeTTM} fmt={usd} />
        <FieldTile label="EPS(최근 12개월)" f={f.epsTTM} fmt={(v: number) => fmtUsd(v)} />
        <FieldTile label="PER" f={f.trailingPE} fmt={x} />
        <FieldTile label="선행 PER" f={f.forwardPE} fmt={x} />
        <FieldTile label="PBR" f={f.priceToBook} fmt={x} />
        <FieldTile label="ROE" f={f.roe} fmt={pct} />
        <FieldTile label="영업현금흐름(최근 4분기)" f={f.operatingCashFlowTTM} fmt={usd} />
        <FieldTile label="잉여현금흐름(최근 4분기)" f={f.freeCashFlowTTM} fmt={usd} />
        <FieldTile label="연간 배당금(제공처)" f={f.dividendRate} fmt={(v: number) => fmtUsd(v)} />
        <FieldTile label="배당수익률(제공처)" f={f.dividendYield} fmt={(v: number) => fmtPct(v, 2, false)} />
        <FieldTile label="배당성향" f={f.payoutRatio} fmt={pct} />
        <FieldTile label="다음 실적 발표(예정)" f={f.nextEarnings} fmt={(v: string) => v} />
      </div>

      {f.financials ? (
        <>
          <div>
            <h3 className="mb-2 text-sm font-semibold">최근 분기 실적 (SEC 10-Q/10-K)</h3>
            <PeriodTable fin={f.financials} which="quarterly" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">연간 실적</h3>
            <PeriodTable fin={f.financials} which="annual" />
          </div>
          <SourceLine>
            * 표시는 사이트 계산값입니다: 누적(YTD)으로만 보고된 항목은 같은 회계연도 누적값의 차이로, 4분기는 연간 − 3분기 누적으로 계산했습니다. 잉여현금흐름 = 영업현금흐름 − 유형자산 취득(설비투자).
            출처: SEC EDGAR XBRL ({f.financials.entityName}) · 수집 {formatEt(f.financialsFetchedAt)}
          </SourceLine>
        </>
      ) : (
        <Empty>SEC 재무제표 데이터가 없습니다 (SEC_USER_AGENT 미설정 또는 미수집).</Empty>
      )}

      {f.earningsHistory.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">분기 EPS: 실제 vs 시장 예상 (Yahoo Finance)</h3>
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>분기</th>
                  <th className="r">실제 EPS</th>
                  <th className="r">예상 EPS</th>
                  <th className="r">차이</th>
                </tr>
              </thead>
              <tbody>
                {f.earningsHistory.map((e) => (
                  <tr key={e.quarter}>
                    <td>{e.quarter}</td>
                    <td className="r">{fmtPrice(e.actual)}</td>
                    <td className="r">{fmtPrice(e.estimate)}</td>
                    <td className="r">{e.actual !== null && e.estimate !== null && e.estimate !== 0 ? fmtPct(((e.actual - e.estimate) / Math.abs(e.estimate)) * 100, 1) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {f.summary.value && (
        <details className="rounded-lg border border-line p-3 text-sm">
          <summary className="font-semibold">사업 개요 (제공처 원문, 영어)</summary>
          <p className="mt-2 leading-relaxed text-ink-2">{f.summary.value}</p>
          <p className="mt-1 text-[11px] text-muted">
            {f.sector.value ?? "-"} / {f.industry.value ?? "-"} · 직원 {fmtCompact(f.employees.value)}명 · 출처 {f.summary.source}
          </p>
        </details>
      )}
      <SourceLine>
        {f.sources.map((s) => `${s.kind}: ${s.source} (${formatEt(s.fetchedAt)})`).join(" · ")}
      </SourceLine>
    </div>
  );
}
