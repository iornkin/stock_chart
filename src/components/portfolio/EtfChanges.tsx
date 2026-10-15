"use client";
/** 노출 분석 → ETF 구성 변화: 이 사이트가 쌓은 구성 기록끼리 비교 (기록 전의 변화는 알 수 없음) */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchEtfHistory } from "@/lib/client/data-api";
import { FREQUENCY_KO } from "@/lib/dividend-analytics";
import { baselineRecord, compareCompositions, type CompositionDiff, type EtfHistoryResponse } from "@/lib/etf-history";
import type { ExposureInfo } from "@/lib/exposure-types";
import { portfolioExposure } from "@/lib/portfolio/exposure";
import { addDays, etDate } from "@/lib/time";
import { Section } from "@/components/ui";
import { Seg, usd } from "@/components/sim/common";

const PERIODS = [
  { v: 31, l: "1개월" },
  { v: 92, l: "3개월" },
  { v: 365, l: "1년" },
  { v: 0, l: "기록 전체" },
];
const pp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%p`;

export default function EtfChanges({ positions, info, m7 }: { positions: { symbol: string; value: number }[]; info: Record<string, ExposureInfo>; m7: string[] }) {
  const [hist, setHist] = useState<{ res: EtfHistoryResponse | null; error: string | null }>({ res: null, error: null });
  const [days, setDays] = useState(92);
  useEffect(() => {
    let alive = true;
    fetchEtfHistory()
      .then((res) => alive && setHist({ res, error: null }))
      .catch((e) => alive && setHist({ res: null, error: String((e as Error).message ?? e) }));
    return () => {
      alive = false;
    };
  }, []);
  const etfs = useMemo(() => positions.filter((p) => info[p.symbol]?.kind === "etf"), [positions, info]);
  const base = days ? addDays(etDate(), -days) : "0000-01-01";

  const calc = useMemo(() => {
    if (!hist.res) return null;
    const per = etfs.map((p) => {
      const item = hist.res?.items[p.symbol];
      const records = item?.records ?? [];
      const latest = records.length ? records[records.length - 1] : null;
      const b = baselineRecord(records, base);
      return { symbol: p.symbol, records, latest, diff: b && latest ? compareCompositions(b, latest) : null, distribution: item?.distribution ?? null };
    });
    // 구성 변화만 반영한 간접 노출 변화: 같은 평가금액에 기준 시점 구성 vs 지금 구성
    const withBase = per.filter((x) => x.diff);
    let look: { symbol: string; before: number; after: number; diff: number }[] = [];
    let overlaps: { pair: string; before: number; after: number; diff: number }[] = [];
    if (withBase.length) {
      const oldInfo: Record<string, ExposureInfo> = { ...info };
      for (const x of per) {
        const recs = x.records;
        const b = baselineRecord(recs, base);
        if (b) oldInfo[x.symbol] = { ...info[x.symbol], holdings: b.holdings.map((h) => ({ ...h, fund: info[x.symbol]?.holdings.find((k) => (k.symbol ?? k.name) === (h.symbol ?? h.name))?.fund ?? false })), sectors: b.sectors };
      }
      const cur: Record<string, ExposureInfo> = { ...info };
      for (const x of per) if (x.latest && x.diff) cur[x.symbol] = { ...info[x.symbol], holdings: x.latest.holdings.map((h) => ({ ...h, fund: info[x.symbol]?.holdings.find((k) => (k.symbol ?? k.name) === (h.symbol ?? h.name))?.fund ?? false })), sectors: x.latest.sectors };
      const args = { positions, cash: 0, now: Date.now(), m7Symbols: m7 };
      const before = portfolioExposure({ ...args, info: oldInfo });
      const after = portfolioExposure({ ...args, info: cur });
      const b = new Map(before.lookthrough.map((r) => [r.symbol, r.pct]));
      const a = new Map(after.lookthrough.map((r) => [r.symbol, r.pct]));
      look = [...new Set([...b.keys(), ...a.keys()])]
        .map((s) => ({ symbol: s, before: b.get(s) ?? 0, after: a.get(s) ?? 0, diff: (a.get(s) ?? 0) - (b.get(s) ?? 0) }))
        .filter((r) => Math.abs(r.diff) >= 0.05)
        .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
        .slice(0, 10);
      const key = (o: { a: string; b: string }) => [o.a, o.b].sort().join(" ↔ ");
      const ob = new Map(before.overlaps.map((o) => [key(o), o.overlapPct]));
      const oa = new Map(after.overlaps.map((o) => [key(o), o.overlapPct]));
      overlaps = [...new Set([...ob.keys(), ...oa.keys()])]
        .map((k) => ({ pair: k, before: ob.get(k) ?? 0, after: oa.get(k) ?? 0, diff: (oa.get(k) ?? 0) - (ob.get(k) ?? 0) }))
        .filter((r) => Math.abs(r.diff) >= 0.05)
        .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    }
    return { per, look, overlaps, anyDiff: withBase.length > 0 };
  }, [hist.res, etfs, info, positions, m7, base]);

  if (!etfs.length) return null;
  return (
    <Section
      title="ETF 구성 변화 (기록 기준)"
      description="제공처는 지금 구성만 알려 주므로, 이 사이트가 자료를 받을 때마다 저장한 기록끼리 비교합니다. 기록을 시작하기 전의 변화는 알 수 없어 보여 주지 않습니다."
      right={<Seg label="비교 기간" value={days} onChange={setDays} options={PERIODS} />}
    >
      {hist.error ? (
        <p className="text-sm text-critical">구성 기록을 불러오지 못했습니다: {hist.error}</p>
      ) : !calc ? (
        <div className="skeleton h-24" />
      ) : (
        <div className="flex flex-col gap-4">
          {calc.anyDiff && (calc.look.length > 0 || calc.overlaps.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {calc.look.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="mb-1 text-xs font-semibold text-ink-2">구성 변화로 달라진 종목별 간접 노출 (지금 평가금액 기준, 투자금 대비)</p>
                  <table className="table-basic">
                    <thead>
                      <tr>
                        <th>종목</th>
                        <th className="r">기준 시점 구성</th>
                        <th className="r">지금 구성</th>
                        <th className="r">변화</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.look.map((r) => (
                        <tr key={r.symbol}>
                          <td className="font-semibold">{r.symbol}</td>
                          <td className="r num">{r.before.toFixed(2)}%</td>
                          <td className="r num">{r.after.toFixed(2)}%</td>
                          <td className={`r num ${r.diff > 0 ? "text-warn" : "text-ink-2"}`}>{pp(r.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {calc.overlaps.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="mb-1 text-xs font-semibold text-ink-2">ETF 간 중복 변화 (상위 편입 기준)</p>
                  <table className="table-basic">
                    <thead>
                      <tr>
                        <th>ETF</th>
                        <th className="r">기준 시점</th>
                        <th className="r">지금</th>
                        <th className="r">변화</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.overlaps.map((r) => (
                        <tr key={r.pair}>
                          <td>{r.pair}</td>
                          <td className="r num">{r.before.toFixed(1)}%</td>
                          <td className="r num">{r.after.toFixed(1)}%</td>
                          <td className={`r num ${r.diff > 0 ? "text-warn" : "text-ink-2"}`}>{pp(r.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {calc.per.map((x) => (
              <div key={x.symbol} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-semibold">
                  {x.symbol}{" "}
                  <span className="text-[11px] font-normal text-muted">
                    {x.records.length ? `기록 ${x.records.length}건 · ${x.records[0].date} ~ ${x.records[x.records.length - 1].date}` : "아직 기록 없음"}
                  </span>
                </p>
                {x.diff ? <DiffView d={x.diff} /> : <p className="mt-1 text-xs text-muted">{x.records.length ? "비교할 이전 기록이 없습니다. 다음 기록부터 변화를 보여 줍니다." : "다음 데이터 갱신 때부터 구성을 기록합니다."}</p>}
                {x.distribution && (
                  <p className={`mt-2 text-xs ${x.distribution.now !== x.distribution.yearAgo ? "font-semibold text-warn" : "text-ink-2"}`} title={`지금: ${x.distribution.nowBasis} / 1년 전: ${x.distribution.yearAgoBasis}`}>
                    분배 주기 (실제 지급 기록): {x.distribution.now !== x.distribution.yearAgo ? `1년 전 기준 ${FREQUENCY_KO[x.distribution.yearAgo]} → 지금 ${FREQUENCY_KO[x.distribution.now]}` : `${FREQUENCY_KO[x.distribution.now]} (1년 전과 같음)`}
                  </p>
                )}
                {info[x.symbol]?.leverage && (
                  <p className="mt-1 text-[11px] text-warn">
                    일일 {info[x.symbol].leverage}배 상품 — 매일 배수를 다시 맞춰 장기 수익률이 기초 지수 × 배수와 다릅니다.{" "}
                    <Link href="/leverage" className="underline">
                      레버리지 분석
                    </Link>
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            비교 기준: 고른 기간 이전 기록 중 가장 최근 것 (없으면 가장 오래된 기록). 상위 편입 종목(보통 10개)만 비교하므로 그 밖의 변화는 알 수 없습니다. 추종 지수·운용 방식 변경은 제공처가 구조화된 자료를 주지 않아 자동으로 확인하지 않습니다 — 제공처 분류(예: Large Growth)가 바뀌면 표시합니다. 금액 {usd(positions.reduce((a, p) => a + p.value, 0), 0)} 기준.
          </p>
        </div>
      )}
    </Section>
  );
}

function DiffView({ d }: { d: CompositionDiff }) {
  const moved = d.holdings.filter((h) => h.status !== "same");
  const secs = d.sectors.filter((s) => Math.abs(s.diff) >= 0.5).slice(0, 4);
  return (
    <div className="mt-1 text-xs">
      <p className="text-ink-2">
        {d.from} → {d.to} · 상위 편입 합계 {d.topSumBefore.toFixed(1)}% → {d.topSumAfter.toFixed(1)}%
      </p>
      {moved.length === 0 && secs.length === 0 && !d.expense && !d.category ? (
        <p className="mt-1 text-muted">의미 있는 구성 변화 없음 (편입 종목 같고 비중 변화 0.05%p 미만)</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {moved.slice(0, 6).map((h) => (
            <li key={h.key} className="flex justify-between gap-2">
              <span className="truncate">
                {h.symbol ?? h.name}
                {h.status === "new" && <span className="ml-1 rounded bg-accent-soft px-1 text-[10px] text-accent">새로 편입</span>}
                {h.status === "gone" && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px] text-muted">상위에서 빠짐</span>}
              </span>
              <span className="num text-ink-2">
                {h.before !== null ? `${h.before.toFixed(2)}%` : "-"} → {h.after !== null ? `${h.after.toFixed(2)}%` : "-"}
              </span>
            </li>
          ))}
          {moved.length > 6 && <li className="text-muted">외 {moved.length - 6}개</li>}
          {secs.length > 0 && <li className="text-ink-2">섹터: {secs.map((s) => `${s.sector} ${pp(s.diff)}`).join(", ")}</li>}
          {d.expense && (
            <li className="font-semibold text-warn">
              총보수 {d.expense.before !== null ? `${d.expense.before.toFixed(2)}%` : "-"} → {d.expense.after !== null ? `${d.expense.after.toFixed(2)}%` : "-"}
            </li>
          )}
          {d.category && (
            <li className="font-semibold text-warn">
              제공처 분류 {d.category.before ?? "-"} → {d.category.after ?? "-"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
