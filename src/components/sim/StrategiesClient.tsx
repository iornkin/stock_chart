"use client";
/** 포트폴리오 전략 저장·복제·수정·비교, JSON 내보내기/불러오기 (브라우저에 저장) */
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRuns, useSeriesMap, useStrategies, etToday } from "@/lib/client/user-data";
import { newId, type Strategy } from "@/lib/portfolio/types";
import { runBacktest, validateWeights, checkCoverage, type BacktestResult } from "@/lib/sim/backtest";
import { getInstrument } from "@/lib/instruments";
import { downloadJson, readJsonFile } from "@/lib/client/backup";
import { Empty, Notice, Section } from "@/components/ui";
import { Disclaimer, Field, HoldingsEditor, LocalOnlyNote, pct, PRESETS, rowsFrom, rowsProblem, rowsToItems, Seg, tone, usd, type WeightRow } from "./common";
import { SimLineChart, SERIES_VARS } from "./charts";

export default function StrategiesClient() {
  const st = useStrategies();
  const runs = useRuns();
  const [editing, setEditing] = useState<{ id: string | null; name: string; rows: WeightRow[]; memo: string } | null>(null);
  const [normalize, setNormalize] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!st.loaded) return <div className="skeleton h-48" />;
  const list = st.value;

  const saveEdit = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return setErr("전략 이름을 입력하세요.");
    const pr = rowsProblem(editing.rows);
    if (pr) return setErr(pr);
    const v = validateWeights(rowsToItems(editing.rows), normalize);
    if (!v.ok) return setErr(v.error);
    const now = Date.now();
    const items = v.holdings.map((h) => ({ symbol: h.symbol, weight: Math.round(h.weight * 10000) / 10000 }));
    st.set((cur) =>
      editing.id ? cur.map((s) => (s.id === editing.id ? { ...s, name, items, memo: editing.memo || undefined, updatedAt: now } : s)) : [...cur, { id: newId(), name, items, memo: editing.memo || undefined, createdAt: now, updatedAt: now }],
    );
    setMsg(`'${name}' 전략을 저장했습니다${v.normalized ? " (비중을 100%로 정규화)" : ""}.`);
    setEditing(null);
    setErr(null);
  };

  const addPresets = () => {
    const now = Date.now();
    const have = new Set(list.map((s) => s.name));
    const add = PRESETS.filter((p) => !have.has(p.name)).map((p, i) => ({ id: newId(), name: p.name, items: p.items, createdAt: now + i, updatedAt: now + i }));
    st.set((cur) => [...cur, ...add]);
    setMsg(add.length ? `예시 전략 ${add.length}개를 추가했습니다.` : "예시 전략이 이미 모두 있습니다.");
  };

  const importFile = async (file: File) => {
    setErr(null);
    try {
      const j = (await readJsonFile(file)) as Record<string, unknown>;
      const raw = (j.format === "usi-strategies" ? j.strategies : (j.data as Record<string, unknown> | undefined)?.strategies) as unknown;
      if (!Array.isArray(raw)) return setErr("전략 JSON 파일이 아닙니다 (이 사이트에서 내보낸 전략 또는 전체 데이터 파일이 필요합니다).");
      const now = Date.now();
      const ok: Strategy[] = [];
      let skipped = 0;
      for (const x of raw as Record<string, unknown>[]) {
        const items = Array.isArray(x?.items) ? (x.items as { symbol?: unknown; weight?: unknown }[]).map((i) => ({ symbol: String(i.symbol ?? "").toUpperCase(), weight: Number(i.weight) })) : [];
        const valid = typeof x?.name === "string" && items.length > 0 && items.every((i) => getInstrument(i.symbol) && i.weight > 0) && Math.abs(items.reduce((a, i) => a + i.weight, 0) - 100) < 0.01;
        if (!valid) {
          skipped++;
          continue;
        }
        ok.push({ id: newId(), name: String(x.name).slice(0, 60), items: items.map((i) => ({ symbol: getInstrument(i.symbol)!.symbol, weight: i.weight })), memo: typeof x.memo === "string" ? x.memo.slice(0, 500) : undefined, createdAt: now, updatedAt: now });
      }
      st.set((cur) => [...cur, ...ok]);
      setMsg(`전략 ${ok.length}개를 불러왔습니다${skipped ? ` (형식이 맞지 않거나 지원하지 않는 종목이 있는 ${skipped}개는 건너뜀)` : ""}.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="저장한 전략"
        right={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => (setEditing({ id: null, name: "", rows: [{ symbol: "", weight: "100" }], memo: "" }), setErr(null))}>
              + 새 전략
            </button>
            <button type="button" className="btn btn-sm" onClick={addPresets}>
              예시 전략 추가
            </button>
            <button type="button" className="btn btn-sm" onClick={() => downloadJson(`strategies-${etToday()}.json`, { format: "usi-strategies", version: 1, exportedAt: new Date().toISOString(), strategies: list.map(({ name, items, memo }) => ({ name, items, memo })) })} disabled={!list.length}>
              JSON 내보내기
            </button>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              JSON 불러오기
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="전략 JSON 파일" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0]).finally(() => (e.target.value = ""))} />
          </div>
        }
      >
        {msg && <p className="mb-2 text-sm text-good">{msg}</p>}
        {err && !editing && <p className="mb-2 text-sm text-critical" role="alert">{err}</p>}
        {editing && (
          <div className="mb-4 rounded-xl border border-accent/40 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="전략 이름">
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} aria-label="전략 이름" />
              </Field>
              <Field label="메모 (선택)">
                <input className="input" value={editing.memo} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} maxLength={500} aria-label="전략 메모" />
              </Field>
            </div>
            <div className="mt-3">
              <HoldingsEditor rows={editing.rows} onChange={(rows) => setEditing({ ...editing, rows })} label="전략" />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="h-4 w-4" />
              비중 합계가 100%가 아니면 저장할 때 자동 정규화
            </label>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={saveEdit}>
                전략 저장
              </button>
              <button type="button" className="btn" onClick={() => (setEditing(null), setErr(null))}>
                취소
              </button>
              {err && <span className="text-sm text-critical" role="alert">{err}</span>}
            </div>
          </div>
        )}
        {list.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((s) => (
              <li key={s.id} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id].slice(-4) : p.filter((x) => x !== s.id)))} aria-label={`${s.name} 비교 선택`} />
                    <span>
                      <span className="font-semibold">{s.name}</span>
                      <span className="block text-xs text-ink-2">{s.items.map((i) => `${i.symbol} ${i.weight}%`).join(" + ")}</span>
                      {s.memo && <span className="block text-[11px] text-muted">{s.memo}</span>}
                    </span>
                  </label>
                  <span className={`num text-xs ${Math.abs(s.items.reduce((a, i) => a + i.weight, 0) - 100) < 0.01 ? "text-good" : "text-critical"}`}>합계 {s.items.reduce((a, i) => a + i.weight, 0)}%</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Link className="btn btn-sm" href={`/backtest?strategy=${s.id}`}>
                    백테스트
                  </Link>
                  <Link className="btn btn-sm" href={`/simulate?strategy=${s.id}`}>
                    미래 시나리오
                  </Link>
                  <Link className="btn btn-sm" href={`/stress?strategy=${s.id}`}>
                    스트레스 테스트
                  </Link>
                  <button type="button" className="btn btn-sm" onClick={() => (setEditing({ id: s.id, name: s.name, rows: rowsFrom(s.items), memo: s.memo ?? "" }), setErr(null))}>
                    수정
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => st.set((cur) => [...cur, { ...s, id: newId(), name: `${s.name} (복사본)`.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now() }])}>
                    복제
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => window.confirm(`'${s.name}' 전략을 삭제할까요?`) && st.set((cur) => cur.filter((x) => x.id !== s.id))}>
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>저장한 전략이 없습니다. &apos;새 전략&apos;이나 &apos;예시 전략 추가&apos;로 시작하세요.</Empty>
        )}
        {picked.length >= 2 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link className="btn btn-primary btn-sm" href={`/backtest?compare=${picked.join(",")}`}>
              선택한 {picked.length}개 전략 백테스트 비교
            </Link>
            <span className="text-xs text-muted">최대 4개까지 선택</span>
          </div>
        )}
      </Section>

      {list.length > 0 && <QuickCompare strategies={list} />}

      <Section title="최근 계산 결과" description="백테스트·시뮬레이션·스트레스 테스트 화면에서 '결과 저장'을 누른 결과 (최근 20개)">
        {runs.value.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {runs.value.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">{r.title}</p>
                <p className="text-[11px] text-muted">{new Date(r.at).toLocaleString("ko-KR")}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
                  {r.summary.map((x) => (
                    <div key={x.label} className="flex justify-between gap-2">
                      <dt className="text-muted">{x.label}</dt>
                      <dd className="num">{x.value}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className="btn btn-sm mt-2" onClick={() => runs.set((cur) => cur.filter((x) => x.id !== r.id))}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>저장한 결과가 없습니다.</Empty>
        )}
      </Section>
      <LocalOnlyNote what="전략과 계산 결과" />
    </div>
  );
}

/** 저장한 전략을 같은 조건으로 바로 비교 (기본 조건 — 자세한 조건은 백테스트 화면) */
function QuickCompare({ strategies }: { strategies: Strategy[] }) {
  const [years, setYears] = useState<number | 0>(5);
  const syms = useMemo(() => [...new Set(strategies.flatMap((s) => s.items.map((i) => i.symbol)))], [strategies]);
  const ser = useSeriesMap(syms);
  const today = etToday();
  const res = useMemo(() => {
    if (ser.loading) return null;
    const cov = checkCoverage(syms, ser.series, "1900-01-01", today);
    const commonEnd = cov.commonEnd ?? today;
    const firsts = strategies.flatMap((s) => s.items.map((i) => ser.series[i.symbol]?.dates[0])).filter((x): x is string => !!x).sort();
    const commonStart = firsts[firsts.length - 1];
    if (!commonStart) return null;
    let start = commonStart;
    if (years) {
      const d = new Date(Date.parse(commonEnd) - years * 365.25 * 86400000).toISOString().slice(0, 10);
      if (d > start) start = d;
    }
    return {
      start,
      end: commonEnd,
      shortened: years > 0 && start === commonStart,
      rows: strategies.map((s) => ({ s, r: runBacktest({ holdings: s.items, start, end: commonEnd, initial: 10000, monthly: 0, timing: "month_start", reinvest: true, rebalance: "annual", costPct: 0.1, taxPct: 15, riskFreePct: 0 }, ser.series) })),
    };
  }, [ser, strategies, syms, years, today]);
  return (
    <Section
      title="전략 한눈에 비교"
      description="모든 저장 전략에 공통으로 데이터가 있는 기간 · 초기 $10,000 · 추가 납입 없음 · 분배금 재투자 · 연 1회 리밸런싱 · 거래 비용 0.1% · 분배금 세금 15%"
      right={<Seg label="비교 기간" value={years} onChange={setYears} options={[{ v: 1, l: "1년" }, { v: 3, l: "3년" }, { v: 5, l: "5년" }, { v: 10, l: "10년" }, { v: 0, l: "공통 전체" }]} />}
    >
      {!res ? (
        <div className="skeleton h-32" />
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-2">
            계산 기간 {res.start} ~ {res.end}
            {res.shortened && " — 상장일이 늦은 종목 때문에 선택한 기간보다 짧아졌습니다"}
          </p>
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>전략</th>
                  <th className="r">최종 평가금액</th>
                  <th className="r">총수익률</th>
                  <th className="r">CAGR</th>
                  <th className="r">최대 낙폭</th>
                  <th className="r">변동성</th>
                  <th className="r">누적 분배금(세전)</th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map(({ s, r }, i) => (
                  <tr key={s.id}>
                    <td>
                      <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: i < SERIES_VARS.length ? `var(${SERIES_VARS[i]})` : "var(--axis)" }} />
                      {s.name}
                    </td>
                    {r.ok ? (
                      <>
                        <td className="r font-semibold">{usd(r.finalValue, 0)}</td>
                        <td className={`r ${tone(r.totalReturnPct)}`}>{pct(r.totalReturnPct)}</td>
                        <td className="r">{pct(r.cagrPct)}</td>
                        <td className="r text-down">{pct(r.mddPct, 1)}</td>
                        <td className="r">{r.volPct !== null ? `${r.volPct.toFixed(1)}%` : "-"}</td>
                        <td className="r">{usd(r.income.gross, 0)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="text-xs text-warn">
                        {r.problems.join(" ")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res.rows.filter((x) => x.r.ok).length >= 1 && res.rows.length <= SERIES_VARS.length && (
            <div className="mt-4">
              <SimLineChart
                dates={(res.rows.find((x) => x.r.ok)!.r as BacktestResult).dates}
                lines={res.rows.filter((x) => x.r.ok).map(({ s, r }, i) => {
                  const m = new Map((r as BacktestResult).dates.map((d, k) => [d, (r as BacktestResult).value[k]]));
                  return { key: s.id, label: s.name, values: (res.rows.find((x) => x.r.ok)!.r as BacktestResult).dates.map((d) => m.get(d) ?? null), color: SERIES_VARS[i] };
                })}
                format="usd"
                logToggle
                ariaLabel="전략별 평가금액 추이"
              />
            </div>
          )}
          <Disclaimer>과거 성과는 미래 수익을 보장하지 않습니다. 조건을 바꾸거나 벤치마크와 비교하려면 백테스트 화면을 쓰세요.</Disclaimer>
        </>
      )}
      {Object.keys(ser.errors).length > 0 && <Notice tone="warn">가격 데이터를 불러오지 못한 종목: {Object.keys(ser.errors).join(", ")}</Notice>}
    </Section>
  );
}
