"use client";
/** 투자 위험 예산 — 시나리오별 예상 손실을 내가 정한 최대 손실 기준과 비교 */
import { useEffect, useMemo, useState } from "react";
import { useIncome, useSeriesMap } from "@/lib/client/user-data";
import { fetchExposure } from "@/lib/client/data-api";
import type { ExposureResponse } from "@/lib/exposure-types";
import { getInstrument } from "@/lib/instruments";
import { episodeImpact, estimateBeta, findEpisodes } from "@/lib/sim/stress";
import { annualVol, compareToLimit, dividendAndPrice, holdingSectors, leveragedCrash, limitUsd, marketShock, rateSensitivity, rateShock, recentMdd, riskContributions, sectorShock, type RateSensitivity, type ScenarioResult } from "@/lib/sim/risk-budget";
import { Fold, Notice, Section } from "@/components/ui";
import { Disclaimer, Field, parseNum, pct, Seg, usd } from "./common";

interface Pos {
  symbol: string;
  value: number;
  shares: number;
  price: number;
}

const TECH = ["기술", "커뮤니케이션"];

interface WorstEpisode {
  name: string;
  mdd: number;
  peak: string;
  trough: string;
}

interface Row {
  key: string;
  label: string;
  assumption: string;
  kind: "실제 기록" | "가정" | "과거 관계 추정";
  r: ScenarioResult | null;
  /** 계산하지 못한 이유 */
  na?: string;
  extra?: string;
}

export default function RiskBudget({ positions }: { positions: Pos[] }) {
  const [limitKind, setLimitKind] = useState<"pct" | "usd">("pct");
  const [limitStr, setLimitStr] = useState("20");
  const [mkt, setMkt] = useState("20");
  const [tech, setTech] = useState("30");
  const [sector, setSector] = useState("");
  const [sectorShockStr, setSectorShockStr] = useState("30");
  const [levDrop, setLevDrop] = useState("15");
  const [cut, setCut] = useState("30");
  const [cutMkt, setCutMkt] = useState("20");
  const [rise, setRise] = useState("1");
  const [tax, setTax] = useState("15");
  const [exp, setExp] = useState<ExposureResponse | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchExposure()
      .then((x) => alive && setExp(x))
      .catch(() => alive && setExp(null));
    return () => {
      alive = false;
    };
  }, []);
  const income = useIncome();
  const syms = positions.map((p) => p.symbol);
  const ser = useSeriesMap([...syms, "^GSPC", "^TNX"]);
  const total = positions.reduce((a, p) => a + p.value, 0);

  const base = useMemo(() => {
    const idx = ser.series["^GSPC"];
    const tnx = ser.series["^TNX"];
    const info = exp?.items ?? {};
    const rows = positions.map((p) => {
      const x = ser.series[p.symbol];
      const inst = getInstrument(p.symbol);
      const beta = x && idx ? estimateBeta(x, idx, 756) : null;
      const sens = x && tnx ? rateSensitivity(x, tnx, 10) : null;
      return {
        ...p,
        weightPct: total > 0 ? (p.value / total) * 100 : 0,
        leverage: inst?.leverage ?? null,
        beta: beta?.beta ?? null,
        vol: x ? annualVol(x, 756) : null,
        mdd: x ? recentMdd(x, 2520) : null,
        sectors: holdingSectors(p.symbol, info, inst?.benchmarks ?? []),
        sens: sens && !("error" in sens) ? sens : null,
        sensError: sens && "error" in sens ? sens.error : x ? (tnx ? null : "10년물 금리 데이터 없음") : "가격 기록 없음",
        annualIncome: p.shares * (income.data?.items[p.symbol]?.ttmPerShare ?? 0),
      };
    });
    const rc = riskContributions(positions, ser.series, 756);
    // 과거 실제 하락 구간 중 포트폴리오 낙폭이 가장 컸던 구간 (모든 종목 데이터가 있는 구간만)
    let worst = null as WorstEpisode | null;
    let worstNa: string | null = null;
    if (idx) {
      const eps = findEpisodes(idx, 15);
      const weights = positions.map((p) => ({ symbol: p.symbol, weight: total > 0 ? (p.value / total) * 100 : 0 }));
      const end = idx.dates[idx.dates.length - 1];
      for (const e of eps) {
        const im = episodeImpact(e, weights, ser.series, end);
        if (im.portfolioMddPct !== null && (!worst || im.portfolioMddPct < worst.mdd)) worst = { name: e.name ?? `${e.peak.slice(0, 7)} 하락`, mdd: im.portfolioMddPct, peak: e.peak, trough: e.trough };
      }
      if (!worst) worstNa = eps.length ? "모든 종목의 데이터가 있는 과거 하락 구간이 없습니다 (상장 전 종목 포함)" : "기준 하락 구간이 데이터에 없습니다";
    }
    const sectorList = [...new Set(rows.flatMap((r) => Object.keys(r.sectors.weights)))].sort((a, b) => {
      const w = (s: string) => rows.reduce((acc, r) => acc + r.value * (r.sectors.weights[s] ?? 0) * r.sectors.leverage, 0);
      return w(b) - w(a);
    });
    return { rows, rc, worst, worstNa, sectorList, hasIdx: !!idx, hasTnx: !!tnx };
  }, [positions, ser.series, exp, income.data, total]);

  if (ser.loading || exp === undefined || income.loading) return <div className="skeleton h-40" />;

  const limitVal = parseNum(limitStr);
  const limit = Number.isFinite(limitVal) && limitVal > 0 ? limitUsd({ kind: limitKind, value: limitVal }, total) : null;
  const num = (s: string, d: number) => (Number.isFinite(parseNum(s)) ? parseNum(s) : d);
  const sel = sector || base.sectorList[0] || "";
  const dp = dividendAndPrice(base.rows, num(cut, 30), num(cutMkt, 20), num(tax, 15));
  const levRows = base.rows.filter((r) => r.leverage);
  const scen: Row[] = [
    { key: "mkt", label: `시장 하락 (S&P 500 −${num(mkt, 20)}%)`, assumption: "종목별 최근 3년 베타 × 하락률", kind: "가정", r: base.hasIdx ? marketShock(base.rows, num(mkt, 20)) : null, na: "S&P 500 데이터 없음" },
    base.worst
      ? { key: "worst", label: `과거 최악의 실제 하락 (${base.worst.name})`, assumption: `${base.worst.peak} → ${base.worst.trough} 실제 총수익률, 지금 비중으로 보유했다면`, kind: "실제 기록", r: { low: (-base.worst.mdd / 100) * total, high: (-base.worst.mdd / 100) * total, perHolding: [], excluded: [] } }
      : { key: "worst", label: "과거 최악의 실제 하락", assumption: "S&P 500 고점 대비 15% 이상 하락 구간", kind: "실제 기록", r: null, na: base.worstNa ?? "데이터 없음" },
    { key: "tech", label: `기술주 전체 하락 (−${num(tech, 30)}%)`, assumption: "기술·커뮤니케이션 섹터만 하락, 나머지 그대로", kind: "가정", r: exp ? sectorShock(base.rows, TECH, num(tech, 30)) : null, na: "섹터 정보를 불러오지 못함" },
    sel
      ? { key: "sector", label: `${sel} 섹터 하락 (−${num(sectorShockStr, 30)}%)`, assumption: `${sel} 섹터만 하락, 나머지 그대로`, kind: "가정", r: sectorShock(base.rows, [sel], num(sectorShockStr, 30)) }
      : { key: "sector", label: "특정 섹터 하락", assumption: "-", kind: "가정", r: null, na: "섹터 정보 없음" },
    levRows.length
      ? { key: "lev", label: `레버리지 ETF 급락 (기초 지수 하루 −${num(levDrop, 15)}%)`, assumption: "레버리지 ETF 만 배수만큼 하락, 다른 종목 그대로", kind: "가정", r: leveragedCrash(base.rows, num(levDrop, 15)) }
      : { key: "lev", label: "레버리지 ETF 급락", assumption: "-", kind: "가정", r: null, na: "레버리지 ETF 보유 없음 — 해당 없음" },
    { key: "divprice", label: `분배금 −${num(cut, 30)}% + 시장 −${num(cutMkt, 20)}%`, assumption: "가격 손실은 베타 적용, 분배금은 최근 12개월 실제 지급액 기준", kind: "가정", r: base.hasIdx ? dp.price : null, na: "S&P 500 데이터 없음", extra: `연 분배금 ${usd(dp.incomeBefore, 0)} → ${usd(dp.incomeAfter, 0)} (세후 −${usd(dp.incomeDropNet, 0)}/년)` },
    { key: "rate", label: `장기 금리 상승 (10년물 +${num(rise, 1)}%p)`, assumption: "최근 10년 월간 총수익률과 금리 변화의 과거 관계 (± 표준오차)", kind: "과거 관계 추정", r: base.hasTnx ? rateShock(base.rows, num(rise, 1)) : null, na: "10년물 금리 데이터 없음" },
  ];
  const statusOf = (r: ScenarioResult) => (limit === null ? null : compareToLimit(r.low, r.high, limit));
  const over = scen.filter((s) => s.r && statusOf(s.r) === "over").length;
  const partly = scen.filter((s) => s.r && statusOf(s.r) === "partly").length;
  const lossText = (r: ScenarioResult) => (Math.abs(r.high - r.low) < 0.5 ? usd(-r.low, 0) : `${usd(-r.low, 0)} ~ ${usd(-r.high, 0)}`);
  const pctText = (r: ScenarioResult) => (total <= 0 ? "-" : Math.abs(r.high - r.low) < 0.5 ? pct((-r.low / total) * 100, 1) : `${pct((-r.low / total) * 100, 1)} ~ ${pct((-r.high / total) * 100, 1)}`);
  const cls = (r: ScenarioResult) => (r.high > 0.5 ? "text-down" : r.high < -0.5 ? "text-up" : "text-muted");
  const top = (r: ScenarioResult) =>
    [...r.perHolding]
      .sort((a, b) => b.high - a.high)
      .filter((h) => h.high > 0.5)
      .slice(0, 2)
      .map((h) => `${h.symbol} ${Math.abs(h.high - h.low) < 0.5 ? usd(-h.high, 0) : `${usd(-h.low, 0)}~${usd(-h.high, 0)}`}`)
      .join(", ");

  return (
    <>
      <Section title="2. 내가 감당할 수 있는 최대 손실" description="기준을 정하면 아래 시나리오마다 그 기준을 넘는지 보여 줍니다.">
        <div className="flex flex-wrap items-end gap-3">
          <Seg label="기준 단위" value={limitKind} onChange={setLimitKind} options={[{ v: "pct", l: "평가금액의 %" }, { v: "usd", l: "금액 (USD)" }]} />
          <Field label={limitKind === "pct" ? "최대 손실 (%)" : "최대 손실 (USD)"}>
            <input className="input w-32" inputMode="decimal" value={limitStr} onChange={(e) => setLimitStr(e.target.value)} aria-label="최대 손실 기준" />
          </Field>
          <p className="pb-2 text-sm">
            평가금액 {usd(total, 0)} 기준 → 손실 한도 <span className="num font-semibold">{limit !== null ? usd(limit, 0) : "-"}</span>
          </p>
        </div>
        {limit !== null && (
          <p className={`mt-3 text-sm font-semibold ${over ? "text-critical" : partly ? "text-warn" : "text-good"}`}>
            {over ? `시나리오 ${over}개에서 기준을 넘습니다.` : partly ? `범위 상단이 기준을 넘는 시나리오가 ${partly}개 있습니다.` : "계산한 시나리오 모두 기준 안입니다."}
            {over > 0 && partly > 0 && ` (범위 상단만 넘는 시나리오 ${partly}개 더)`}
          </p>
        )}
      </Section>

      <Section title="3. 시나리오별 예상 손실" description="손실은 음수로 표시합니다. 범위는 섹터 정보가 없는 부분(또는 금리 관계의 오차)을 반영한 값입니다.">
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>시나리오</th>
                <th className="r">예상 손익</th>
                <th className="r">손익률</th>
                <th>기준 대비</th>
                <th>손실이 큰 종목</th>
              </tr>
            </thead>
            <tbody>
              {scen.map((s) => {
                const st = s.r ? statusOf(s.r) : null;
                return (
                  <tr key={s.key}>
                    <td>
                      <p className="font-semibold">{s.label}</p>
                      <p className="text-[11px] text-muted">
                        <span className="mr-1 rounded bg-surface-2 px-1">{s.kind}</span>
                        {s.assumption}
                      </p>
                      {s.r && s.r.excluded.length > 0 && <p className="text-[11px] text-warn">계산에서 뺀 종목: {s.r.excluded.join(", ")} (데이터 부족)</p>}
                      {s.extra && s.r && <p className="text-[11px] text-ink-2">{s.extra}</p>}
                    </td>
                    {s.r ? (
                      <>
                        <td className={`r num ${cls(s.r)}`}>{lossText(s.r)}</td>
                        <td className={`r num ${cls(s.r)}`}>{pctText(s.r)}</td>
                        <td className="whitespace-nowrap text-sm">{st === null ? "-" : st === "over" ? <span className="font-semibold text-critical">초과</span> : st === "partly" ? <span className="font-semibold text-warn">범위 상단 초과</span> : <span className="text-good">기준 안</span>}</td>
                        <td className="text-xs text-ink-2">{top(s.r) || "-"}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="text-xs text-muted">
                        {s.na}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Fold summary="가정 바꾸기">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="시장 하락 (%)">
              <input className="input w-20" inputMode="decimal" value={mkt} onChange={(e) => setMkt(e.target.value)} aria-label="시장 하락률" />
            </Field>
            <Field label="기술주 하락 (%)">
              <input className="input w-20" inputMode="decimal" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="기술주 하락률" />
            </Field>
            <Field label="특정 섹터">
              <select className="input" value={sel} onChange={(e) => setSector(e.target.value)} aria-label="특정 섹터">
                {base.sectorList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="그 섹터 하락 (%)">
              <input className="input w-20" inputMode="decimal" value={sectorShockStr} onChange={(e) => setSectorShockStr(e.target.value)} aria-label="섹터 하락률" />
            </Field>
            <Field label="레버리지 기초 지수 하루 하락 (%)">
              <input className="input w-20" inputMode="decimal" value={levDrop} onChange={(e) => setLevDrop(e.target.value)} aria-label="레버리지 기초 지수 하락률" />
            </Field>
            <Field label="분배금 감소 (%)">
              <input className="input w-20" inputMode="decimal" value={cut} onChange={(e) => setCut(e.target.value)} aria-label="분배금 감소율" />
            </Field>
            <Field label="그때 시장 하락 (%)">
              <input className="input w-20" inputMode="decimal" value={cutMkt} onChange={(e) => setCutMkt(e.target.value)} aria-label="동시 시장 하락률" />
            </Field>
            <Field label="분배금 세금 (%)">
              <input className="input w-20" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="위험 예산 분배금 세금" />
            </Field>
            <Field label="10년물 금리 상승 (%p)">
              <input className="input w-20" inputMode="decimal" value={rise} onChange={(e) => setRise(e.target.value)} aria-label="금리 상승폭" />
            </Field>
          </div>
        </Fold>
      </Section>

      <Section title="4. 종목별 비중과 위험 요인" description="모두 실제 과거 일간 가격(분배금 포함)으로 계산한 값입니다. 앞으로도 같다는 뜻은 아닙니다.">
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th className="r">비중</th>
                <th className="r" title="최근 3년 일간 총수익률의 연환산 표준편차">변동성 (연)</th>
                <th className="r" title="최근 3년, S&P 500 이 1% 움직일 때 평균적으로 움직인 비율">베타</th>
                <th className="r" title="최근 10년(상장 후 기간이 짧으면 그 기간) 총수익 기준 최대 낙폭">최대 낙폭</th>
                <th className="r" title="전체 변동성 중 이 종목이 차지하는 몫 (비중과 다른 종목과의 상관을 함께 반영)">위험 기여</th>
                <th>주요 섹터</th>
                <th className="r" title="10년물 금리가 1%p 오른 달에 평균적으로 움직인 비율 (최근 10년 월간)">금리 +1%p 때</th>
              </tr>
            </thead>
            <tbody>
              {base.rows.map((r) => {
                const topSec = Object.entries(r.sectors.weights).sort((a, b) => b[1] - a[1])[0];
                const rcShare = "error" in base.rc ? null : (base.rc.share[r.symbol] ?? null);
                return (
                  <tr key={r.symbol}>
                    <td>
                      <span className="font-semibold">{r.symbol}</span>
                      {r.leverage && <span className="ml-1 rounded bg-warn-soft px-1 text-[10px] text-warn">일일 {r.leverage}배</span>}
                    </td>
                    <td className="r num">{r.weightPct.toFixed(1)}%</td>
                    <td className="r num">{r.vol ? `${r.vol.pct.toFixed(1)}%` : "데이터 부족"}</td>
                    <td className="r num">{r.beta !== null ? r.beta.toFixed(2) : "-"}</td>
                    <td className="r num text-down" title={r.mdd ? `${r.mdd.from} ~ ${r.mdd.to}` : undefined}>
                      {r.mdd ? pct(r.mdd.pct, 1) : "-"}
                    </td>
                    <td className={`r num ${rcShare !== null && rcShare > r.weightPct * 1.5 ? "font-semibold text-warn" : ""}`}>{rcShare !== null ? `${rcShare.toFixed(1)}%` : "-"}</td>
                    <td className="text-xs">
                      {topSec ? `${topSec[0]} ${topSec[1].toFixed(0)}%` : <span className="text-muted">{r.sectors.note ?? "-"}</span>}
                      {r.sectors.via && <span className="block text-[10px] text-muted">{r.sectors.note}</span>}
                      {!r.sectors.via && r.sectors.knownPct > 0 && r.sectors.knownPct < 99.5 && <span className="block text-[10px] text-muted">섹터 확인 {r.sectors.knownPct.toFixed(0)}%</span>}
                    </td>
                    <td className="r num text-xs">{r.sens ? <SensCell s={r.sens} /> : <span className="text-muted">{r.sensError ?? "-"}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">
          {"error" in base.rc ? (
            <>위험 기여: {base.rc.error}</>
          ) : (
            <>
              포트폴리오 변동성 (연) <span className="num font-semibold">{base.rc.portfolioVolPct.toFixed(1)}%</span> · {base.rc.from} ~ {base.rc.to}, {base.rc.days}거래일. 위험 기여가 비중보다 크게 높으면(주황) 그 종목이 비중보다 더 많은 흔들림을 만든다는 뜻입니다.
            </>
          )}
        </p>
      </Section>

      <Fold summary="계산 방법과 한계">
        <ul className="list-disc space-y-1 pl-4 text-xs">
          <li>시장 하락: 손실률 = 베타 × 하락률 (최대 −100%). 실제 급락기에는 상관관계·변동성이 커져 손실이 더 클 수 있습니다. 경로를 반영한 계산은 &lsquo;하락장&rsquo; 탭에 있습니다.</li>
          <li>과거 최악의 실제 하락: S&P 500 이 고점 대비 15% 이상 하락한 실제 구간 중, 지금 비중으로 고점에 샀다면 포트폴리오 낙폭이 가장 컸던 구간입니다 (리밸런싱 없음, 분배금 재투자).</li>
          <li>섹터 하락: 제공처(Yahoo Finance 등) 섹터 비중 기준입니다. 아마존·테슬라는 경기소비재, 메타·알파벳은 커뮤니케이션으로 분류됩니다. 섹터 정보가 없는 부분은 &lsquo;그 섹터가 전혀 없음 ~ 전부 그 섹터&rsquo; 범위로 보여 줍니다. 레버리지 ETF 는 기초 ETF 섹터 비중 × 배수로, 하루 만에 일어난다고 가정합니다.</li>
          <li>레버리지 ETF 급락: 기초 지수가 하루에 하락하면 레버리지 ETF 는 대략 배수만큼 하락합니다. 여러 날에 걸친 하락은 경로에 따라 더 크거나 작을 수 있습니다.</li>
          <li>장기 금리: 최근 10년 월간 총수익률을 10년물 금리(^TNX) 월간 변화에 회귀한 기울기입니다. 상관이 약한 종목(|상관| 0.2 미만)은 금리와 뚜렷한 관계가 없다는 뜻이며, 정밀한 금리 위험(듀레이션) 분석이 아닙니다.</li>
          <li>분배금 감소: 보유 수량 × 최근 12개월 실제 주당 정기 지급액 기준입니다.</li>
        </ul>
      </Fold>
      <Disclaimer>시나리오 결과는 예측이 아니라 가정에 따른 계산입니다. 과거 관계(베타·상관·금리 민감도)가 앞으로도 같다는 보장이 없고, 데이터가 없는 부분은 추정하지 않았습니다. 실제 손실은 이 계산과 다를 수 있습니다.</Disclaimer>
    </>
  );
}

function SensCell({ s }: { s: RateSensitivity }) {
  const weak = Math.abs(s.corr) < 0.2;
  return (
    <span title={`${s.from} ~ ${s.to}, ${s.months}개월 · 상관 ${s.corr.toFixed(2)} · 표준오차 ${s.se.toFixed(2)}`}>
      <span className={weak ? "text-muted" : s.pctPerPoint < 0 ? "text-down" : "text-up"}>{pct(s.pctPerPoint, 1)}</span>
      {weak && <span className="block text-[10px] text-muted">관계 약함</span>}
    </span>
  );
}
