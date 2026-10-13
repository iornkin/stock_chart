"use client";
/** 내 자산 → 세금 (해외주식 양도소득세·금융소득 종합과세 기준 확인) — 참고용 추정 */
import { useEffect, useMemo, useState } from "react";
import { useFx, useSeriesMap, etToday } from "@/lib/client/user-data";
import type { PortfolioSummary } from "@/lib/client/portfolio-summary";
import { convertSimpleToLedger } from "@/lib/portfolio/ledger";
import { CG_DEDUCTION_KRW, COST_METHOD_KO, FIN_INCOME_THRESHOLD_KRW, taxReport, type CostMethod } from "@/lib/portfolio/tax";
import type { PortfolioData } from "@/lib/portfolio/types";
import { closeOn } from "@/lib/sim/series";
import { Empty, Notice, Section } from "@/components/ui";
import { KV, krw, Seg, tone } from "@/components/sim/common";

const METHOD_KEY = "usi-tax-method";

export default function TaxSection({ p, s }: { p: PortfolioData; s: PortfolioSummary }) {
  const [method, setMethod] = useState<CostMethod>("fifo");
  useEffect(() => {
    try {
      const m = localStorage.getItem(METHOD_KEY);
      if (m === "fifo" || m === "average") setMethod(m);
    } catch {
      /* 무시 */
    }
  }, []);
  const choose = (m: CostMethod) => {
    setMethod(m);
    try {
      localStorage.setItem(METHOD_KEY, m);
    } catch {
      /* 무시 */
    }
  };
  const fxSeries = useSeriesMap(["KRW=X"]);
  const fx = useFx();
  const today = etToday();
  const year = Number(today.slice(0, 4));
  const report = useMemo(() => {
    const x = fxSeries.series["KRW=X"];
    const fxOn = (d: string) => (x ? (closeOn(x, d)?.close ?? null) : null);
    const txns = p.mode === "ledger" ? p.ledger : convertSimpleToLedger(p.simple.holdings, 0, null, today, () => Math.random().toString(36));
    return taxReport(txns, method, fxOn, { prices: Object.fromEntries(s.holdings.map((h) => [h.symbol, h.price])), fx: fx.rate, year });
  }, [p, method, fxSeries.series, fx.rate, s.holdings, today, year]);

  if (s.empty) return <Empty>자산을 입력하면 세금을 추정합니다.</Empty>;
  const cur = report.years.find((y) => y.year === year);
  const finPct = cur ? Math.min(100, (cur.dividendsKrw / FIN_INCOME_THRESHOLD_KRW) * 100) : 0;
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="해외주식 양도소득세 (추정)"
        description="1~12월 매매 손익을 합산해 250만 원을 공제하고 22%. 다음 해 5월 신고·납부"
        right={<Seg label="취득가액 계산 방식" value={method} onChange={choose} options={[{ v: "fifo", l: COST_METHOD_KO.fifo }, { v: "average", l: COST_METHOD_KO.average }]} />}
      >
        {report.missingFx.length > 0 && <Notice tone="warn">환율을 알 수 없는 거래 {report.missingFx.length}건은 계산에서 빠졌습니다 ({report.missingFx.slice(0, 3).join(", ")}). 거래에 환율을 입력하세요.</Notice>}
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KV label={`${year}년 실현 손익 (원화)`} value={cur ? krw(cur.netKrw) : "매도 없음"} valueClass={tone(cur?.netKrw)} />
          <KV label={`${year}년 예상 세액`} value={krw(cur?.taxKrw ?? 0)} sub={`기본공제 ${krw(CG_DEDUCTION_KRW)} 후 22%`} />
          <KV label="공제 남은 금액" value={krw(Math.max(0, CG_DEDUCTION_KRW - Math.max(0, cur?.netKrw ?? 0)))} sub="올해 이만큼 차익은 세금 없음" />
          <KV
            label="지금 전부 판다면"
            value={report.liquidation ? krw(report.liquidation.extraTaxKrw) : "-"}
            sub={report.liquidation ? `추가 세금 · 평가차익 ${krw(report.liquidation.gainKrw)}` : "현재가·환율이 필요합니다"}
          />
        </div>
        {report.years.some((y) => y.sells.length) ? (
          <div className="mt-4 overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>연도</th>
                  <th className="r">매도 차익</th>
                  <th className="r">매도 손실</th>
                  <th className="r">순손익</th>
                  <th className="r">과세표준</th>
                  <th className="r">예상 세액</th>
                </tr>
              </thead>
              <tbody>
                {report.years
                  .filter((y) => y.sells.length)
                  .map((y) => (
                    <tr key={y.year}>
                      <td>
                        {y.year}
                        {y.year === year && <span className="ml-1 text-[11px] text-muted">진행 중</span>}
                      </td>
                      <td className="r text-up">{krw(y.gainKrw)}</td>
                      <td className="r text-down">{krw(-y.lossKrw)}</td>
                      <td className={`r font-semibold ${tone(y.netKrw)}`}>{krw(y.netKrw)}</td>
                      <td className="r">{krw(y.taxableKrw)}</td>
                      <td className="r font-semibold">{krw(y.taxKrw)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{p.mode === "ledger" ? "매도 기록이 없어 실현 손익이 없습니다." : "간편 입력은 매도 기록이 없어 '전부 판다면' 금액만 계산합니다. 평균 매수 환율을 넣으면 더 정확합니다."}</p>
        )}
        {cur && cur.sells.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs font-semibold text-accent">{year}년 매도 {cur.sells.length}건 자세히</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>매도일</th>
                    <th>종목</th>
                    <th className="r">수량</th>
                    <th className="r">양도가액</th>
                    <th className="r">취득가액</th>
                    <th className="r">수수료</th>
                    <th className="r">차익</th>
                    <th className="r">환율</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.sells.map((x, i) => (
                    <tr key={i}>
                      <td className="num">{x.date}</td>
                      <td className="font-semibold">{x.symbol}</td>
                      <td className="r">{x.shares}</td>
                      <td className="r">{krw(x.proceedsKrw)}</td>
                      <td className="r">{krw(x.costKrw)}</td>
                      <td className="r">{krw(x.feeKrw)}</td>
                      <td className={`r ${tone(x.gainKrw)}`}>{krw(x.gainKrw)}</td>
                      <td className="r">
                        {x.fxSell.toFixed(1)}
                        {x.fxEstimated && <span className="text-[10px] text-muted"> 추정</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section title="금융소득 종합과세 기준" description="이자·배당 등 금융소득이 연 2,000만 원을 넘으면 종합과세 대상">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              {year}년 받은 분배금 (세전, 원화 환산) <b className="num">{krw(cur?.dividendsKrw ?? 0)}</b>
            </span>
            <span className="num text-xs text-muted">기준 {krw(FIN_INCOME_THRESHOLD_KRW)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(finPct)} aria-label="금융소득 종합과세 기준 대비">
            <div className={`h-full rounded-full ${finPct >= 80 ? "bg-warn" : "bg-accent"}`} style={{ width: `${finPct}%` }} />
          </div>
          <p className="text-xs text-ink-2">
            {p.mode === "ledger" ? "입력한 분배금 수령 기록만 합산했습니다." : "간편 입력에는 분배금 수령 기록이 없습니다 (거래 내역 모드에서 기록)."} 은행 이자 등 다른 금융소득은 포함되지 않으니 함께 따져 보세요.
            {finPct >= 80 && " 기준에 가까워 종합과세 대상이 될 수 있습니다."}
          </p>
        </div>
      </Section>

      <details className="rounded-lg border border-line px-4 py-3 text-xs leading-relaxed text-ink-2">
        <summary className="text-sm font-semibold">계산 기준과 한계</summary>
        <ul className="mt-2 list-disc pl-5">
          <li>세율 22% = 양도소득세 20% + 지방소득세 2%. 손실은 같은 해 안에서만 상계되고 다음 해로 넘어가지 않습니다.</li>
          <li>기본공제 250만 원은 1년에 한 번, 모든 해외주식 매매에 함께 적용됩니다. 다른 증권사 계좌의 매매가 있으면 합쳐서 계산해야 합니다.</li>
          <li>취득가액은 증권사마다 선입선출법 또는 이동평균법을 씁니다. 신고할 때 쓸 방식과 같은 방식을 고르세요.</li>
          <li>실제 신고는 매수·매도 결제일의 기준환율을 씁니다. 거래에 환율을 입력하지 않으면 거래일(또는 직전 거래일) 원/달러 종가로 근사합니다 (&apos;추정&apos; 표시).</li>
          <li>미국 배당은 현지에서 15% 원천징수되며 국내 추가 세금은 보통 없습니다. ISA·연금 계좌 등 절세 계좌는 반영하지 않았습니다.</li>
          <li>참고용 추정입니다. 실제 신고는 증권사 양도소득 자료와 국세청 홈택스로 확인하세요.</li>
        </ul>
      </details>
    </div>
  );
}
