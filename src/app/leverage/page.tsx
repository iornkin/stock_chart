import Link from "next/link";
import { analyzeLeverageGroup, leverageGroups, type LeverageAnalysis } from "@/lib/leverage";
import { getInstrument } from "@/lib/instruments";
import { changeClass, fmtPct } from "@/lib/format";
import { perRequest } from "@/lib/page-mode";
import MultiLineChart from "@/components/MultiLineChart";
import Tabs from "@/components/Tabs";
import { Empty, Fold, Notice, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "레버리지 ETF 분석" };

const P = ({ v, signed = true }: { v: number | null | undefined; signed?: boolean }) => <span className={`num ${signed ? changeClass(v) : ""}`}>{v === null || v === undefined ? "-" : fmtPct(v, 1, signed)}</span>;
const lev = (n: number) => (n === 1 ? "1배" : `${n}배`);
const md = (d: string) => d.slice(2).replaceAll("-", ".");

function Explainer() {
  const rows = [
    { label: "기초지수 (1배)", d1: 10, d2: -10 },
    { label: "2배 ETF", d1: 20, d2: -20 },
    { label: "3배 ETF", d1: 30, d2: -30 },
  ].map((r) => {
    const v = 100 * (1 + r.d1 / 100) * (1 + r.d2 / 100);
    return { ...r, end: v, total: v - 100 };
  });
  return (
    <Fold summary="레버리지 ETF 는 왜 기간 수익률 × 배수가 아닌가요? (예시)">
      <p className="mb-3 text-xs text-muted">아래 표는 이해를 돕기 위한 가상의 계산 예시입니다 (실제 데이터 아님).</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="prose-ko-sm flex flex-col gap-2">
          <p>
            레버리지 ETF 는 <strong className="text-ink">하루 수익률</strong>의 2배·3배를 목표로 매일 다시 맞춥니다. 그래서 이틀 이상 보유하면 &lsquo;기간 수익률 × 배수&rsquo;와 결과가 달라집니다.
          </p>
          <ul className="list-disc pl-5">
            <li>
              오르내림을 반복하는 장에서는 단순 배수보다 <strong className="text-ink">손실이 커지기</strong> 쉽습니다 (오른쪽 예시).
            </li>
            <li>
              한 방향으로 꾸준히 움직이는 장에서는 단순 배수보다 결과가 <strong className="text-ink">커질</strong> 수도 있습니다.
            </li>
            <li>운용 보수·파생상품 비용도 매일 빠집니다.</li>
          </ul>
          <p className="text-xs text-muted">아래 실제 데이터의 &lsquo;배수 대비&rsquo; 값은 실제 수익률 − (1배 ETF 수익률 × 배수)입니다.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>예시</th>
                <th className="r">1일차</th>
                <th className="r">2일차</th>
                <th className="r">2일 후 결과</th>
                <th className="r">단순 배수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="r">{fmtPct(r.d1, 0)}</td>
                  <td className="r">{fmtPct(r.d2, 0)}</td>
                  <td className={`r font-semibold ${changeClass(r.total)}`}>{fmtPct(r.total, 0)}</td>
                  <td className="r text-muted">{i === 0 ? "-" : fmtPct(rows[0].total * (i + 1), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Fold>
  );
}

function GroupPanel({ a }: { a: LeverageAnalysis }) {
  const syms = a.members.map((m) => m.symbol);
  const levOf = Object.fromEntries(a.members.map((m) => [m.symbol, m.leverage]));
  const label = Object.fromEntries(a.members.map((m) => [m.symbol, `${m.symbol} (${lev(m.leverage)})`]));
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-2">
        공통 비교 기간{" "}
        <strong className="num text-ink">
          {a.start} ~ {a.end}
        </strong>{" "}
        ({a.days.toLocaleString()}거래일) · 기준 1배 ETF <strong className="text-ink">{a.base}</strong> · 분배금 재투자 총수익 기준
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {a.members.map((m) => (
          <div key={m.symbol} className={`rounded-xl border p-4 ${m.leverage > 1 ? "border-line-strong" : "border-line"}`}>
            <div className="flex items-baseline justify-between">
              <Link href={`/stock/${m.symbol}`} className="text-lg font-bold hover:text-accent">
                {m.symbol}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.leverage > 1 ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{lev(m.leverage)}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">최고점 대비 현재</dt>
              <dd className="text-right font-semibold">
                <P v={m.fromAth} />
              </dd>
              <dt className="text-muted">최대 낙폭</dt>
              <dd className="text-right font-semibold">
                <P v={m.mdd} />
              </dd>
              <dt className="text-muted">1년 변동성</dt>
              <dd className="num text-right">{m.vol1y !== null ? `${m.vol1y.toFixed(1)}%` : "-"}</dd>
            </dl>
            <p className="mt-2 text-[11px] text-muted">
              최대 낙폭 구간 {md(m.mddPeak)} → {md(m.mddTrough)} · 최고점 {md(m.athDate)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line p-4">
        <p className="mb-2 text-sm font-semibold">누적 성과 (시작 = 100)</p>
        <MultiLineChart dates={a.chart.dates} series={a.chart.series} labels={label} />
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">기간별 수익률</p>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>기간</th>
                {syms.map((s) => (
                  <th key={s} className="r">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.periods.map((p) => (
                <tr key={p.key}>
                  <td>
                    {p.label}
                    <span className="ml-1 text-[10px] text-muted">{md(p.start)}~</span>
                  </td>
                  {syms.map((s) => (
                    <td key={s} className="r">
                      <P v={p.values[s]} />
                      {p.vsMultiple[s] !== null && p.vsMultiple[s] !== undefined && (
                        <span className="block text-[10px] text-muted">
                          배수 대비 <span className={changeClass(p.vsMultiple[s])}>{fmtPct(p.vsMultiple[s], 1)}p</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">급락 구간의 손실과 회복</p>
        <p className="mb-2 text-xs text-muted">
          {a.base} 가 고점 대비 15% 이상 하락한 구간. 손실은 {a.base} 의 고점일 → 저점일 사이 각 종목의 변화, 회복은 각 종목이 그 고점일 수준을 다시 넘은 날입니다.
        </p>
        {a.episodes.length ? (
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>구간 ({a.base} 고점 → 저점)</th>
                  {syms.map((s) => (
                    <th key={s} className="r">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.episodes.map((e) => (
                  <tr key={e.peak}>
                    <td className="num whitespace-nowrap">
                      {md(e.peak)} → {md(e.trough)}
                    </td>
                    {syms.map((s) => {
                      const m = e.members[s];
                      return (
                        <td key={s} className="r">
                          <P v={m.loss} />
                          <span className="block text-[10px] text-muted">{m.recovery ? `회복 ${Math.round((m.recoveryDays ?? 0) / 30.4)}개월 (${md(m.recovery)})` : `미회복 (현재 ${fmtPct(m.nowFromPeak, 1)})`}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>공통 기간에 15% 이상 하락 구간이 없습니다.</Empty>
        )}
      </div>

      {a.rolling.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">1년 보유했을 때의 결과 분포 (과거 모든 1년 구간)</p>
          <p className="mb-2 text-xs text-muted">공통 기간 안에서 하루씩 옮겨 가며 만든 252거래일 보유 구간 전체의 통계입니다. 과거 분포이며 앞으로의 결과를 뜻하지 않습니다.</p>
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="r">최악</th>
                  <th className="r">중간값</th>
                  <th className="r">최고</th>
                  <th className="r">손실 구간 비율</th>
                  <th className="r">{a.base}보다 낮았던 비율</th>
                  <th className="r">단순 배수보다 낮았던 비율</th>
                </tr>
              </thead>
              <tbody>
                {a.rolling.map((r) => (
                  <tr key={r.symbol}>
                    <td className="font-semibold">
                      {r.symbol} <span className="text-xs font-normal text-muted">{lev(levOf[r.symbol])}</span>
                    </td>
                    <td className="r">
                      <P v={r.worst} />
                    </td>
                    <td className="r">
                      <P v={r.median} />
                    </td>
                    <td className="r">
                      <P v={r.best} />
                    </td>
                    <td className="r num">{r.lossShare.toFixed(0)}%</td>
                    <td className="r num">{r.underBaseShare === null ? "-" : `${r.underBaseShare.toFixed(0)}%`}</td>
                    <td className="r num">{r.underMultipleShare === null ? "-" : `${r.underMultipleShare.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">연도별 수익률</p>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>연도</th>
                {syms.map((s) => (
                  <th key={s} className="r">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...a.years].reverse().map((y) => (
                <tr key={y.year}>
                  <td className="num">
                    {y.year}
                    {y.partial && <span className="ml-1 text-[10px] text-muted">일부 기간</span>}
                  </td>
                  {syms.map((s) => (
                    <td key={s} className="r">
                      <P v={y.values[s]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {a.excluded.length > 0 && (
        <Notice tone="warn" title="데이터가 없어 제외한 종목">
          {a.excluded.map((e) => `${e.symbol}: ${e.reason}`).join(" · ")}
        </Notice>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        출처: 수집된 일봉 종가(Yahoo Finance)와 분배금 기록. 총수익은 배당락일 종가로 분배금을 재투자했다고 가정했고 세금·거래 비용은 빠져 있습니다. 데이터 기준일 {a.dataAsOf}. 과거 성과는 미래 수익을 보장하지 않습니다.
      </p>
    </div>
  );
}

export default async function LeveragePage() {
  await perRequest();
  const analyses = leverageGroups()
    .map((g) => analyzeLeverageGroup(g))
    .filter((a): a is LeverageAnalysis => a !== null);
  return (
    <div className="flex flex-col">
      <PageHeader title="레버리지 ETF" description="같은 지수를 따르는 1배·2배·3배 ETF 의 실제 성과를 같은 기간으로 비교합니다. 과거 기록이며 미래 수익을 보장하지 않습니다." />
      <div className="flex flex-col gap-5">
        <Section title="실제 성과 비교">
          {analyses.length ? (
            <Tabs tabs={analyses.map((a) => ({ key: a.group.key, label: `${a.group.title} · ${a.members.map((m) => m.symbol).join("/")}` }))} panels={Object.fromEntries(analyses.map((a) => [a.group.key, <GroupPanel key={a.group.key} a={a} />]))} />
          ) : (
            <Empty>비교에 필요한 일봉 데이터가 아직 수집되지 않았습니다.</Empty>
          )}
        </Section>
        <Explainer />
        <p className="text-xs text-muted">종목 구성은 설정 파일의 기초지수·레버리지 배수 정보로 정합니다 ({getInstrument("TQQQ")?.underlying ?? "Nasdaq-100"} 등).</p>
      </div>
    </div>
  );
}
