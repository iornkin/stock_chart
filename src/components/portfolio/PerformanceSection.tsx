"use client";
/** 내 자산 → 성과 분석: 시간가중수익률(TWR)·금액가중수익률(XIRR)·투자 기간·분배금 재투자/현금·벤치마크 (거래 내역 모드) */
import { useMemo, useState } from "react";
import { useSeriesMap } from "@/lib/client/user-data";
import { personalPerformance } from "@/lib/portfolio/performance";
import type { PortfolioData } from "@/lib/portfolio/types";
import { closeOn } from "@/lib/sim/series";
import { Notice, Section } from "@/components/ui";
import { KV, Seg, pct, signedUsd, tone, usd } from "@/components/sim/common";

const BENCHES = ["SPY", "QQQ", "SCHD", "VTI"];

function periodText(start: string, end: string): string {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && !m) {
    const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400_000);
    return `${days}일`;
  }
  return `${y ? `${y}년 ` : ""}${m ? `${m}개월` : ""}`.trim();
}

export default function PerformanceSection({ p }: { p: PortfolioData }) {
  const [bench, setBench] = useState("SPY");
  const symbols = p.mode === "ledger" ? [...new Set(p.ledger.map((t) => t.symbol).filter((x): x is string => !!x))] : [];
  const ser = useSeriesMap(p.mode === "ledger" ? [...symbols, bench] : []);
  const r = useMemo(() => {
    if (p.mode !== "ledger" || ser.loading) return null;
    const b = ser.series[bench];
    if (!b) return { ok: false as const, reason: `${bench} 일별 가격을 불러오지 못했습니다: ${ser.errors[bench] ?? "데이터 없음"}` };
    const missing = symbols.filter((s) => !ser.series[s]);
    if (missing.length) return { ok: false as const, reason: `${missing.join(", ")} 일별 가격이 없어 날짜별 평가를 할 수 없습니다.` };
    return personalPerformance({
      txns: p.ledger,
      calendar: b.dates,
      closeOf: (sym, d) => {
        const x = ser.series[sym];
        return x ? (closeOn(x, d)?.close ?? null) : null;
      },
      benchmark: b,
    });
    // symbols 는 p 에서 나온 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ser, bench]);

  if (p.mode === "simple")
    return (
      <Notice title="거래 내역 모드에서 계산합니다">
        시간가중수익률(TWR)과 금액가중수익률(XIRR)은 언제 얼마를 넣고 뺐는지(현금흐름) 기록이 있어야 계산할 수 있습니다. 간편 입력에는 그 기록이 없어 계산하지 않습니다. &lsquo;보유 종목 입력&rsquo; 탭에서 &lsquo;거래 내역 관리로 전환&rsquo;한 뒤 입금·매수 기록을 넣으세요.
      </Notice>
    );
  if (!r) return <div className="skeleton h-56" aria-label="성과 계산 중" />;
  if (!r.ok) return <Notice tone="warn" title="수익률을 계산할 수 없습니다">{r.reason}</Notice>;

  const b = r.benchmark;
  const okIdentity = Math.abs(r.identityDiff) < 0.01;
  return (
    <div className="flex flex-col gap-5">
      <Section title="투자 성과" description={`${r.start} ~ ${r.end} (${periodText(r.start, r.end)}) · 기준일 종가 · 달러 기준`}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <p className="text-xs font-semibold text-ink-2">시간가중수익률 (TWR)</p>
            <p className={`num mt-1 text-2xl font-bold ${tone(r.twrPct)}`}>{pct(r.twrPct)}</p>
            <p className="mt-0.5 text-xs text-muted">연환산 {r.twrAnnualPct !== null ? pct(r.twrAnnualPct) : "— (1년 미만은 연환산하지 않음)"}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">입금·출금의 크기와 시점 영향을 빼고, 고른 종목과 운용만의 성과입니다. 펀드·벤치마크와 비교할 때 씁니다.</p>
          </div>
          <div className="rounded-xl border border-line p-4">
            <p className="text-xs font-semibold text-ink-2">금액가중수익률 (XIRR, 연환산)</p>
            <p className={`num mt-1 text-2xl font-bold ${tone(r.xirrPct)}`}>{r.xirrPct !== null ? pct(r.xirrPct) : "계산 불가"}</p>
            <p className="mt-0.5 text-xs text-muted">총손익 <span className={tone(r.gain)}>{signedUsd(r.gain)}</span></p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">실제로 넣고 뺀 날짜·금액을 반영한 &lsquo;내 돈&rsquo;의 연 수익률입니다. 많이 넣은 뒤 오르면 TWR 보다 높고, 많이 넣은 뒤 내리면 낮습니다.{r.years < 1 ? " 기간이 짧으면 연환산 값이 크게 흔들립니다." : ""}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KV label="순납입 원금" value={usd(r.principal)} sub={`입금 ${usd(r.deposits)} − 출금 ${usd(r.withdrawals)}${r.openings ? ` + 기초 보유 ${usd(r.openings)}` : ""}`} />
          <KV label="현재 평가금액 (기준일 종가)" value={usd(r.value)} sub={`${r.end} 종가 · 현금 포함`} />
          <KV label="실현 손익" value={signedUsd(r.realized)} valueClass={tone(r.realized)} />
          <KV label="미실현 손익" value={signedUsd(r.unrealized)} valueClass={tone(r.unrealized)} />
          <KV label="누적 분배금 (세전)" value={usd(r.dividendsGross)} sub={`원천징수 ${usd(r.dividendsTax)}`} />
          <KV label="재투자한 분배금 (세후)" value={usd(r.dividendsReinvested)} sub="'분배금 재투자'로 기록한 금액" />
          <KV label="현금으로 받은 분배금 (세후)" value={usd(r.dividendsAsCash)} sub="'분배금 수령'으로 기록한 금액" />
          <KV label="투자 기간" value={periodText(r.start, r.end)} sub={`${r.start} 첫 기록부터`} />
        </div>
        <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${okIdentity ? "bg-surface-2 text-ink-2" : "bg-warn-soft text-warn"}`}>
          {okIdentity ? "검증 통과" : "검증 확인 필요"}: 총손익 {signedUsd(r.gain)} = 미실현 {signedUsd(r.unrealized)} + 실현 {signedUsd(r.realized)} + 세후 분배금 {usd(r.dividendsGross - r.dividendsTax)}
          {okIdentity ? " — 입금·출금은 수익에 들어가지 않았습니다." : ` (차이 ${usd(r.identityDiff)}) — 거래 내역에 확인할 항목이 있습니다.`}
        </p>
        {r.skippedDays > 0 && <p className="mt-2 text-[11px] text-muted">일부 종목의 가격이 없는 {r.skippedDays}거래일은 평가에서 빠졌습니다 (빈 날을 채우지 않음).</p>}
      </Section>

      <Section
        title="벤치마크와 비교"
        description="같은 날 같은 금액을 벤치마크(분배금 재투자)에 넣고 뺐다면"
        right={<Seg label="벤치마크" value={bench} onChange={setBench} options={BENCHES.map((x) => ({ v: x, l: x }))} />}
      >
        {b ? (
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th />
                  <th className="r">평가금액</th>
                  <th className="r">TWR</th>
                  <th className="r">TWR 연환산</th>
                  <th className="r">XIRR</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">내 계좌</td>
                  <td className="r">{usd(r.value)}</td>
                  <td className={`r ${tone(r.twrPct)}`}>{pct(r.twrPct)}</td>
                  <td className="r">{r.twrAnnualPct !== null ? pct(r.twrAnnualPct) : "-"}</td>
                  <td className="r">{r.xirrPct !== null ? pct(r.xirrPct) : "-"}</td>
                </tr>
                <tr>
                  <td className="font-semibold">{b.symbol}</td>
                  <td className="r">{usd(b.value)}</td>
                  <td className={`r ${tone(b.twrPct)}`}>{pct(b.twrPct)}</td>
                  <td className="r">{b.twrAnnualPct !== null ? pct(b.twrAnnualPct) : "-"}</td>
                  <td className="r">{b.xirrPct !== null ? pct(b.xirrPct) : "-"}</td>
                </tr>
                <tr className="text-ink-2">
                  <td>차이</td>
                  <td className={`r ${tone(r.value - b.value)}`}>{signedUsd(r.value - b.value)}</td>
                  <td className={`r ${tone(r.twrPct - b.twrPct)}`}>{pct(r.twrPct - b.twrPct)}p</td>
                  <td className="r">{r.twrAnnualPct !== null && b.twrAnnualPct !== null ? `${pct(r.twrAnnualPct - b.twrAnnualPct)}p` : "-"}</td>
                  <td className="r">{r.xirrPct !== null && b.xirrPct !== null ? `${pct(r.xirrPct - b.xirrPct)}p` : "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">{bench}의 가격 기록이 계좌 기간을 덮지 않아 비교하지 않았습니다.</p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">벤치마크는 입금일(휴장일이면 다음 거래일) 종가로 사고 배당락일 종가로 분배금을 재투자했다고 가정했습니다. 세금·수수료·환율은 반영하지 않았습니다. 과거 성과 비교이며 앞으로의 결과를 뜻하지 않습니다.</p>
      </Section>
    </div>
  );
}
