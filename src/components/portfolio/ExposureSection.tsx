"use client";
/** 내 자산 → 노출 분석: ETF 상위 편입 종목 기준 간접 노출·ETF 간 중복·섹터·유형·레버리지·대형 기술주 집중도 */
import { useEffect, useMemo, useState } from "react";
import { INSTRUMENTS } from "@/config/instruments";
import { fetchExposure } from "@/lib/client/data-api";
import type { PortfolioSummary } from "@/lib/client/portfolio-summary";
import type { ExposureResponse } from "@/lib/exposure-types";
import { portfolioExposure } from "@/lib/portfolio/exposure";
import { formatEt, relativeTime } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import { KV, usd } from "@/components/sim/common";
import { WeightBars } from "@/components/sim/charts";
import EtfChanges from "./EtfChanges";

const M7 = INSTRUMENTS.filter((i) => i.category === "m7").map((i) => i.symbol);
const STALE_DAYS = 7;
const p1 = (v: number) => `${v.toFixed(1)}%`;

export default function ExposureSection({ s }: { s: PortfolioSummary }) {
  const [data, setData] = useState<{ res: ExposureResponse | null; error: string | null }>({ res: null, error: null });
  useEffect(() => {
    let alive = true;
    fetchExposure()
      .then((res) => alive && setData({ res, error: null }))
      .catch((e) => alive && setData({ res: null, error: String((e as Error).message ?? e) }));
    return () => {
      alive = false;
    };
  }, []);

  const held = s.holdings.filter((h) => h.shares > 0);
  const positions = useMemo(() => held.filter((h) => h.value !== null).map((h) => ({ symbol: h.symbol, value: h.value as number })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.holdings],
  );
  const r = useMemo(() => {
    if (!data.res || s.loading) return null;
    return portfolioExposure({
      positions,
      cash: s.cash,
      info: data.res.items,
      now: Date.now(),
      staleDays: STALE_DAYS,
      m7Symbols: M7,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.res, s.holdings, s.cash, s.loading]);

  if (data.error) return <Notice tone="critical" title="편입 종목 자료를 불러오지 못했습니다">{data.error} — 노출을 계산하지 않았습니다.</Notice>;
  if (!r) return <div className="skeleton h-56" aria-label="노출 계산 중" />;
  if (!(r.invested > 0)) return <Notice title="평가금액이 있는 보유 종목이 없습니다">현재가가 있는 보유 종목이 있어야 노출을 계산합니다.</Notice>;

  const top = r.lookthrough.slice(0, 15);
  return (
    <div className="flex flex-col gap-5">
      {s.missingPrices.length > 0 && (
        <Notice tone="warn" title="현재가가 없는 종목은 빠졌습니다">
          {s.missingPrices.join(", ")} — 평가금액을 알 수 없어 노출 계산에서 뺐습니다.
        </Notice>
      )}
      {(r.staleInfo.length > 0 || r.missingInfo.length > 0) && (
        <Notice tone="warn" title="오래되었거나 없는 자료가 있습니다">
          {r.staleInfo.length > 0 && <>편입·섹터 자료를 {STALE_DAYS}일 넘게 새로 받지 못한 종목: {r.staleInfo.join(", ")} (최신 구성과 다를 수 있음). </>}
          {r.missingInfo.length > 0 && <>편입 자료가 없는 종목: {r.missingInfo.join(", ")}.</>}
        </Notice>
      )}

      <Section title="한눈에" description={`투자 평가금액 ${usd(r.invested)} 기준 (현금 ${usd(r.cash)} 제외) · ETF 는 제공처가 준 상위 편입 종목만 반영`}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KV label="종목까지 확인한 비율" value={p1(r.knownPct)} sub="직접 보유 주식 + ETF 상위 편입 종목. 나머지는 알 수 없어 추정하지 않음" />
          <KV label="M7 대형 기술주 노출 (최소)" value={p1(r.m7.pct)} sub={`직접 ${usd(r.m7.direct)} + ETF 경유 ${usd(r.m7.indirect)}`} />
          <KV label="레버리지 ETF 비중" value={p1(r.leveraged.pct)} sub={r.leveraged.items.length ? `배수 반영 실질 노출 ${usd(r.leveraged.effective)} (${r.leveraged.items.map((x) => `${x.symbol} ${x.leverage}배`).join(", ")})` : "보유 없음"} />
          <KV label="가장 큰 ETF 간 중복" value={r.overlaps[0] ? p1(r.overlaps[0].overlapPct) : "-"} sub={r.overlaps[0] ? `${r.overlaps[0].a} ↔ ${r.overlaps[0].b} (상위 편입 기준)` : "비교할 ETF 가 2개 미만"} />
        </div>
      </Section>

      <Section title="같은 종목에 대한 실제 노출" description="직접 보유 + ETF 를 통해 간접적으로 갖고 있는 금액 (ETF 상위 편입 종목 기준이라 실제보다 작을 수 있음)">
        {top.length ? (
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[600px]">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">직접 보유</th>
                  <th className="min-w-[200px]">ETF 경유</th>
                  <th className="r">합계</th>
                  <th className="r">투자금 대비</th>
                </tr>
              </thead>
              <tbody>
                {top.map((x) => (
                  <tr key={x.symbol}>
                    <td>
                      <span className="font-semibold">{x.symbol}</span>
                      {x.name !== x.symbol && <span className="ml-1 text-xs text-muted">{x.name}</span>}
                    </td>
                    <td className="r">{x.direct ? usd(x.direct) : "-"}</td>
                    <td className="text-xs text-ink-2">{x.via.length ? x.via.map((v) => `${v.etf} ${usd(v.amount)}`).join(" · ") : "-"}</td>
                    <td className="r font-semibold">{usd(x.total)}</td>
                    <td className="r">{p1(x.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">편입 종목으로 펼칠 수 있는 보유 종목이 없습니다.</p>
        )}
        {r.lookthrough.length > top.length && <p className="mt-1 text-[11px] text-muted">상위 {top.length}개만 표시 (전체 {r.lookthrough.length}개)</p>}
        <p className="mt-1 text-[11px] text-muted">M7 대형 기술주: {M7.join("·")} (알파벳은 A·C 두 종류 주식).</p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="섹터" description={`ETF 는 제공처 섹터 비중, 주식은 기업 섹터${r.sectorUnknownPct > 0.05 ? ` · 미분류 ${p1(r.sectorUnknownPct)}` : ""}`}>
          {r.sectors.length ? (
            <WeightBars items={[...r.sectors.map((x) => ({ label: x.sector, value: x.value })), ...(r.sectorUnknownPct > 0.05 ? [{ label: "미분류·자료 없음", value: (r.invested * r.sectorUnknownPct) / 100 }] : [])]} />
          ) : (
            <p className="text-sm text-muted">섹터 자료가 있는 보유 종목이 없습니다.</p>
          )}
          <p className="mt-2 text-[11px] text-muted">레버리지 ETF 는 배수를 곱하지 않은 평가금액으로 넣었습니다. 섹터 분류는 제공처 기준입니다.</p>
        </Section>
        <Section title="유형별 비중" description="이 사이트의 종목 분류 기준 (성장형 = 대형 기술주·반도체/기술)">
          <WeightBars items={r.styles.map((x) => ({ label: x.label, value: x.value }))} />
        </Section>
      </div>

      {r.overlaps.length > 0 && (
        <Section title="ETF 끼리 겹치는 정도" description="두 ETF 상위 편입 종목 중 같은 종목 비중의 작은 쪽을 더한 값 — 전체 보유 내역 기준이 아님">
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>ETF 쌍</th>
                  <th className="r">중복도</th>
                  <th>겹치는 종목</th>
                </tr>
              </thead>
              <tbody>
                {r.overlaps.slice(0, 12).map((o) => (
                  <tr key={o.a + o.b}>
                    <td className="font-semibold">
                      {o.a} ↔ {o.b}
                    </td>
                    <td className="r">{p1(o.overlapPct)}</td>
                    <td className="text-xs text-ink-2">{o.common.length ? o.common.join(", ") : "상위 편입 중 겹치는 종목 없음"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="ETF 별 상위 편입 종목" description="제공처가 준 목록 그대로 (보통 상위 10개)">
        <div className="grid gap-3 md:grid-cols-2">
          {r.etfs.map((e) => (
            <div key={e.symbol} className="rounded-xl border border-line p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {e.symbol} <span className="text-xs font-normal text-muted">투자금의 {p1(e.pct)}</span>
                </p>
                <p className={`text-[11px] ${e.stale ? "text-warn" : "text-muted"}`}>
                  {e.fetchedAt ? `${formatEt(e.fetchedAt)} 수집 (${relativeTime(e.fetchedAt)})` : "수집 기록 없음"}
                  {e.source ? ` · ${e.source}` : ""}
                </p>
              </div>
              {e.reason && <p className="mt-1 text-xs text-warn">{e.reason}</p>}
              {e.holdings.length > 0 ? (
                <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {e.holdings.map((h, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {h.symbol ?? h.name}
                        {h.fund && <span className="ml-1 text-[10px] text-muted">펀드</span>}
                      </span>
                      <span className="num text-ink-2">{h.weight.toFixed(2)}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                !e.reason && <p className="mt-1 text-xs text-muted">편입 종목 자료 미제공</p>
              )}
              {e.used && <p className="mt-1 text-[11px] text-muted">상위 편입 합계 {p1(e.coveredPct)} — 나머지 {p1(Math.max(0, 100 - e.coveredPct))}는 확인 못 함</p>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">편입 비중은 운용사가 공시한 시점 기준이며 제공처가 공시 기준일을 주지 않아 수집 시각만 표시합니다. 같은 회사의 다른 주식 종류(GOOGL·GOOG 등)는 제공처 표기대로 따로 셉니다.</p>
      </Section>
      {data.res && <EtfChanges positions={positions} info={data.res.items} m7={M7} />}
    </div>
  );
}
