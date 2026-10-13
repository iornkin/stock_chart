/** ETF 운용 정보 (서버 컴포넌트) */
import type { InstrumentConfig } from "@/config/instruments";
import { etfProfile } from "@/lib/data/profile";
import { getBars, dailyCloses } from "@/lib/data/bars";
import type { QuoteView } from "@/lib/data/quotes";
import { fmtPct, fmtUsd, fmtUsdCompact, fmtVolume } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { Empty, Notice, SourceLine, Stat } from "./ui";

const STRATEGY_KO: Record<string, string> = {
  index: "패시브 지수 추종",
  leveraged: "일일 레버리지",
  covered_call_index: "커버드콜 (규칙 기반 바이라이트 지수)",
  option_income_active: "옵션 활용 액티브 인컴",
  dividend: "배당·배당성장 지수",
  physical_gold: "실물 금 보유 신탁",
  sector: "섹터·업종 지수",
};

/** 금 ETF 와 금 선물의 최근 1년 일간 수익률 상관계수·수익률 차이 */
async function goldRelation(symbol: string) {
  const [a, b] = await Promise.all([getBars(symbol, "1d"), getBars("GC=F", "1d")]);
  if (!a.bars.length || !b.bars.length) return null;
  const A = new Map(dailyCloses(a.bars).map((p) => [p.date, p.close]));
  const B = dailyCloses(b.bars);
  const dates = B.map((p) => p.date).filter((d) => A.has(d)).slice(-253);
  if (dates.length < 60) return null;
  const bm = new Map(B.map((p) => [p.date, p.close]));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    ra.push(Math.log((A.get(dates[i]) as number) / (A.get(dates[i - 1]) as number)));
    rb.push(Math.log((bm.get(dates[i]) as number) / (bm.get(dates[i - 1]) as number)));
  }
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  const first = dates[0];
  const lastD = dates[dates.length - 1];
  return {
    corr: cov / Math.sqrt(va * vb),
    etfRet: ((A.get(lastD) as number) / (A.get(first) as number) - 1) * 100,
    goldRet: ((bm.get(lastD) as number) / (bm.get(first) as number) - 1) * 100,
    start: first,
    end: lastD,
    days: dates.length,
  };
}

export default async function EtfView({ inst, quote }: { inst: InstrumentConfig; quote: QuoteView | undefined }) {
  const p = etfProfile(inst.symbol);
  const gold = inst.strategy === "physical_gold" ? await goldRelation(inst.symbol) : null;
  const maxW = Math.max(1, ...p.holdings.map((h) => h.weight));
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-line p-4">
        <h3 className="mb-2 text-sm font-semibold">운용 전략과 구조</h3>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt className="text-ink-2">운용사</dt><dd className="text-right">{p.family.value ?? inst.issuer ?? "미제공"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-2">유형</dt><dd className="text-right">{inst.strategy ? STRATEGY_KO[inst.strategy] : "-"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-2">추종 지수·기초자산</dt><dd className="text-right">{inst.underlying ?? "미제공"}</dd></div>
          {inst.leverage && (
            <div className="flex justify-between gap-2"><dt className="text-ink-2">레버리지 배수 / 목표</dt><dd className="text-right font-semibold">{inst.leverage}배 · 기초지수 &lsquo;일일&rsquo; 수익률의 {inst.leverage}배</dd></div>
          )}
          <div className="flex justify-between gap-2"><dt className="text-ink-2">카테고리(제공처)</dt><dd className="text-right">{p.category.value ?? "미제공"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-2">설정일</dt><dd className="num text-right">{p.inceptionDate.value ?? "미제공"}</dd></div>
        </dl>
        {inst.strategyNote && <p className="mt-3 text-sm leading-relaxed text-ink-2">{inst.strategyNote}</p>}
        {inst.officialUrl && (
          <a href={inst.officialUrl} target="_blank" rel="noopener noreferrer" className="link mt-2 inline-block text-xs">
            운용사 공식 페이지에서 최신 공시 확인 ↗
          </a>
        )}
        <p className="mt-2 text-[11px] text-muted">추종 지수·전략 요약은 운용사 공시를 바탕으로 정리한 정성 정보이며, 수치(총보수·운용자산·편입 종목)는 아래 데이터 제공처 값을 사용합니다.</p>
      </div>

      {inst.strategy === "leveraged" && (
        <Notice tone="warn" title="레버리지 ETF: 일일 수익률 목표와 복리 효과">
          <p>
            이 ETF 는 하루 동안의 기초지수 수익률 × {inst.leverage} 를 목표로 매일 재조정됩니다. 여러 날에 걸친 수익률은 기초지수 기간 수익률 × {inst.leverage} 와 달라집니다.
          </p>
          <p className="mt-1 text-xs">
            가상 계산 예시(실제 데이터 아님): 지수가 +10% 후 −10% 이면 지수는 −1.0% 이지만, 일일 {inst.leverage}배 상품은 (1+{10 * (inst.leverage ?? 1)}%)×(1−{10 * (inst.leverage ?? 1)}%) − 1 ={" "}
            {(((1 + 0.1 * (inst.leverage ?? 1)) * (1 - 0.1 * (inst.leverage ?? 1)) - 1) * 100).toFixed(1)}% 가 됩니다. 실제 최근 차이는 &lsquo;일일 브리핑&rsquo;에서 계산값으로 확인할 수 있습니다.
          </p>
        </Notice>
      )}
      {(inst.strategy === "covered_call_index" || inst.strategy === "option_income_active") && (
        <Notice tone="info" title="옵션 운용 전략 관련 정보">
          <p>{inst.strategyNote}</p>
          <p className="mt-1 text-xs">
            옵션 매도 비율, 행사가, 만기 등 세부 옵션 포지션과 분배금 구성(배당·옵션 프리미엄·자본환급 비율)은 무료 데이터 제공처에서 제공되지 않아 표시하지 않습니다. 운용사의 일별 보유 내역과 19a-1 공시를 확인하세요.
          </p>
        </Notice>
      )}
      {inst.strategy === "physical_gold" && (
        <div className="rounded-lg border border-line p-4">
          <h3 className="mb-2 text-sm font-semibold">금 가격과의 관계</h3>
          {gold ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="일간 수익률 상관계수 (최근 1년)" value={gold.corr.toFixed(3)} sub={`${gold.start} ~ ${gold.end}, ${gold.days}거래일`} />
              <Stat label={`${inst.symbol} 기간 수익률`} value={fmtPct(gold.etfRet)} />
              <Stat label="금 선물(근월물) 기간 수익률" value={fmtPct(gold.goldRet)} />
              <Stat label="수익률 차이" value={`${(gold.etfRet - gold.goldRet).toFixed(2)}%p`} sub="총보수·선물 만기 교체·거래시간 차이 등 반영" />
            </div>
          ) : (
            <Empty>금 선물(GC=F) 또는 ETF 가격 데이터가 부족해 계산하지 않았습니다.</Empty>
          )}
          <p className="mt-2 text-[11px] text-muted">
            비교 기준은 COMEX 금 선물 근월물(GC=F, Yahoo Finance)이며 현물 가격(LBMA)과 다를 수 있습니다. 금 ETF 는 배당·이자 수입이 없고 신탁 보관 비용(총보수)이 매일 차감됩니다.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="운용자산(AUM)" value={p.totalAssets.value !== null ? fmtUsdCompact(p.totalAssets.value) : "미제공"} sub={p.totalAssets.source ?? ""} />
        <Stat label="총보수" value={p.expenseRatio.value !== null ? fmtPct(p.expenseRatio.value, 2, false) : "미제공"} sub={p.expenseRatio.source ?? ""} note={p.expenseRatio.note} />
        <Stat label="NAV" value={p.nav.value !== null ? fmtUsd(p.nav.value) : "미제공"} sub={p.nav.source ?? ""} />
        <Stat label="현재가" value={fmtUsd(quote?.price)} sub={quote ? formatEt(quote.marketTime ?? quote.fetchedAt) : ""} />
        <Stat label="거래량(당일)" value={fmtVolume(quote?.volume)} />
        <Stat label="평균 거래량(3개월)" value={fmtVolume(quote?.avgVolume3m)} />
        <Stat label="3년 베타" value={p.beta3y.value !== null ? p.beta3y.value.toFixed(2) : "미제공"} />
        <Stat label="제공처 산출 수익률" value={p.yieldProvider.value !== null ? fmtPct(p.yieldProvider.value, 2, false) : "미제공"} note={p.yieldProvider.note} sub="산식 비공개 — 분배금 탭의 TTM 참고" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            상위 편입 종목 {p.top10Weight !== null && <span className="text-xs font-normal text-muted">(상위 10개 비중 합계 {p.top10Weight.toFixed(1)}%)</span>}
          </h3>
          {p.holdings.length ? (
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">비중</th>
                </tr>
              </thead>
              <tbody>
                {p.holdings.slice(0, 15).map((h) => (
                  <tr key={`${h.symbol}${h.name}`}>
                    <td>
                      <span className="font-semibold">{h.symbol ?? "-"}</span> <span className="text-xs text-muted">{h.name}</span>
                    </td>
                    <td className="r">
                      <span className="inline-flex items-center gap-2">
                        <span className="hidden h-1.5 w-20 overflow-hidden rounded bg-surface-3 sm:inline-block">
                          <span className="block h-full rounded bg-[var(--s1)]" style={{ width: `${(h.weight / maxW) * 100}%` }} />
                        </span>
                        {h.weight.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>편입 종목 데이터 미제공 (제공처가 지원하지 않거나 아직 수집되지 않음)</Empty>
          )}
          {p.holdingsSource && <SourceLine>출처: {p.holdingsSource} · 운용사 공시 시점과 차이가 있을 수 있습니다.</SourceLine>}
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">섹터 비중</h3>
            {p.sectors.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {[...p.sectors].sort((a, b) => b.weight - a.weight).map((s) => (
                  <li key={s.sector} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-ink-2">{s.sector}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-surface-3">
                      <span className="block h-full rounded bg-[var(--s3)]" style={{ width: `${Math.min(100, s.weight)}%` }} />
                    </span>
                    <span className="num w-14 text-right">{s.weight.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>섹터 비중 데이터 미제공</Empty>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">과거 수익률 (제공처 기준)</h3>
            {p.returnsSource ? (
              <>
                <table className="table-basic">
                  <tbody>
                    {p.trailingReturns.map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td className={`r ${(r.value ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtPct(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.annualReturns.length > 0 && (
                  <p className="mt-2 text-xs text-ink-2">
                    연도별: {p.annualReturns.map((a) => `${a.year} ${fmtPct(a.value, 1)}`).join(" · ")}
                  </p>
                )}
                <SourceLine>출처: {p.returnsSource} (분배금 포함 총수익률 기준으로 제공되는 값). 사이트가 직접 계산한 가격·총수익률 비교는 &lsquo;배당·분배금&rsquo; 및 &lsquo;종목 비교&rsquo; 탭을 참고하세요.</SourceLine>
              </>
            ) : (
              <Empty>과거 수익률 데이터 미제공</Empty>
            )}
          </div>
        </div>
      </div>
      {p.summary.value && (
        <details className="rounded-lg border border-line p-3 text-sm">
          <summary className="font-semibold">펀드 설명 (제공처 원문, 영어)</summary>
          <p className="mt-2 leading-relaxed text-ink-2">{p.summary.value}</p>
        </details>
      )}
      <SourceLine>{p.sources.length ? p.sources.map((s) => `${s.kind}: ${s.source} (${formatEt(s.fetchedAt)})`).join(" · ") : "ETF 프로필 데이터가 아직 수집되지 않았습니다."}</SourceLine>
    </div>
  );
}
