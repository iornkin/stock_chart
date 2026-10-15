"use client";
/** 과거 백테스트 — 사용자가 정한 시작일·종료일, 여러 포트폴리오 동일 조건 비교, 벤치마크 비교 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRuns, useSeriesMap, useStrategies, etToday } from "@/lib/client/user-data";
import { compareWithBenchmark, fairnessCheck, fullPeriodStat, REBALANCE_KO, riskExtras, runBacktestSuite, toKrw, validateWeights, checkCoverage, type BacktestConfig, type BacktestResult, type Rebalance } from "@/lib/sim/backtest";
import { INSTRUMENTS } from "@/config/instruments";
import { formatEt } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import { Disclaimer, Field, krw, parseNum, pct, rowsFrom, rowsToItems, rowsProblem, Seg, SymbolSelect, tone, usd } from "./common";
import { GroupedBars, ReturnHeatmap, SimLineChart, SERIES_VARS } from "./charts";
import PortfolioInputs, { defaultPortfolios, LETTERS, type PortfolioInput } from "./PortfolioInputs";
import type { CostMethod } from "@/lib/portfolio/tax";
import BarChartSvg from "@/components/BarChartSvg";
import PanelTabs from "@/components/PanelTabs";
import RiskPanel from "./RiskPanel";
import type { PriceSeries } from "@/lib/sim/series";
import { configFingerprint, dataFingerprint, ENGINE_VERSION } from "@/lib/sim/repro";
import { parseSettings, SETTINGS_FORMAT, type BacktestSettings } from "@/lib/sim/backtest-settings";

const QUICK: { label: string; months?: number; all?: boolean }[] = [
  { label: "1개월", months: 1 },
  { label: "3개월", months: 3 },
  { label: "6개월", months: 6 },
  { label: "1년", months: 12 },
  { label: "3년", months: 36 },
  { label: "5년", months: 60 },
  { label: "10년", months: 120 },
  { label: "공통 전체", all: true },
];

function minusMonths(d: string, m: number): string {
  const [y, mo, da] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 - m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(da, last)).padStart(2, "0")}`;
}

interface RunOutput {
  at: number;
  cfg: Omit<BacktestConfig, "holdings">;
  items: { p: PortfolioInput; suite: ReturnType<typeof runBacktestSuite> }[];
  bench: { symbol: string; suite: ReturnType<typeof runBacktestSuite> } | null;
  series: Record<string, PriceSeries>;
  normalizedNote: string[];
  /** 설정 내보내기용 화면 입력값 */
  settings: BacktestSettings;
}

export default function BacktestClient() {
  const [list, setList] = useState<PortfolioInput[]>(defaultPortfolios(2));
  const today = etToday();
  const [start, setStart] = useState(minusMonths(today, 60));
  const [end, setEnd] = useState(today);
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("500");
  const [timing, setTiming] = useState<"month_start" | "month_end">("month_start");
  const [reinvest, setReinvest] = useState(true);
  const [rebalance, setRebalance] = useState<Rebalance>("annual");
  const [cost, setCost] = useState("0.1");
  const [tax, setTax] = useState("15");
  const [rfMode, setRfMode] = useState<"auto" | "manual">("auto");
  const [rf, setRf] = useState("0");
  const [bench, setBench] = useState("QQQ");
  const [normalize, setNormalize] = useState(false);
  const [showKrw, setShowKrw] = useState(false);
  const [cgOn, setCgOn] = useState(false);
  const [cgMethod, setCgMethod] = useState<CostMethod>("fifo");
  const [fxMode, setFxMode] = useState<"historical" | "fixed">("historical");
  const [fixedFx, setFixedFx] = useState("1400");
  const [out, setOut] = useState<RunOutput | null>(null);
  const [err, setErr] = useState<string[] | null>(null);
  const runs = useRuns();
  const strategies = useStrategies();

  // ?strategy=ID 또는 ?compare=ID,ID 로 저장한 전략 불러오기
  useEffect(() => {
    if (!strategies.loaded) return;
    const sp = new URLSearchParams(window.location.search);
    const ids = (sp.get("compare") ?? sp.get("strategy") ?? "").split(",").filter(Boolean);
    const picked = ids.map((id) => strategies.value.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (picked.length) setList(picked.slice(0, 4).map((s, i) => ({ key: LETTERS[i], name: s.name, rows: rowsFrom(s.items), auto: false })));
  }, [strategies.loaded, strategies.value]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of list) for (const it of rowsToItems(p.rows)) if (!rowsProblem([{ symbol: it.symbol, weight: "1" }])) set.add(it.symbol);
    if (bench) set.add(bench);
    return [...set];
  }, [list, bench]);
  const ser = useSeriesMap([...symbols, "^IRX", "KRW=X"]);
  const cov = useMemo(() => (symbols.every((s) => ser.series[s] || ser.errors[s]) ? checkCoverage(symbols, ser.series, start, end) : null), [symbols, ser, start, end]);

  const quick = (q: (typeof QUICK)[number]) => {
    const last = cov?.commonEnd ?? today;
    if (q.all) {
      if (cov?.commonStart) setStart(cov.commonStart);
      setEnd(last);
      return;
    }
    setEnd(last);
    setStart(minusMonths(last, q.months as number));
  };

  const run = () => {
    setErr(null);
    const problems: string[] = [];
    const notes: string[] = [];
    const ready: { p: PortfolioInput; holdings: { symbol: string; weight: number }[] }[] = [];
    for (const p of list) {
      const pr = rowsProblem(p.rows);
      if (pr) {
        problems.push(`포트폴리오 ${p.key}: ${pr}`);
        continue;
      }
      const v = validateWeights(rowsToItems(p.rows), normalize);
      if (!v.ok) problems.push(`포트폴리오 ${p.key}: ${v.error}`);
      else {
        if (v.normalized) notes.push(`포트폴리오 ${p.key}: 비중 합계 ${Math.round(v.sum * 100) / 100}%를 100%로 자동 정규화했습니다.`);
        ready.push({ p, holdings: v.holdings });
      }
    }
    const ini = parseNum(initial);
    const mon = parseNum(monthly);
    const c = parseNum(cost);
    const t = parseNum(tax);
    if (!(ini >= 0) || !(mon >= 0) || ini + mon <= 0) problems.push("초기 투자금과 매월 추가 투자금을 확인하세요.");
    if (!(c >= 0 && c < 10) || !(t >= 0 && t <= 100)) problems.push("거래 비용(0~10%)과 세율(0~100%)을 확인하세요.");
    if (ser.loading) problems.push("가격 데이터를 불러오는 중입니다. 잠시 후 다시 실행하세요.");
    if (problems.length) return setErr(problems);
    let rfPct = parseNum(rf);
    if (rfMode === "auto") {
      const irx = ser.series["^IRX"];
      const vals = irx ? irx.dates.map((d, i) => (d >= start && d <= end ? irx.close[i] : NaN)).filter((v) => Number.isFinite(v)) : [];
      rfPct = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      notes.push(vals.length ? `샤프 비율의 무위험 수익률: 미국 13주 국채금리(^IRX) 기간 평균 ${rfPct.toFixed(2)}%` : "무위험 수익률 데이터가 없어 0%로 계산했습니다.");
    }
    const fixed = parseNum(fixedFx);
    if (cgOn && fxMode === "fixed" && !(fixed > 0)) return setErr(["양도소득세 계산용 고정 환율을 입력하세요."]);
    const capitalGains = cgOn ? { method: cgMethod, fx: ser.series["KRW=X"] ?? null, fixedFx: fxMode === "fixed" ? fixed : null } : null;
    const base = { start, end, initial: ini, monthly: mon, timing, reinvest, rebalance, costPct: c, taxPct: t, riskFreePct: rfPct, capitalGains };
    const items = ready.map(({ p, holdings }) => ({ p, suite: runBacktestSuite({ ...base, holdings }, ser.series) }));
    const failed = items.filter((x) => !x.suite.main.ok);
    if (failed.length) {
      const f = failed.flatMap((x) => (x.suite.main.ok ? [] : x.suite.main.problems.map((m) => `포트폴리오 ${x.p.key}: ${m}`)));
      return setErr(f);
    }
    const b = bench ? { symbol: bench, suite: runBacktestSuite({ ...base, holdings: [{ symbol: bench, weight: 100 }], rebalance: "none" }, ser.series) } : null;
    if (b && !b.suite.main.ok) notes.push(`벤치마크 ${bench}: ${b.suite.main.problems.join(" ")}`);
    const settings: BacktestSettings = {
      format: SETTINGS_FORMAT,
      version: 1,
      portfolios: ready.map(({ p }) => ({ name: p.name, items: rowsToItems(p.rows) })),
      start,
      end,
      initial: ini,
      monthly: mon,
      timing,
      reinvest,
      rebalance,
      costPct: c,
      taxPct: t,
      rfMode,
      riskFreePct: rfMode === "manual" ? rfPct : parseNum(rf) || 0,
      benchmark: bench || null,
      normalize,
      capitalGains: cgOn ? { method: cgMethod, fxMode, fixedFx: fxMode === "fixed" ? fixed : null } : null,
    };
    setOut({ at: Date.now(), cfg: base, items, bench: b, series: ser.series, normalizedNote: notes, settings });
  };

  const [loadMsg, setLoadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadSettings = async (file: File) => {
    try {
      const r = parseSettings(JSON.parse(await file.text()));
      if (!r.ok) return setLoadMsg({ ok: false, text: r.error });
      const x = r.settings;
      setList(x.portfolios.map((p, i) => ({ key: LETTERS[i], name: p.name, rows: rowsFrom(p.items), auto: false })));
      setStart(x.start);
      setEnd(x.end);
      setInitial(String(x.initial));
      setMonthly(String(x.monthly));
      setTiming(x.timing);
      setReinvest(x.reinvest);
      setRebalance(x.rebalance);
      setCost(String(x.costPct));
      setTax(String(x.taxPct));
      setRfMode(x.rfMode);
      setRf(String(x.riskFreePct));
      setBench(x.benchmark ?? "");
      setNormalize(x.normalize);
      setCgOn(!!x.capitalGains);
      if (x.capitalGains) {
        setCgMethod(x.capitalGains.method);
        setFxMode(x.capitalGains.fxMode);
        if (x.capitalGains.fixedFx) setFixedFx(String(x.capitalGains.fixedFx));
      }
      setOut(null);
      setLoadMsg({
        ok: true,
        text: `설정을 불러왔습니다. '백테스트 실행'을 누르면 같은 조건으로 다시 계산합니다.${x.check ? ` 내보낼 때 재현 코드: 데이터 ${x.check.dataCode} — 다시 계산한 결과의 데이터 코드가 같으면 같은 가격 기록으로 계산한 것입니다.` : ""}`,
      });
    } catch {
      setLoadMsg({ ok: false, text: "JSON 파일을 읽지 못했습니다." });
    }
  };

  const save = () => {
    if (!out) return;
    const main = out.items.map((x) => x.suite.main as BacktestResult);
    runs.add({
      kind: "backtest",
      title: `백테스트 ${main[0].start}~${main[0].end} · ${out.items.map((x) => x.p.name).join(" vs ")}`,
      summary: main.flatMap((r, i) => [
        { label: `${out.items[i].p.key} 최종 평가금액`, value: usd(r.finalValue, 0) },
        { label: `${out.items[i].p.key} CAGR`, value: pct(r.cagrPct) },
        { label: `${out.items[i].p.key} 최대 낙폭`, value: pct(r.mddPct) },
      ]),
      config: { ...out.cfg, portfolios: out.items.map((x) => ({ name: x.p.name, items: rowsToItems(x.p.rows) })), benchmark: out.bench?.symbol ?? null },
      // 재현 정보: 같은 설정·같은 데이터 코드면 같은 결과가 나와야 한다
      meta: (() => {
        const v = main[0].verification;
        const symbols = [...new Set(main.flatMap((r) => r.holdings.map((h) => h.symbol)))];
        return {
          engine: ENGINE_VERSION,
          dataFrom: v.used.start,
          dataTo: v.used.end,
          dataCode: dataFingerprint(symbols, out.series, v.used.start, v.used.end),
          configCode: main.map((r) => configFingerprint(r.config)).join("+"),
          assumptions: [`재투자 ${out.cfg.reinvest ? "예" : "아니오"}`, `리밸런싱 ${REBALANCE_KO[out.cfg.rebalance]}`, `거래 비용 ${out.cfg.costPct}%`, `분배금 세율 ${out.cfg.taxPct}%`],
        };
      })(),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 포트폴리오" description="최대 4개를 같은 기간·조건으로 비교합니다">
        <PortfolioInputs list={list} onChange={setList} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="btn btn-sm cursor-pointer">
            설정 파일 불러오기
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadSettings(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-muted">결과 화면의 &lsquo;검증·재현&rsquo;에서 내보낸 설정 파일로 같은 조건을 다시 채웁니다.</span>
          {loadMsg && (
            <span role="status" className={loadMsg.ok ? "text-good" : "text-critical"}>
              {loadMsg.text}
            </span>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="h-4 w-4" />
          비중 합계가 100%가 아니면 자동 정규화 (끄면 오류로 알림)
        </label>
      </Section>

      <Section title="2. 기간" description="입력칸의 날짜로 계산합니다 (빠른 선택은 날짜를 채워 주는 기능)">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="시작일">
            <input type="date" className="input" value={start} max={end} onChange={(e) => setStart(e.target.value)} aria-label="시작일" />
          </Field>
          <Field label="종료일">
            <input type="date" className="input" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} aria-label="종료일" />
          </Field>
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button key={q.label} type="button" className="btn btn-sm" onClick={() => quick(q)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <CoverageTable cov={cov} loading={ser.loading} errors={ser.errors} onAlign={(d) => setStart(d)} start={start} />
      </Section>

      <Section title="3. 투자 조건">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="초기 투자금 (USD)">
            <input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} aria-label="초기 투자금" />
          </Field>
          <Field label="매월 추가 투자금 (USD)">
            <input className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-label="매월 추가 투자금" />
          </Field>
          <Field label="벤치마크 (같은 조건으로 비교)">
            <SymbolSelect value={bench} onChange={setBench} label="벤치마크" includeNone="비교 안 함" />
          </Field>
          <Field label="추가 투자 시점">
            <Seg label="추가 투자 시점" value={timing} onChange={setTiming} options={[{ v: "month_start", l: "월초" }, { v: "month_end", l: "월말" }]} />
          </Field>
          <Field label="분배금">
            <Seg label="분배금 재투자" value={reinvest} onChange={setReinvest} options={[{ v: true, l: "재투자" }, { v: false, l: "현금 보유" }]} />
          </Field>
          <Field label="리밸런싱">
            <select className="input" value={rebalance} onChange={(e) => setRebalance(e.target.value as Rebalance)} aria-label="리밸런싱">
              {(Object.keys(REBALANCE_KO) as Rebalance[]).map((r) => (
                <option key={r} value={r}>
                  {REBALANCE_KO[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <details className="mt-4 rounded-lg border border-line px-4 py-3" open={cgOn || showKrw}>
          <summary className="text-sm font-semibold text-ink-2">
            세금·비용·고급 설정 <span className="ml-1 text-xs font-normal text-muted">거래 비용 {cost}% · 분배금 세금 {tax}% · 양도세 {cgOn ? "반영" : "미반영"}</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="거래 비용 (%)" hint="사고판 금액 기준">
              <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="거래 비용" />
            </Field>
            <Field label="분배금 세금 (%)" hint="미국 원천징수 15% 가정">
              <input className="input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} aria-label="분배금 세금" />
            </Field>
            <Field label="샤프 비율 무위험 수익률">
              <div className="flex gap-1">
                <select className="input" value={rfMode} onChange={(e) => setRfMode(e.target.value as "auto" | "manual")} aria-label="무위험 수익률 방식">
                  <option value="auto">국채금리 기간 평균</option>
                  <option value="manual">직접 입력(%)</option>
                </select>
                {rfMode === "manual" && <input className="input w-20" inputMode="decimal" value={rf} onChange={(e) => setRf(e.target.value)} aria-label="무위험 수익률" />}
              </div>
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={cgOn} onChange={(e) => setCgOn(e.target.checked)} className="h-4 w-4" />
              해외주식 양도소득세 반영 <span className="font-normal text-muted">(연 250만 원 공제 · 22% · 다음 해 5월 납부)</span>
            </label>
            {cgOn && (
              <div className="flex flex-wrap items-end gap-3 pl-6">
                <Field label="취득가액 계산">
                  <Seg label="취득가액 계산" value={cgMethod} onChange={setCgMethod} options={[{ v: "fifo", l: "선입선출" }, { v: "average", l: "이동평균" }]} />
                </Field>
                <Field label="원화 환산 환율">
                  <Seg label="원화 환산 환율" value={fxMode} onChange={setFxMode} options={[{ v: "historical", l: "날짜별 실제 환율" }, { v: "fixed", l: "고정 환율" }]} />
                </Field>
                {fxMode === "fixed" && (
                  <Field label="고정 환율 (원/달러, 가정)">
                    <input className="input w-28" inputMode="decimal" value={fixedFx} onChange={(e) => setFixedFx(e.target.value)} aria-label="고정 환율" />
                  </Field>
                )}
                {fxMode === "historical" && !ser.series["KRW=X"] && <p className="pb-2 text-xs text-warn">원/달러 환율 기록이 아직 없습니다. 고정 환율을 쓰세요.</p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showKrw} onChange={(e) => setShowKrw(e.target.checked)} className="h-4 w-4" />
              결과를 원화(KRW)로도 환산
            </label>
          </div>
        </details>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={run} disabled={ser.loading}>
            {ser.loading ? "가격 데이터 불러오는 중…" : "백테스트 실행"}
          </button>
          {out && (
            <button type="button" className="btn" onClick={save}>
              결과 저장 (대시보드에 표시)
            </button>
          )}
        </div>
        {err && (
          <div className="mt-3">
            <Notice tone="critical" title="계산하지 않았습니다">
              <ul className="list-disc pl-4">
                {err.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {cov?.commonStart && cov.commonStart > start && (
                <button type="button" className="btn btn-sm mt-2" onClick={() => setStart(cov.commonStart as string)}>
                  모든 종목이 있는 공통 기간({cov.commonStart}~)으로 맞추기
                </button>
              )}
            </Notice>
          </div>
        )}
      </Section>

      {out && <Results out={out} showKrw={showKrw} />}
      <Disclaimer>과거 성과는 미래 수익을 보장하지 않습니다. 백테스트는 실제 수집된 일별 종가와 분배금 기록으로 계산한 결과이며, 실제 체결 가격·세금(양도소득세 등)·환전 비용·분배금 지급 시점에 따라 실제 결과는 달라집니다.</Disclaimer>
    </div>
  );
}

function CoverageTable({ cov, loading, errors, onAlign, start }: { cov: ReturnType<typeof checkCoverage> | null; loading: boolean; errors: Record<string, string>; onAlign: (d: string) => void; start: string }) {
  if (loading && !cov) return <p className="mt-3 text-xs text-muted">종목별 데이터 범위를 확인하는 중…</p>;
  if (!cov) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-semibold text-ink-2">종목별 실제 데이터 범위 (상장일·제공처 기록 시작일 이후만 계산)</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {cov.items.map((it) => {
          const bad = !it.first || start < it.first;
          return (
            <span key={it.symbol} className={`rounded-md border px-2 py-1 ${bad ? "border-critical/50 bg-critical-soft" : "border-line"}`}>
              <span className="font-semibold">{it.symbol}</span> <span className="num">{it.first ?? "데이터 없음"} ~ {it.last ?? ""}</span>
              {errors[it.symbol] && <span className="text-critical"> ({errors[it.symbol]})</span>}
            </span>
          );
        })}
      </div>
      {cov.commonStart && (
        <p className="mt-2 text-xs text-ink-2">
          모든 종목의 공통 기간: <span className="num">{cov.commonStart} ~ {cov.commonEnd}</span>
          {start < cov.commonStart && (
            <button type="button" className="btn btn-sm ml-2" onClick={() => onAlign(cov.commonStart as string)}>
              공통 기간으로 맞추기
            </button>
          )}
        </p>
      )}
    </div>
  );
}

const fmtYears = (y: number) => (y >= 1 ? `${y.toFixed(1)}년` : `${Math.round(y * 12)}개월`);

function Results({ out, showKrw }: { out: RunOutput; showKrw: boolean }) {
  const mains = out.items.map((x) => x.suite.main as BacktestResult);
  const benchMain = out.bench?.suite.main.ok ? (out.bench.suite.main as BacktestResult) : null;
  const all = [...mains, ...(benchMain ? [benchMain] : [])];
  const names = [...out.items.map((x) => `${x.p.key}. ${x.p.name}`), ...(benchMain ? [`벤치마크 ${out.bench?.symbol}`] : [])];
  const colors = [...out.items.map((_, i) => SERIES_VARS[i]), "--s5"];
  const r0 = mains[0];
  const [heat, setHeat] = useState(0);
  const [incomeIdx, setIncomeIdx] = useState(0);
  const dates = r0.dates;
  const align = (r: BacktestResult, arr: number[]) => {
    const m = new Map(r.dates.map((d, i) => [d, arr[i]]));
    return dates.map((d) => m.get(d) ?? null);
  };
  const years = [...new Set(all.flatMap((r) => r.annual.map((a) => a.year)))].sort();
  const flipped = (i: number) => (i < out.items.length ? out.items[i].suite.flipped : out.bench?.suite.flipped) ?? null;
  const priceOnly = (i: number) => (i < out.items.length ? out.items[i].suite.priceOnly : out.bench?.suite.priceOnly) ?? null;
  const comps = benchMain ? mains.map((r) => compareWithBenchmark(r, benchMain)) : [];
  const cgOn = Boolean(r0.capitalGains);

  const row = (label: string, f: (r: BacktestResult, i: number) => ReactNode, help?: string) => (
    <tr>
      <th className="text-left font-normal text-ink-2" title={help}>
        {label}
      </th>
      {all.map((r, i) => (
        <td key={i} className="r">
          {f(r, i)}
        </td>
      ))}
    </tr>
  );
  const pickBy = (k: "heat" | "income") => (
    <Seg
      label={k === "heat" ? "히트맵 포트폴리오" : "분배금 포트폴리오"}
      value={k === "heat" ? heat : incomeIdx}
      onChange={k === "heat" ? setHeat : setIncomeIdx}
      options={all.map((_, i) => ({ v: i, l: i < mains.length ? out.items[i].p.key : "벤치마크" }))}
    />
  );

  const table = (
    <div className="overflow-x-auto">
      <table className="table-basic min-w-[560px]">
        <thead>
          <tr>
            <th />
            {names.map((n, i) => (
              <th key={n} className="r">
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: `var(${colors[i]})` }} />
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row("최종 평가금액", (r) => <span className="font-semibold">{usd(r.finalValue, 0)}</span>)}
          {row("총 납입 원금", (r) => `${usd(r.totalContributed, 0)} (${r.contributions}회 추가)`)}
          {row("손익", (r) => <span className={tone(r.profit)}>{usd(r.profit, 0)}</span>)}
          {row("총수익률 (납입 원금 대비)", (r) => <span className={tone(r.totalReturnPct)}>{pct(r.totalReturnPct)}</span>)}
          {row("시간가중 누적 수익률", (r) => pct(r.twrReturnPct), "추가 납입 시점의 영향을 뺀 전략 자체의 수익률")}
          {row("연환산 수익률 (CAGR)", (r) => pct(r.cagrPct), "시간가중 수익률 기준. 1년 미만은 표시하지 않음")}
          {row("금액가중 수익률 (IRR)", (r) => pct(r.irrPct), "납입 시점까지 반영한 실제 투자자 연 수익률")}
          {row("최대 낙폭 (MDD)", (r) => <span className="text-down">{pct(r.mddPct)}</span>)}
          {row("최대 낙폭 구간", (r) => <span className="text-[11px]">{r.mddPeak ? `${r.mddPeak} → ${r.mddTrough}${r.mddRecovery ? ` (회복 ${r.mddRecovery})` : " (미회복)"}` : "-"}</span>)}
          {row("최대 낙폭 회복 기간", (r) => {
            const x = riskExtras(r);
            return x.recoveryDays !== null ? `${x.recoveryDays}일` : x.underwaterDays !== null ? <span className="text-warn">미회복 ({x.underwaterDays}일째)</span> : "-";
          }, "최대 낙폭이 시작된 고점에서 그 고점을 다시 넘을 때까지 걸린 날")}
          {row("최악의 12개월 / 최악의 달", (r) => {
            const x = riskExtras(r);
            return (
              <span className="text-[12px]">
                <span className="text-down">{x.worst12mPct !== null ? pct(x.worst12mPct, 1) : "-"}</span>
                {x.worst12mEnd && <span className="text-muted"> (~{x.worst12mEnd})</span>} / <span className="text-down">{x.worstMonthPct !== null ? pct(x.worstMonthPct, 1) : "-"}</span>
                {x.worstMonth && <span className="text-muted"> ({x.worstMonth})</span>}
              </span>
            );
          }, "월말 기준 시간가중 수익률")}
          {row("변동성 (연환산)", (r) => (r.volPct !== null ? `${r.volPct.toFixed(1)}%` : "-"))}
          {row("연도별 수익률 변동 (표준편차)", (r) => {
            const x = riskExtras(r).annualStdPct;
            return x !== null ? `${x.toFixed(1)}%p` : "-";
          }, "1년 전체가 있는 연도들의 수익률이 해마다 얼마나 달랐는지")}
          {row("샤프 비율", (r) => (r.sharpe !== null ? r.sharpe.toFixed(2) : "-"), `무위험 수익률 ${r0.riskFreePct.toFixed(2)}%`)}
          {row("누적 분배금 (세전 / 세후)", (r) => `${usd(r.income.gross, 0)} / ${usd(r.income.net, 0)}`)}
          {row("└ 종목별 분배금 (세후)", (r) => (
            <span className="text-[11px] text-ink-2">
              {r.holdings.filter((h) => h.dividendsNet > 0).map((h) => (
                <span key={h.symbol} className="block whitespace-nowrap">
                  {h.symbol} {usd(h.dividendsNet, 0)}
                </span>
              ))}
              {!r.holdings.some((h) => h.dividendsNet > 0) && "없음"}
            </span>
          ))}
          {row(
            r0.config.reinvest ? "재투자 효과 (재투자 − 현금 보유)" : "재투자했다면 (차이)",
            (r, i) => {
              const f = flipped(i);
              if (!f || !f.ok) return "-";
              const d = r0.config.reinvest ? r.finalValue - f.finalValue : f.finalValue - r.finalValue;
              return <span className={tone(d)}>{usd(d, 0)}</span>;
            },
            "같은 조건에서 분배금 재투자 여부만 바꾼 결과와의 최종 평가금액 차이",
          )}
          {row(
            "가격만의 수익률 (분배금 제외)",
            (_r, i) => {
              const po = priceOnly(i);
              return po && po.ok ? pct(po.totalReturnPct) : "-";
            },
            "분배금을 전혀 받지 않았다고 본 가격 변화만의 결과",
          )}
          {row("거래 비용 합계", (r) => usd(r.costs, 0))}
          {cgOn && row("양도소득세 납부 (기간 중)", (r) => (r.capitalGains ? usd(r.capitalGains.paidUsd, 0) : "-"))}
          {cgOn && row("세후 청산 가치", (r) => (r.capitalGains ? <span className="font-semibold">{usd(r.capitalGains.afterTaxLiquidationUsd, 0)}</span> : "-"), "기간 말 미납 세금과 전부 팔 때의 양도세를 뺀 금액")}
          {benchMain && row("벤치마크 대비 초과 총수익률", (_r, i) => (i < comps.length ? <span className={tone(comps[i].excessTotalPct)}>{pct(comps[i].excessTotalPct)}p</span> : "-"))}
          {benchMain && row("벤치마크 대비 초과 CAGR", (_r, i) => (i < comps.length ? <span className={tone(comps[i].excessCagrPct)}>{pct(comps[i].excessCagrPct)}p</span> : "-"))}
          {benchMain && row("벤치마크 대비 최대 상대 낙폭", (_r, i) => (i < comps.length ? pct(comps[i].relMddPct) : "-"), "벤치마크 대비 상대 성과가 고점에서 가장 많이 뒤처진 폭")}
        </tbody>
      </table>
    </div>
  );

  const tabs = [
    { key: "table", label: "상세 비교", content: table },
    {
      key: "chart",
      label: "자산 추이·낙폭",
      content: (
        <div className="flex flex-col gap-6">
          <SimLineChart
            dates={dates}
            lines={[...all.map((r, i) => ({ key: names[i], label: names[i], values: align(r, r.value), color: colors[i] })), { key: "c", label: "납입 원금", values: align(r0, r0.contributed), dashed: true, color: "--axis" }]}
            format="usd"
            logToggle
            height={320}
            ariaLabel="자산 가치 추이"
          />
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">낙폭 (시간가중, 추가 납입 효과 제외)</p>
            <SimLineChart dates={dates} lines={all.map((r, i) => ({ key: names[i], label: names[i], values: align(r, r.drawdown), color: colors[i] }))} format="pct" height={200} baseline={0} ariaLabel="낙폭 추이" />
          </div>
        </div>
      ),
    },
    {
      key: "periods",
      label: "연도·월별",
      content: (
        <div className="flex flex-col gap-6">
          <GroupedBars categories={years} series={all.map((r, i) => ({ label: names[i], values: years.map((y) => r.annual.find((a) => a.year === y)?.retPct ?? null), color: colors[i] }))} format="pct" ariaLabel="연도별 수익률 비교" />
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-2">월별 수익률 히트맵</p>
              {pickBy("heat")}
            </div>
            <ReturnHeatmap monthly={all[heat].monthly} annual={all[heat].annual} />
          </div>
        </div>
      ),
    },
    {
      key: "income",
      label: "분배금",
      content: (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-ink-2">받은 분배금(세전)을 지급일(없으면 배당락일) 기준 월로 합계</p>
            {pickBy("income")}
          </div>
          {all[incomeIdx].monthlyIncome.length ? (
            <BarChartSvg points={all[incomeIdx].monthlyIncome.map((m) => ({ label: m.ym, value: m.gross, sub: `세후 ${usd(m.net)}` }))} valueFormat="usd2" ariaLabel="월별 분배금" />
          ) : (
            <p className="text-sm text-muted">이 기간에 받은 분배금이 없습니다.</p>
          )}
          <IncomeBySymbol r={all[incomeIdx]} />
        </div>
      ),
    },
    ...(benchMain
      ? [
          {
            key: "bench",
            label: `${out.bench?.symbol} 대비`,
            content: (
              <div>
                <p className="mb-2 text-xs text-ink-2">포트폴리오 ÷ 벤치마크 (시간가중, 시작 100). 100보다 크면 벤치마크보다 앞선 상태</p>
                <SimLineChart dates={comps[0].relDates} lines={comps.map((c, i) => ({ key: names[i], label: names[i], values: c.relative, color: colors[i] }))} format="index" baseline={100} height={260} ariaLabel="벤치마크 대비 상대 성과" />
              </div>
            ),
          },
        ]
      : []),
    {
      key: "holdings",
      label: "종목별",
      content: (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {mains.map((r, i) => (
              <div key={i} className="overflow-x-auto">
                <p className="mb-1 text-xs font-semibold">{names[i]} (기간 말)</p>
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th className="r">목표 비중</th>
                      <th className="r">기간 말 비중</th>
                      <th className="r">평가금액</th>
                      <th className="r">받은 분배금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.holdings.map((h) => (
                      <tr key={h.symbol}>
                        <td className="font-semibold">{h.symbol}</td>
                        <td className="r">{h.targetWeight.toFixed(1)}%</td>
                        <td className="r">{h.endWeight.toFixed(1)}%</td>
                        <td className="r">{usd(h.value, 0)}</td>
                        <td className="r">{usd(h.dividendsGross, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-semibold">참고: 각 종목의 전체 이용 가능 기간 성과</p>
            <p className="mb-2 text-[11px] text-muted">종목마다 상장일이 달라 기간이 서로 다릅니다. 위 공통 기간 결과와 섞어 비교하지 마세요 (분배금 재투자, 세금·비용 미반영).</p>
            <table className="table-basic">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>기간</th>
                  <th className="r">총수익률</th>
                  <th className="r">연환산 총수익률</th>
                  <th className="r">연환산 가격 수익률</th>
                  <th className="r">최대 낙폭</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set(all.flatMap((r) => r.holdings.map((h) => h.symbol)))].map((sym) => {
                  const f = out.series[sym] ? fullPeriodStat(out.series[sym]) : null;
                  return f ? (
                    <tr key={sym}>
                      <td className="font-semibold">{sym}</td>
                      <td className="num text-xs">
                        {f.first} ~ {f.last} ({fmtYears(f.years)})
                      </td>
                      <td className="r">{pct(f.totalReturnPct, 1)}</td>
                      <td className="r">{pct(f.totalCagrPct)}</td>
                      <td className="r">{pct(f.priceCagrPct)}</td>
                      <td className="r text-down">{pct(f.mddPct, 1)}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      key: "risk",
      label: "위험·안정성",
      content: <RiskPanel items={mains.map((r, i) => ({ name: names[i], dates: r.dates, index: r.twr, cagrPct: r.cagrPct, mddPct: r.mddPct }))} bench={benchMain ? { name: names[names.length - 1], dates: benchMain.dates, index: benchMain.twr } : null} rfPct={r0.riskFreePct} />,
    },
    ...(cgOn ? [{ key: "tax", label: "양도세", content: <CgResults all={all} names={names} /> }] : []),
    ...(showKrw ? [{ key: "krw", label: "원화 환산", content: <KrwResults all={all} names={names} fx={out.series["KRW=X"]} /> }] : []),
    {
      key: "basis",
      label: "검증·재현",
      content: <VerifyPanel out={out} all={all} names={names} />,
    },
  ];

  // 사용자가 알아야 할 조정(비중 정규화·벤치마크 제외)은 결과 위에 바로 보여 준다
  const warnNotes = out.normalizedNote.filter((n) => n.includes("자동 정규화") || n.startsWith("벤치마크"));
  return (
    <Section title="4. 결과" description={`계산 기간 ${r0.start} ~ ${r0.end} (${fmtYears(r0.years)}) · 모든 포트폴리오 같은 조건`}>
      {warnNotes.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{warnNotes.join(" ")}</Notice>
        </div>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {all.map((r, i) => (
          <div key={i} className="rounded-xl border border-line p-3.5">
            <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-ink-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${colors[i]})` }} />
              {names[i]}
            </p>
            <p className="num mt-1 text-xl font-bold">{usd(r.finalValue, 0)}</p>
            <dl className="mt-1 grid grid-cols-3 gap-1 text-[11px]">
              <div>
                <dt className="text-muted">총수익률</dt>
                <dd className={`num font-semibold ${tone(r.totalReturnPct)}`}>{pct(r.totalReturnPct, 1)}</dd>
              </div>
              <div>
                <dt className="text-muted">CAGR</dt>
                <dd className="num font-semibold">{pct(r.cagrPct, 1)}</dd>
              </div>
              <div>
                <dt className="text-muted">최대 낙폭</dt>
                <dd className="num font-semibold text-down">{pct(r.mddPct, 1)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {benchMain && (
        <p className="mb-4 text-sm text-ink-2">
          {mains.map((r, i) => (
            <span key={i} className="mr-3 inline-block">
              {out.items[i].p.key}는 {out.bench?.symbol}보다 최종 평가금액이 <b className={tone(comps[i].finalDiff)}>{usd(Math.abs(comps[i].finalDiff), 0)} {comps[i].finalDiff >= 0 ? "많았습니다" : "적었습니다"}</b>.
            </span>
          ))}
        </p>
      )}
      <PanelTabs label="백테스트 결과" tabs={tabs} />
    </Section>
  );
}

function CgResults({ all, names }: { all: BacktestResult[]; names: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {all.map((r, i) =>
          r.capitalGains ? (
            <div key={i} className="rounded-xl border border-line p-3.5 text-sm">
              <p className="truncate text-xs font-semibold text-ink-2">{names[i]}</p>
              <p className="mt-1">
                기간 중 납부 <b className="num">{usd(r.capitalGains.paidUsd, 0)}</b>
              </p>
              <p>
                미납(기간 말) <b className="num">{krw(r.capitalGains.unpaidKrw)}</b>
              </p>
              <p>
                전부 팔면 추가 <b className="num">{krw(r.capitalGains.liquidationExtraKrw)}</b>
              </p>
              <p className="mt-1 text-xs text-muted">
                세후 청산 가치 <b className="num text-ink">{usd(r.capitalGains.afterTaxLiquidationUsd, 0)}</b> (세전 {usd(r.finalValue, 0)})
              </p>
            </div>
          ) : null,
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>연도</th>
              {names.map((n) => (
                <th key={n} className="r">
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...new Set(all.flatMap((r) => r.capitalGains?.years.map((y) => y.year) ?? []))].sort().map((y) => (
              <tr key={y}>
                <td>{y}</td>
                {all.map((r, i) => {
                  const x = r.capitalGains?.years.find((z) => z.year === y);
                  return (
                    <td key={i} className="r text-xs">
                      {x ? (
                        <>
                          차익 {krw(x.netGainKrw)}
                          <span className="block font-semibold">세금 {krw(x.taxKrw)}</span>
                          <span className="block text-muted">{x.paidOn ? `${x.paidOn} 납부` : "미납"}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        리밸런싱·세금 납부를 위한 매도에서 생긴 차익을 연도별로 합산(손익통산)하고 250만 원을 공제한 뒤 22%를 다음 해 5월 첫 거래일에 납부(현금 → 부족하면 보유 비율대로 매도)한다고 가정했습니다. 이 포트폴리오 외 다른 해외주식 매매가 없다고 보며, 실제 신고는 결제일 기준환율을 씁니다.
      </p>
    </div>
  );
}

function KrwResults({ all, names, fx }: { all: BacktestResult[]; names: string[]; fx: PriceSeries | undefined }) {
  const views = all.map((r) => toKrw(r, fx));
  return (
    <div>
      <p className="mb-2 text-xs text-ink-2">각 날짜의 원/달러 환율로 평가금액과 납입금을 환산 (원화 수익률에는 환율 변동 효과 포함, 환전 비용 미반영)</p>
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>포트폴리오</th>
              <th className="r">원화 납입 원금 (납입 당시 환율)</th>
              <th className="r">원화 최종 평가금액 (마지막 날 환율)</th>
              <th className="r">원화 기준 수익률</th>
              <th className="r">USD 기준 수익률</th>
              <th>환율</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v, i) => (
              <tr key={i}>
                <td>{names[i]}</td>
                {v.ok ? (
                  <>
                    <td className="r">{krw(v.contributedKrw)}</td>
                    <td className="r">{krw(v.finalKrw)}</td>
                    <td className={`r ${tone(v.returnPct)}`}>{pct(v.returnPct)}</td>
                    <td className={`r ${tone(all[i].totalReturnPct)}`}>{pct(all[i].totalReturnPct)}</td>
                    <td className="num text-xs">
                      {v.fxStart.date} ₩{v.fxStart.rate.toFixed(1)} → {v.fxEnd.date} ₩{v.fxEnd.rate.toFixed(1)}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="text-xs text-warn">
                    {v.reason}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/** 결과 검증: 요청·실제 기간, 종목별 데이터 범위·출처, 뺀 날, 분배금·비용·세금·리밸런싱 조건, 재현 코드, 설정 내보내기 */
function VerifyPanel({ out, all, names }: { out: RunOutput; all: BacktestResult[]; names: string[] }) {
  const r0 = all[0];
  const v = r0.verification;
  const symbols = [...new Set(all.flatMap((r) => r.holdings.map((h) => h.symbol)))];
  const dataCode = dataFingerprint(symbols, out.series, v.used.start, v.used.end);
  const codes = all.map((r) => configFingerprint(r.config));
  const exportSettings = () => {
    const file: BacktestSettings = {
      ...out.settings,
      check: { configCodes: codes, dataCode, summary: all.map((r, i) => ({ name: names[i], finalValue: r.finalValue, twrReturnPct: r.twrReturnPct })), exportedAt: new Date().toISOString() },
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `backtest-settings-${v.used.start}_${v.used.end}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const cfg = out.cfg;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="overflow-x-auto">
        <table className="table-basic">
          <tbody>
            <tr>
              <th className="text-left font-normal text-ink-2">요청한 기간</th>
              <td className="num">
                {v.requested.start} ~ {v.requested.end}
              </td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">실제 계산 기간</th>
              <td className="num">
                {v.used.start} ~ {v.used.end} · {r0.tradingDays}거래일
                {(v.used.start !== v.requested.start || v.used.end !== v.requested.end) && <span className="ml-1 text-xs text-warn">(요청과 다름 — 아래 이유 참고)</span>}
              </td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">모든 종목 공통 데이터 기간</th>
              <td className="num">{v.commonStart && v.commonEnd ? `${v.commonStart} ~ ${v.commonEnd}` : "-"}</td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">가격이 없어 뺀 거래일</th>
              <td>
                {v.skippedDays ? `${v.skippedDays}일 (예: ${v.skippedSample.join(", ")}${v.skippedDays > v.skippedSample.length ? " …" : ""}) — 빈 가격을 채우지 않음` : "없음"}
              </td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">분배금</th>
              <td>
                {cfg.reinvest ? "포함 · 배당락일 종가로 같은 종목 재투자" : "포함 · 세후 금액을 이자 없는 현금으로 보유"} · 실제 반영 {v.divEvents}건 · 세율 {cfg.taxPct}%
              </td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">납입·리밸런싱·비용</th>
              <td>
                초기 {usd(cfg.initial)} · 매월 {usd(cfg.monthly)} ({cfg.timing === "month_start" ? "첫 거래일" : "마지막 거래일"}, {r0.contributions}회) · 리밸런싱 {REBALANCE_KO[cfg.rebalance as Rebalance]} ({v.rebalances}회) · 거래 비용 {cfg.costPct}% (합계 {usd(r0.costs)})
              </td>
            </tr>
            <tr>
              <th className="text-left font-normal text-ink-2">양도소득세</th>
              <td>{cfg.capitalGains ? "반영 (양도세 탭의 가정 참고)" : "반영 안 함"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <FairnessPanel all={all} names={names} normalized={out.normalizedNote.some((n) => n.includes("자동 정규화"))} />

      <div>
        <p className="mb-1 text-xs font-semibold text-ink-2">종목별 데이터</p>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>종목</th>
                <th>데이터 시작 (상장일·기록 시작)</th>
                <th>마지막 데이터</th>
                <th className="r">기간 중 분배금 반영</th>
                <th>출처 · 수집</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((sym) => {
                const c = all.map((r) => r.verification.coverage.find((x) => x.symbol === sym)).find(Boolean);
                if (!c) return null;
                return (
                  <tr key={sym}>
                    <td className="font-semibold">{sym}</td>
                    <td className="num">{c.first ?? "-"}</td>
                    <td className="num">{c.last ?? "-"}</td>
                    <td className="r">{c.divEvents}건</td>
                    <td className="text-xs">
                      {c.source ?? "-"} · {c.fetchedAt ? formatEt(c.fetchedAt) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-ink-2">계산 방식과 조정 내용</p>
        <ul className="list-disc pl-5 text-xs leading-relaxed text-ink-2">
          {[...out.normalizedNote, ...r0.notes].map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>가격: 일별 종가(주식분할만 반영). 분배금은 배당락일에 보유 수량 × 주당 지급액으로 한 번만 더합니다 — 수정주가를 쓰지 않아 이중 계산이 없습니다.</li>
          <li>모든 종목에 종가가 있는 날만 계산합니다. 상장 이전 기간은 계산하지 않으며, 가격이 없는 날을 채우지 않습니다.</li>
          <li>추가 납입금은 수익이 아니라 원금입니다. 수익률(TWR)은 납입 영향을 빼고 계산하고, 금액가중 수익률(IRR)은 납입 시점을 반영합니다.</li>
        </ul>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-ink-2">한계 (실제 투자 결과와 다를 수 있는 이유)</p>
        <ul className="list-disc pl-5 text-xs leading-relaxed text-ink-2">
          <li>실제 체결 가격(호가 차이·시간), 환전 비용·환율, 증권사별 수수료, 분배금 실제 입금일과 재투자 가능 시점이 반영되지 않습니다.</li>
          <li>분배금 세금은 입력한 단일 세율로만 뺍니다. 분배금 성격(자본 반환 등)별 세금 차이와 한국 종합과세는 반영하지 않습니다.</li>
          <li>운용보수는 이미 가격에 반영되어 있습니다. 상장 폐지·합병 종목은 데이터에 없어 생존 편향이 있을 수 있습니다.</li>
          <li>제공처 기록의 오류·누락이 그대로 결과에 들어갑니다. 과거 결과는 앞으로의 수익을 뜻하지 않습니다.</li>
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <p className="text-xs font-semibold text-ink-2">재현 확인</p>
        <p className="mt-1 text-xs text-ink-2">
          데이터 코드 <span className="num font-semibold">{dataCode}</span> · 설정 코드 {codes.map((c, i) => `${names[i].split(".")[0]} ${c}`).join(" · ")}
        </p>
        <p className="mt-1 text-[11px] text-muted">같은 설정과 같은 가격·분배금 기록(데이터 코드가 같음)으로 다시 계산하면 같은 결과가 나옵니다. 데이터가 새로 수집되거나 정정되면 데이터 코드와 결과가 달라질 수 있습니다.</p>
        <button type="button" className="btn btn-sm mt-2" onClick={exportSettings}>
          설정 내보내기 (JSON)
        </button>
        <span className="ml-2 text-[11px] text-muted">파일에는 포트폴리오 비중·계산 조건·재현 코드만 들어갑니다. 위 &lsquo;설정 파일 불러오기&rsquo;로 다시 채울 수 있습니다.</span>
        <p className="mt-2 text-[11px] text-muted">계산 시각: {new Date(out.at).toLocaleString("ko-KR")}</p>
      </div>
    </div>
  );
}

const LEVERAGED = INSTRUMENTS.filter((i) => i.leverage).map((i) => i.symbol);

/** 종목별 받은 분배금 (세전·세후·비중) + 연도별 */
function IncomeBySymbol({ r }: { r: BacktestResult }) {
  const hs = r.holdings;
  const years = [...new Set(hs.flatMap((h) => h.dividendYears.map((y) => y.year)))].sort();
  if (!r.income.gross) return null;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="overflow-x-auto">
        <p className="mb-1 text-xs font-semibold text-ink-2">종목별 받은 분배금 (기간 합계)</p>
        <table className="table-basic">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">세전</th>
              <th className="r">세금</th>
              <th className="r">세후</th>
              <th className="r">비중</th>
            </tr>
          </thead>
          <tbody>
            {hs.map((h) => (
              <tr key={h.symbol}>
                <td className="font-semibold">{h.symbol}</td>
                <td className="r">{usd(h.dividendsGross)}</td>
                <td className="r text-ink-2">{usd(h.dividendsGross - h.dividendsNet)}</td>
                <td className="r">{usd(h.dividendsNet)}</td>
                <td className="r">{r.income.gross > 0 ? `${((h.dividendsGross / r.income.gross) * 100).toFixed(1)}%` : "-"}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>합계</td>
              <td className="r">{usd(r.income.gross)}</td>
              <td className="r">{usd(r.income.tax)}</td>
              <td className="r">{usd(r.income.net)}</td>
              <td className="r">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <p className="mb-1 text-xs font-semibold text-ink-2">연도별 · 종목별 (세후, 지급일 기준 — 첫해·마지막 해는 일부 기간)</p>
        <table className="table-basic">
          <thead>
            <tr>
              <th>연도</th>
              {hs.map((h) => (
                <th key={h.symbol} className="r">
                  {h.symbol}
                </th>
              ))}
              <th className="r">합계</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const row = hs.map((h) => h.dividendYears.find((d) => d.year === y)?.net ?? 0);
              return (
                <tr key={y}>
                  <td>{y}</td>
                  {row.map((v, i) => (
                    <td key={i} className="r">
                      {usd(v)}
                    </td>
                  ))}
                  <td className="r font-semibold">{usd(row.reduce((a, b) => a + b, 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 비교 공정성 점검 + 위험 지표 나란히 */
function FairnessPanel({ all, names, normalized }: { all: BacktestResult[]; names: string[]; normalized: boolean }) {
  const f = fairnessCheck(all, { leveraged: LEVERAGED, normalized });
  const icon = { ok: "✓", warn: "!", fail: "✕" } as const;
  const cls = { ok: "text-good", warn: "text-warn", fail: "text-critical" } as const;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-2">비교 공정성 점검</p>
      <ul className="flex flex-col gap-1 text-xs">
        {f.items.map((i) => (
          <li key={i.label} className="flex gap-2">
            <span className={`w-4 shrink-0 font-bold ${cls[i.status]}`} aria-label={i.status === "ok" ? "통과" : i.status === "warn" ? "주의" : "문제"}>
              {icon[i.status]}
            </span>
            <span>
              <b>{i.label}</b> — <span className="text-ink-2">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${f.comparable ? "bg-surface-2 text-ink-2" : "bg-critical-soft text-critical"}`}>
        {f.comparable
          ? "같은 기간·같은 조건으로 계산해 서로 비교할 수 있습니다. 다만 위 주의 항목은 순위를 해석할 때 함께 보세요 — 수익률 순위만으로 판단하지 말고 최대 낙폭·회복 기간·최악의 기간을 같이 보세요."
          : "기간이나 조건이 서로 달라 순위를 매기지 않습니다. 같은 조건으로 다시 계산하세요."}
      </p>
      {all.length > 1 && f.comparable && (
        <div className="mt-2 overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th />
                <th className="r">연환산</th>
                <th className="r">최대 낙폭</th>
                <th className="r">회복 기간</th>
                <th className="r">최악 12개월</th>
                <th className="r">변동성</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r, i) => {
                const x = riskExtras(r);
                return (
                  <tr key={i}>
                    <td className="text-xs">{names[i]}</td>
                    <td className="r">{pct(r.cagrPct, 1)}</td>
                    <td className="r text-down">{pct(r.mddPct, 1)}</td>
                    <td className="r">{x.recoveryDays !== null ? `${x.recoveryDays}일` : x.underwaterDays !== null ? `미회복` : "-"}</td>
                    <td className="r">{x.worst12mPct !== null ? pct(x.worst12mPct, 1) : "-"}</td>
                    <td className="r">{r.volPct !== null ? `${r.volPct.toFixed(1)}%` : "-"}</td>
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
