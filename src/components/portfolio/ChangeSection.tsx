"use client";
/**
 * 내 자산 → 변화 분석: 정한 기간에 자산이 왜 변했는지 (가격·매매·분배금·입출금·수수료로 나눔) + 시장과 비교
 * 사실(가격·거래 기록) → 계산(기여도) 순서로만 보여 주고, 원인(뉴스 등)은 추정하지 않는다.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { etToday, useSeriesMap } from "@/lib/client/user-data";
import { heldSymbols } from "@/lib/client/portfolio-summary";
import { attributeLedger, attributeSimple, snapshotAt, type Attribution } from "@/lib/portfolio/attribution";
import { totalReturnIndex } from "@/lib/portfolio/performance";
import type { PortfolioData } from "@/lib/portfolio/types";
import { addDays, closeOn, indexOnOrBefore, type PriceSeries } from "@/lib/sim/series";
import { getInstrument } from "@/lib/instruments";
import { Notice, Section } from "@/components/ui";
import { Field, KV, pct, Seg, signedUsd, tone, usd } from "@/components/sim/common";

type Period = "1d" | "1w" | "1m" | "3m" | "ytd" | "custom";
const PERIOD_KO: Record<Period, string> = { "1d": "전 거래일", "1w": "1주", "1m": "1개월", "3m": "3개월", ytd: "연초 이후", custom: "직접 선택" };
const BENCH = ["SPY", "QQQ"];

function startFor(p: Period, cal: string[], today: string, custom: string): string {
  const last = cal[cal.length - 1] ?? today;
  if (p === "1d") return cal[cal.length - 2] ?? last;
  if (p === "1w") return addDays(last, -7);
  if (p === "1m") return addDays(last, -30);
  if (p === "3m") return addDays(last, -91);
  if (p === "ytd") return `${Number(last.slice(0, 4)) - 1}-12-31`;
  return custom;
}

const benchReturn = (s: PriceSeries | undefined, start: string, end: string): number | null => {
  if (!s) return null;
  const tri = totalReturnIndex(s);
  const i0 = indexOnOrBefore(s.dates, start);
  const i1 = indexOnOrBefore(s.dates, end);
  return i0 >= 0 && i1 > i0 ? (tri[i1] / tri[i0] - 1) * 100 : null;
};

export default function ChangeSection({ p }: { p: PortfolioData }) {
  const today = etToday();
  const [period, setPeriod] = useState<Period>("1w");
  const [custom, setCustom] = useState(addDays(today, -30));
  const [customEnd, setCustomEnd] = useState(today);
  const syms = heldSymbols(p);
  const ser = useSeriesMap([...syms, ...BENCH]);
  const cal = ser.series.SPY?.dates ?? [];
  const start = startFor(period, cal, today, custom);
  const end = period === "custom" ? customEnd : (cal[cal.length - 1] ?? today);
  const closeOf = (s: string, d: string) => {
    const x = ser.series[s];
    return x ? (closeOn(x, d)?.close ?? null) : null;
  };

  const a: Attribution | { error: string } | null = useMemo(() => {
    if (ser.loading) return null;
    if (!cal.length) return { error: "기준 달력(SPY 일봉)을 불러오지 못했습니다." };
    const missing = syms.filter((s) => !ser.series[s]);
    if (missing.length) return { error: `${missing.join(", ")} 일별 가격이 없어 분석하지 않았습니다.` };
    if (!(start < end)) return { error: "시작일이 종료일보다 앞이어야 합니다." };
    if (p.mode === "ledger") return attributeLedger(p.ledger, cal, closeOf, start, end);
    return attributeSimple(p.simple.holdings, p.simple.cash, cal, closeOf, (s, from, to) => (ser.series[s]?.divs ?? []).filter((d) => d.ex > from && d.ex <= to).reduce((x, d) => x + d.amount, 0), start, end);
    // closeOf 는 ser 에서 나온 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ser, start, end]);

  const top = a && !("error" in a) ? a.bySymbol.filter((x) => x.total > 0.005)[0] : undefined;
  const worst = a && !("error" in a) ? [...a.bySymbol].reverse().find((x) => x.total < -0.005) : undefined;
  const lev = a && !("error" in a) ? a.bySymbol.filter((x) => getInstrument(x.symbol)?.leverage) : [];

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="변화 분석"
        description="정한 기간에 총자산이 왜 변했는지 가격·매매·분배금·입출금·수수료로 나눕니다 (일별 종가 기준)."
        right={<Seg label="기간" value={period} onChange={setPeriod} options={(Object.keys(PERIOD_KO) as Period[]).map((k) => ({ v: k, l: PERIOD_KO[k] }))} />}
      >
        {period === "custom" && (
          <div className="mb-3 flex flex-wrap gap-3">
            <Field label="시작일 (그날 종가 기준)">
              <input type="date" className="input" value={custom} max={customEnd} onChange={(e) => setCustom(e.target.value)} aria-label="변화 분석 시작일" />
            </Field>
            <Field label="종료일">
              <input type="date" className="input" value={customEnd} max={today} onChange={(e) => setCustomEnd(e.target.value)} aria-label="변화 분석 종료일" />
            </Field>
          </div>
        )}
        {!a ? (
          <div className="skeleton h-40" aria-label="변화 분석 계산 중" />
        ) : "error" in a ? (
          <Notice tone="warn" title="분석하지 않았습니다">{a.error}</Notice>
        ) : (
          <>
            {a.assumedConstant && (
              <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">간편 입력은 거래 기록이 없어 지금 보유 수량을 기간 내내 들고 있었다고 보고 계산했습니다. 분배금은 실제 지급 기록 × 지금 수량(세전)이며 총자산에는 더하지 않았습니다.</p>
            )}
            <p className="mb-3 text-sm">
              <b>
                {a.start} → {a.end}
              </b>{" "}
              총자산 {usd(a.startValue, 0)} → {usd(a.endValue, 0)} (<span className={tone(a.change)}>{signedUsd(a.change)}</span>)
              {a.twrPct !== null && (
                <>
                  , 입출금 영향을 뺀 수익률 <span className={`font-semibold ${tone(a.twrPct)}`}>{pct(a.twrPct)}</span>
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
              <KV label="가격 변화" value={signedUsd(a.priceEffect)} valueClass={tone(a.priceEffect)} sub="보유 수량 × 종가 변화" />
              <KV label="매매 시점 차이" value={signedUsd(a.tradeEffect)} valueClass={tone(a.tradeEffect)} sub="거래 가격과 그날 종가의 차이" />
              <KV label="분배금 (세후)" value={signedUsd(a.dividendsNet)} valueClass={tone(a.dividendsNet)} sub={a.assumedConstant ? "추정 (총자산 미포함)" : "기간 중 기록"} />
              <KV label="입금 − 출금" value={signedUsd(a.deposits - a.withdrawals + a.openings)} sub="원금 이동 — 수익 아님" />
              <KV label="수수료" value={signedUsd(-a.fees)} valueClass={tone(-a.fees)} />
              <KV label="설명되지 않은 차이" value={signedUsd(a.assumedConstant ? 0 : a.residual)} sub={Math.abs(a.residual) < 0.01 || a.assumedConstant ? "없음 — 모든 변화를 나눔" : "거래 기록을 확인하세요"} />
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="table-basic min-w-[720px]">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th className="r">종가 변화</th>
                    <th className="r">가격 효과</th>
                    <th className="r">매매 시점</th>
                    <th className="r">분배금</th>
                    <th className="r">합계 기여</th>
                    <th className="r">수량 (시작 → 끝)</th>
                    <th>같은 기간 뉴스·공시</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bySymbol.map((x) => (
                    <tr key={x.symbol}>
                      <td className="font-semibold">{x.symbol}</td>
                      <td className={`r ${tone(x.pricePct)}`}>{pct(x.pricePct, 1)}</td>
                      <td className={`r ${tone(x.priceEffect)}`}>{signedUsd(x.priceEffect)}</td>
                      <td className="r">{Math.abs(x.tradeEffect) > 0.005 ? signedUsd(x.tradeEffect) : "-"}</td>
                      <td className="r">{x.dividendsNet ? usd(x.dividendsNet) : "-"}</td>
                      <td className={`r font-semibold ${tone(x.total)}`}>{signedUsd(x.total)}</td>
                      <td className="r text-xs">
                        {+x.sharesStart.toFixed(4)} → {+x.sharesEnd.toFixed(4)}
                      </td>
                      <td>
                        <Link className="link text-xs" href={`/stock/${x.symbol}?tab=news`}>
                          보기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-line p-3 text-sm">
              <p className="text-xs font-semibold text-ink-2">요약 (확인된 기록 → 계산 결과)</p>
              <ul className="mt-1 list-disc pl-5 text-sm leading-relaxed">
                {top && (
                  <li>
                    가장 크게 더한 종목: <b>{top.symbol}</b> {signedUsd(top.total)} (종가 {pct(top.pricePct, 1)})
                  </li>
                )}
                {worst && (
                  <li>
                    가장 크게 뺀 종목: <b>{worst.symbol}</b> {signedUsd(worst.total)} (종가 {pct(worst.pricePct, 1)})
                  </li>
                )}
                {a.dividendsNet > 0 && <li>분배금 {usd(a.dividendsNet)}이 {a.assumedConstant ? "지급된 것으로 추정됩니다" : "현금 또는 재투자로 들어왔습니다"}.</li>}
                {a.deposits - a.withdrawals + a.openings !== 0 && <li>입출금 {signedUsd(a.deposits - a.withdrawals + a.openings)}은 원금 이동이라 수익률에 넣지 않았습니다.</li>}
                {lev.length > 0 && <li>레버리지 ETF({lev.map((x) => x.symbol).join(", ")})는 기초지수 하루 변동의 여러 배로 움직여 기여도가 크게 나타날 수 있습니다.</li>}
                {BENCH.map((b) => {
                  const r = benchReturn(ser.series[b], a.start, a.end);
                  return r !== null ? (
                    <li key={b}>
                      같은 기간 {b}(분배금 재투자) <span className={tone(r)}>{pct(r)}</span>
                      {a.twrPct !== null && (
                        <>
                          {" "}
                          — 내 자산 {pct(a.twrPct)}, 차이 <span className={tone(a.twrPct - r)}>{pct(a.twrPct - r)}p</span>
                        </>
                      )}
                    </li>
                  ) : null;
                })}
              </ul>
              <p className="mt-2 text-[11px] text-muted">가격이 움직인 이유는 추정하지 않습니다. 같은 기간의 뉴스·공시는 종목별 &lsquo;보기&rsquo;에서 확인할 수 있지만, 같은 시기에 나왔다고 원인이라고 볼 수는 없습니다.</p>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

/** 자산 추이 안의 타임머신: 실제 거래 기록으로 그날의 보유 상태를 다시 만들고 두 날짜를 비교 */
export function TimeMachine({ p }: { p: PortfolioData }) {
  const today = etToday();
  const first = p.ledger.length ? [...p.ledger].sort((x, y) => x.date.localeCompare(y.date))[0].date : today;
  const [d1, setD1] = useState(first);
  const [d2, setD2] = useState(today);
  const syms = heldSymbols(p);
  const ser = useSeriesMap(syms);
  const closeOf = (s: string, d: string) => {
    const x = ser.series[s];
    return x ? (closeOn(x, d)?.close ?? null) : null;
  };
  const snaps = useMemo(() => {
    if (ser.loading || p.mode !== "ledger") return null;
    return [d1, d2].map((d) => (d < first ? null : snapshotAt(p.ledger, d, closeOf)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ser, d1, d2, first]);
  if (p.mode !== "ledger") return <p className="text-sm text-muted">타임머신은 거래 내역 모드에서만 됩니다 (간편 입력에는 과거 거래 기록이 없어 과거 보유 상태를 다시 만들 수 없음).</p>;
  if (!snaps) return <div className="skeleton h-40" aria-label="과거 보유 상태 계산 중" />;
  const all = [...new Set(snaps.flatMap((x) => x?.positions.map((q) => q.symbol) ?? []))];
  const row = (sn: (typeof snaps)[number], sym: string) => sn?.positions.find((q) => q.symbol === sym);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Field label="날짜 A">
          <input type="date" className="input" value={d1} min={first} max={today} onChange={(e) => setD1(e.target.value)} aria-label="타임머신 날짜 A" />
        </Field>
        <Field label="날짜 B">
          <input type="date" className="input" value={d2} min={first} max={today} onChange={(e) => setD2(e.target.value)} aria-label="타임머신 날짜 B" />
        </Field>
      </div>
      <p className="text-[11px] text-muted">
        재구성 가능 범위: 첫 거래 기록 {first} ~ 오늘. 그 이전의 보유는 기록이 없어 알 수 없습니다. 평가는 그날(휴장이면 직전 거래일) 종가 기준입니다.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {snaps.map((sn, i) => (
          <div key={i} className="rounded-lg border border-line p-3 text-sm">
            <p className="text-xs font-semibold text-ink-2">{i === 0 ? `A · ${d1}` : `B · ${d2}`}</p>
            {sn ? (
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">총자산</dt>
                <dd className="num text-right font-semibold">{usd(sn.totalAssets, 0)}</dd>
                <dt className="text-muted">현금</dt>
                <dd className="num text-right">{usd(sn.cash, 0)}</dd>
                <dt className="text-muted">순납입 원금</dt>
                <dd className="num text-right">{usd(sn.netContributions, 0)}</dd>
                <dt className="text-muted">원금 대비 차이</dt>
                <dd className={`num text-right ${tone(sn.totalPnl)}`}>{signedUsd(sn.totalPnl)}</dd>
                <dt className="text-muted">그날까지 받은 분배금 (세후)</dt>
                <dd className="num text-right">{usd(sn.dividendsNet, 0)}</dd>
              </dl>
            ) : (
              <p className="text-xs text-muted">첫 거래 기록 이전이라 보유 내역이 없습니다.</p>
            )}
          </div>
        ))}
      </div>
      {all.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th className="r">A 수량</th>
                <th className="r">A 비중</th>
                <th className="r">B 수량</th>
                <th className="r">B 비중</th>
                <th className="r">수량 변화</th>
                <th className="r">평가금액 변화</th>
              </tr>
            </thead>
            <tbody>
              {all.map((sym) => {
                const x = row(snaps[0], sym);
                const y = row(snaps[1], sym);
                const w = (sn: (typeof snaps)[number], v: number | null | undefined) => (sn && sn.totalAssets > 0 && v ? `${((v / sn.totalAssets) * 100).toFixed(1)}%` : "-");
                return (
                  <tr key={sym}>
                    <td className="font-semibold">{sym}</td>
                    <td className="r">{x ? +x.shares.toFixed(4) : 0}</td>
                    <td className="r">{w(snaps[0], x?.value)}</td>
                    <td className="r">{y ? +y.shares.toFixed(4) : 0}</td>
                    <td className="r">{w(snaps[1], y?.value)}</td>
                    <td className="r">{+((y?.shares ?? 0) - (x?.shares ?? 0)).toFixed(4)}</td>
                    <td className={`r ${tone((y?.value ?? 0) - (x?.value ?? 0))}`}>{signedUsd((y?.value ?? 0) - (x?.value ?? 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
