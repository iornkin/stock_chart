"use client";
/**
 * 지표 전략 검증 — 한 종목에 기술적 지표 규칙(진입·청산)을 적용한 과거 시뮬레이션
 * 계산·지표는 lib/sim/strategy.ts · lib/ta.ts (차트와 같은 함수). 모두 브라우저 안에서 계산한다.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { chartUrl, getJson } from "@/lib/client/data-api";
import { useRuns } from "@/lib/client/user-data";
import { cleanBars } from "@/lib/ta";
import { etDate } from "@/lib/time";
import { barsFingerprint, ENGINE_VERSION, objectFingerprint } from "@/lib/sim/repro";
import { CONDITIONS, COND_BY_KIND, condParams, describeCond, neighborhood, paramGrid, regimes, runStrategy, segmentStats, walkForward, type Condition, type CondKind, type ExecConfig, type GridAxis, type StratBars, type StrategyResult, type StrategyRules } from "@/lib/sim/strategy";
import { Fold, Notice, Section } from "@/components/ui";
import PanelTabs from "@/components/PanelTabs";
import { Disclaimer, downloadCsv, Field, KV, parseNum, pct, Seg, SymbolSelect, tone, usd } from "./common";
import { SimLineChart } from "./charts";
import RiskPanel from "./RiskPanel";

type ChartJson = { bars: [number, number, number, number, number, number][]; dividends?: { exDate: string; amount: number; kind: string }[]; meta?: { source: string | null; fetchedAt: number | null } };

const TEMPLATES: { key: string; label: string; rules: StrategyRules; note: string }[] = [
  { key: "ma", label: "이동평균 교차 (50/200)", rules: { entry: [{ kind: "ma_cross_up", params: { fast: 50, slow: 200, ema: 0 } }], exit: [{ kind: "ma_cross_down", params: { fast: 50, slow: 200, ema: 0 } }] }, note: "추세 추종 — 횡보장에서는 잦은 거짓 신호가 생길 수 있음" },
  { key: "rsi", label: "RSI 과매도 회복", rules: { entry: [{ kind: "rsi_cross_up", params: { n: 14, level: 30 } }], exit: [{ kind: "rsi_above", params: { n: 14, level: 70 } }], stopLossPct: 10 }, note: "역추세 — 하락 추세가 길면 손절이 반복될 수 있음" },
  { key: "macd", label: "MACD 시그널 교차", rules: { entry: [{ kind: "macd_cross_up", params: { fast: 12, slow: 26, sig: 9 } }], exit: [{ kind: "macd_cross_down", params: { fast: 12, slow: 26, sig: 9 } }] }, note: "신호가 자주 나와 거래 비용 영향이 큼" },
  { key: "bb", label: "볼린저 하단 복귀", rules: { entry: [{ kind: "bb_back_inside", params: { n: 20, k: 2 } }], exit: [{ kind: "bb_above_upper", params: { n: 20, k: 2 } }], stopLossPct: 8, maxHoldBars: 60 }, note: "되돌림 매수 — 급락장에서는 손실이 커질 수 있음" },
  { key: "donchian", label: "돈치안 돌파 (55/20)", rules: { entry: [{ kind: "donchian_breakout", params: { n: 55 } }], exit: [{ kind: "donchian_breakdown", params: { n: 20 } }] }, note: "신고가 돌파 추세 추종" },
  { key: "st", label: "Supertrend 추세", rules: { entry: [{ kind: "supertrend_up", params: { n: 10, m: 3 } }], exit: [{ kind: "supertrend_down", params: { n: 10, m: 3 } }] }, note: "ATR 기반 추세 전환" },
  { key: "combo", label: "조합: 교차 + ADX + 거래량", rules: { entry: [{ kind: "ma_cross_up", params: { fast: 20, slow: 50, ema: 1 } }, { kind: "adx_above", params: { n: 14, level: 20 } }, { kind: "volume_above_ma", params: { n: 20, k: 1 } }], exit: [{ kind: "ma_cross_down", params: { fast: 20, slow: 50, ema: 1 } }], stopLossPct: 12 }, note: "여러 조건이 모두 맞을 때만 진입 → 거래가 적어짐" },
];

function toBars(j: ChartJson): StratBars | { error: string } {
  const c = cleanBars(j.bars.map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })));
  const bars = c.bars.filter((b) => Number.isFinite(b.c));
  if (bars.length < 30) return { error: "일봉 데이터가 부족합니다." };
  return {
    dates: bars.map((b) => etDate((b.t as number) * 1000)),
    o: bars.map((b) => b.o),
    h: bars.map((b) => b.h),
    l: bars.map((b) => b.l),
    c: bars.map((b) => b.c),
    v: bars.map((b) => (Number.isFinite(b.v) ? b.v : 0)),
    divs: (j.dividends ?? []).map((d) => ({ ex: d.exDate, amount: d.amount })),
  };
}

function slice(d: StratBars, from: string, to: string): StratBars {
  const a = d.dates.findIndex((x) => x >= from);
  let b = d.dates.length - 1;
  while (b >= 0 && d.dates[b] > to) b--;
  const s = Math.max(0, a);
  const pick = <T,>(xs: T[]) => xs.slice(s, b + 1);
  return { dates: pick(d.dates), o: pick(d.o), h: pick(d.h), l: pick(d.l), c: pick(d.c), v: pick(d.v), divs: d.divs };
}

const numKeys = (r: StrategyRules) => [...new Set([...r.entry, ...r.exit].flatMap((c) => (COND_BY_KIND.get(c.kind)?.params ?? []).filter((p) => p.key !== "ema").map((p) => p.key)))];
const parseList = (s: string) => [...new Set(s.split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x)))].slice(0, 8);

export default function StrategyClient() {
  const [symbol, setSymbol] = useState("QQQ");
  const [raw, setRaw] = useState<{ sym: string; bars: StratBars | null; error: string | null; meta: ChartJson["meta"] | null } | null>(null);
  const [tpl, setTpl] = useState("ma");
  const [rules, setRules] = useState<StrategyRules>(TEMPLATES[0].rules);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [exec, setExec] = useState<ExecConfig["execution"]>("next_open");
  const [fee, setFee] = useState("0.1");
  const [slip, setSlip] = useState("5");
  const [divTax, setDivTax] = useState("15");
  const [initial, setInitial] = useState("10000");
  const [splitPct, setSplitPct] = useState("70");
  const [axX, setAxX] = useState({ key: "fast", values: "20, 30, 50, 70, 100" });
  const [axY, setAxY] = useState({ key: "slow", values: "100, 150, 200, 250" });
  const [wfTrain, setWfTrain] = useState("3");
  const [run, setRun] = useState(0);
  const runs = useRuns();

  useEffect(() => {
    let alive = true;
    setRaw(null);
    getJson<ChartJson>(chartUrl(symbol, "1d"))
      .then((j) => {
        if (!alive) return;
        const b = toBars(j);
        if ("error" in b) setRaw({ sym: symbol, bars: null, error: b.error, meta: j.meta ?? null });
        else {
          setRaw({ sym: symbol, bars: b, error: null, meta: j.meta ?? null });
          const last = b.dates[b.dates.length - 1];
          const tenY = `${Number(last.slice(0, 4)) - 10}${last.slice(4)}`;
          setStart(tenY > b.dates[0] ? tenY : b.dates[0]);
          setEnd(last);
        }
      })
      .catch((e) => alive && setRaw({ sym: symbol, bars: null, error: String((e as Error).message ?? e), meta: null }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const pickTemplate = (k: string) => {
    const t = TEMPLATES.find((x) => x.key === k);
    if (!t) return;
    setTpl(k);
    setRules(t.rules);
    const keys = numKeys(t.rules);
    const def = (key: string) => [...t.rules.entry, ...t.rules.exit].map((c) => condParams(c)[key]).find((v) => v !== undefined) ?? 10;
    const around = (v: number) => [...new Set([0.5, 0.75, 1, 1.25, 1.5].map((m) => Math.max(1, Math.round(v * m))))].join(", ");
    setAxX({ key: keys[0] ?? "", values: keys[0] ? around(def(keys[0])) : "" });
    setAxY({ key: keys[1] ?? "", values: keys[1] ? around(def(keys[1])) : "" });
  };

  const cfg: ExecConfig = { execution: exec, initial: parseNum(initial), commissionPct: parseNum(fee) || 0, slippageBps: parseNum(slip) || 0, divTaxPct: parseNum(divTax) || 0 };

  const out = useMemo(() => {
    if (!run || !raw?.bars) return null;
    // 지표 계산을 위해 시작일 이전 데이터(최대 400봉)는 '준비 구간'으로 쓰고, 결과는 시작일부터 본다
    const full = raw.bars;
    const sIdx = Math.max(0, full.dates.findIndex((d) => d >= start));
    const warm = Math.max(0, sIdx - 400);
    const data = slice(full, full.dates[warm], end);
    const res = runStrategy(data, rules, cfg);
    if ("error" in res) return { error: res.error };
    const from = data.dates.findIndex((d) => d >= start);
    const view = viewFrom(res, Math.max(0, from), cfg.initial);
    const splitIdx = Math.max(1, Math.min(view.dates.length - 2, Math.floor(((parseNum(splitPct) || 70) / 100) * (view.dates.length - 1))));
    const ax: GridAxis | null = axX.key && parseList(axX.values).length ? { key: axX.key, label: axX.key, values: parseList(axX.values) } : null;
    const ay: GridAxis | null = axY.key && axY.key !== axX.key && parseList(axY.values).length ? { key: axY.key, label: axY.key, values: parseList(axY.values) } : null;
    const offset = Math.max(0, from);
    const grid = ax ? paramGrid(data, rules, cfg, ax, ay, offset + splitIdx) : [];
    const nb = ax ? neighborhood(grid, ax, ay, (c) => c.isSharpe) : null;
    const wf = ax ? walkForward(slice(data, data.dates[0], end), rules, cfg, ax, ay, Math.max(1, parseNum(wfTrain) || 3), 1) : null;
    // 미래 정보 검사: 분할 지점 뒤 가격을 크게 바꿔 다시 계산 → 분할 지점 전 거래·평가금액이 같아야 한다
    const cut = offset + splitIdx;
    const perturbed: StratBars = { ...data, c: data.c.map((x, i) => (i > cut ? x * 1.37 : x)), o: data.o.map((x, i) => (i > cut ? x * 0.71 : x)), h: data.h.map((x, i) => (i > cut ? x * 1.5 : x)), l: data.l.map((x, i) => (i > cut ? x * 0.6 : x)) };
    const pr = runStrategy(perturbed, rules, cfg);
    const sameEq = !("error" in pr) && pr.equity.slice(0, cut + 1).every((v, i) => v === res.equity[i]);
    const doneBefore = (r: StrategyResult) => r.trades.filter((t) => t.exitDate !== null && t.exitDate <= data.dates[cut]).map((t) => `${t.entryDate}|${t.exitDate}|${t.entryPrice}|${t.exitPrice}`).join(";");
    const sameTrades = !("error" in pr) && doneBefore(pr) === doneBefore(res);
    const reg = regimes(view.dates, view.equity, view.buyHold);
    const dataCode = barsFingerprint(data.dates, [data.o, data.h, data.l, data.c, data.v], view.dates[0], view.dates[view.dates.length - 1]);
    return { res, view, splitIdx, grid, nb, ax, ay, wf, lookahead: { sameEq, sameTrades, cutDate: data.dates[cut] }, reg, dataCode, configCode: objectFingerprint({ rules, cfg, start, end }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const editCond = (side: "entry" | "exit", i: number, c: Condition | null) => setRules((r) => ({ ...r, [side]: c ? r[side].map((x, k) => (k === i ? c : x)) : r[side].filter((_, k) => k !== i) }));
  const addCond = (side: "entry" | "exit", kind: CondKind) => {
    const d = COND_BY_KIND.get(kind);
    if (d) setRules((r) => ({ ...r, [side]: [...r[side], { kind, params: Object.fromEntries(d.params.map((p) => [p.key, p.def])) }] }));
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="1. 종목과 기간" description="일봉 시가·고가·저가·종가·거래량(분할 반영)과 실제 분배금 기록을 씁니다. 차트에 쓰는 데이터와 같습니다.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="종목">
            <SymbolSelect value={symbol} onChange={setSymbol} label="전략 종목" />
          </Field>
          <Field label="시작일" hint={raw?.bars ? `데이터 ${raw.bars.dates[0]}부터` : undefined}>
            <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} aria-label="전략 시작일" />
          </Field>
          <Field label="종료일">
            <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="전략 종료일" />
          </Field>
          <Field label="초기 자금 (USD)">
            <input className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} aria-label="전략 초기 자금" />
          </Field>
        </div>
        {!raw && <p className="mt-2 text-sm text-muted">일봉 데이터를 불러오는 중…</p>}
        {raw?.error && <p className="mt-2 text-sm text-critical">{raw.error}</p>}
        <p className="mt-2 text-xs text-muted">
          지표를 계산하려면 시작일 이전 데이터가 필요해 최대 400봉을 &lsquo;준비 구간&rsquo;으로 쓰고, 성과는 시작일부터 계산합니다. 지원 종목은 지금 상장된 종목뿐이라 상장 폐지된 종목이 빠지는 생존 편향이 있습니다.{" "}
          <Link href={`/stock/${symbol}`} className="underline">
            차트에서 같은 지표 보기
          </Link>
        </p>
      </Section>

      <Section title="2. 전략 규칙" description="신호는 그날 종가가 확정된 뒤 그날까지의 데이터로만 판단하고, 다음 봉에 체결합니다.">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input py-1 text-sm" value={tpl} onChange={(e) => pickTemplate(e.target.value)} aria-label="전략 예시">
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">{TEMPLATES.find((t) => t.key === tpl)?.note}</span>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {(["entry", "exit"] as const).map((side) => (
            <div key={side} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-sm font-semibold">{side === "entry" ? "진입 (모두 맞을 때 · AND)" : "청산 (하나라도 맞으면 · OR)"}</p>
              <ul className="flex flex-col gap-2">
                {rules[side].map((c, i) => {
                  const d = COND_BY_KIND.get(c.kind);
                  const p = condParams(c);
                  return (
                    <li key={i} className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{d?.label}</span>
                        {d?.params.map((q) => (
                          <label key={q.key} className="flex items-center gap-1">
                            {q.label}
                            <input type="number" className="w-16 rounded border border-line bg-surface px-1 py-0.5" value={c.params[q.key] ?? q.def} min={q.min} max={q.max} step={q.step ?? 1} onChange={(e) => editCond(side, i, { ...c, params: { ...c.params, [q.key]: Number(e.target.value) } })} aria-label={`${side === "entry" ? "진입" : "청산"} ${d.label} ${q.label}`} />
                          </label>
                        ))}
                        <button type="button" className="ml-auto text-muted hover:text-critical" onClick={() => editCond(side, i, null)} aria-label={`${d?.label} 조건 지우기`}>
                          ✕
                        </button>
                      </div>
                      <p className="mt-0.5 text-muted">{describeCond({ ...c, params: p })}</p>
                    </li>
                  );
                })}
              </ul>
              <select className="input mt-2 py-1 text-xs" value="" onChange={(e) => e.target.value && addCond(side, e.target.value as CondKind)} aria-label={`${side === "entry" ? "진입" : "청산"} 조건 추가`}>
                <option value="">+ 조건 추가…</option>
                {CONDITIONS.map((c) => (
                  <option key={c.kind} value={c.kind}>
                    {c.label}
                    {c.role === "filter" ? " (필터)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="손절 (%, 종가 기준)">
            <input className="input w-24" inputMode="decimal" value={rules.stopLossPct ?? ""} placeholder="없음" onChange={(e) => setRules({ ...rules, stopLossPct: e.target.value ? parseNum(e.target.value) : null })} aria-label="손절" />
          </Field>
          <Field label="익절 (%)">
            <input className="input w-24" inputMode="decimal" value={rules.takeProfitPct ?? ""} placeholder="없음" onChange={(e) => setRules({ ...rules, takeProfitPct: e.target.value ? parseNum(e.target.value) : null })} aria-label="익절" />
          </Field>
          <Field label="최대 보유 (봉)">
            <input className="input w-24" inputMode="numeric" value={rules.maxHoldBars ?? ""} placeholder="없음" onChange={(e) => setRules({ ...rules, maxHoldBars: e.target.value ? Math.round(parseNum(e.target.value)) : null })} aria-label="최대 보유" />
          </Field>
        </div>
      </Section>

      <Section title="3. 체결·비용 가정">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="체결 시점">
            <Seg label="체결 시점" value={exec} onChange={setExec} options={[{ v: "next_open", l: "다음 날 시가" }, { v: "next_close", l: "다음 날 종가" }]} />
          </Field>
          <Field label="수수료 (%, 한 번 거래당)">
            <input className="input w-24" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="전략 수수료" />
          </Field>
          <Field label="슬리피지 (bp)" hint="1bp = 0.01%. 살 때 비싸게·팔 때 싸게">
            <input className="input w-24" inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value)} aria-label="슬리피지" />
          </Field>
          <Field label="분배금 세율 (%)">
            <input className="input w-20" inputMode="decimal" value={divTax} onChange={(e) => setDivTax(e.target.value)} aria-label="전략 분배금 세율" />
          </Field>
        </div>
        <Fold summary="검증 설정 (학습·평가 구간, 파라미터 민감도, 워크포워드)">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <Field label="학습 구간 비율 (%)" hint="앞쪽은 학습, 뒤쪽은 평가">
              <input className="input w-20" inputMode="decimal" value={splitPct} onChange={(e) => setSplitPct(e.target.value)} aria-label="학습 구간 비율" />
            </Field>
            <Field label="민감도 파라미터 1">
              <span className="flex gap-1">
                <select className="input py-1" value={axX.key} onChange={(e) => setAxX({ ...axX, key: e.target.value })} aria-label="민감도 파라미터 1">
                  <option value="">없음</option>
                  {numKeys(rules).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input className="input w-40" value={axX.values} onChange={(e) => setAxX({ ...axX, values: e.target.value })} aria-label="민감도 값 1" />
              </span>
            </Field>
            <Field label="민감도 파라미터 2">
              <span className="flex gap-1">
                <select className="input py-1" value={axY.key} onChange={(e) => setAxY({ ...axY, key: e.target.value })} aria-label="민감도 파라미터 2">
                  <option value="">없음</option>
                  {numKeys(rules).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input className="input w-40" value={axY.values} onChange={(e) => setAxY({ ...axY, values: e.target.value })} aria-label="민감도 값 2" />
              </span>
            </Field>
            <Field label="워크포워드 학습 (년)">
              <input className="input w-16" inputMode="numeric" value={wfTrain} onChange={(e) => setWfTrain(e.target.value)} aria-label="워크포워드 학습 연수" />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">같은 이름의 파라미터는 진입·청산 조건에 함께 적용합니다 (예: fast 를 바꾸면 골든크로스·데드크로스 둘 다). 값은 쉼표로 최대 8개.</p>
        </Fold>
        <button type="button" className="btn btn-primary mt-3" disabled={!raw?.bars} onClick={() => setRun((x) => x + 1)}>
          전략 백테스트 실행
        </button>
      </Section>

      {out && "error" in out && <Notice tone="warn">{out.error}</Notice>}
      {out && !("error" in out) && (
        <Results
          out={out}
          symbol={symbol}
          initial={cfg.initial}
          rules={rules}
          onSave={() =>
            runs.add({
              kind: "strategy",
              title: `지표 전략 · ${symbol} · ${TEMPLATES.find((t) => t.key === tpl)?.label ?? "직접 구성"}`,
              summary: [
                { label: "전략 총수익률", value: pct(out.view.totalReturnPct) },
                { label: "매수 후 보유", value: pct(out.view.bhTotalReturnPct) },
                { label: "최대 낙폭", value: pct(out.view.mddPct, 1) },
                { label: "거래", value: `${out.res.trades.length}회` },
              ],
              config: { symbol, rules, cfg, start, end },
              meta: { engine: ENGINE_VERSION, dataFrom: out.view.dates[0], dataTo: out.view.dates[out.view.dates.length - 1], dataCode: out.dataCode, configCode: out.configCode, assumptions: [`체결 ${exec === "next_open" ? "다음 날 시가" : "다음 날 종가"}`, `수수료 ${cfg.commissionPct}%`, `슬리피지 ${cfg.slippageBps}bp`, `분배금 세율 ${cfg.divTaxPct}%`] },
            })
          }
        />
      )}
      <Disclaimer>
        과거 데이터에 규칙을 적용한 가정 시뮬레이션이며 실제 체결 기록이 아닙니다. 지표나 조건을 더한다고 수익이 보장되지 않으며, 과거에 가장 좋았던 파라미터가 앞으로도 좋다는 뜻이 아닙니다. 거래 비용·세금·체결 가능성은 실제와 다를 수 있습니다.
      </Disclaimer>
    </div>
  );
}

/** 준비 구간을 잘라 시작일부터 다시 1로 맞춘 결과 */
function viewFrom(r: StrategyResult, from: number, initial: number) {
  const eq0 = r.equity[from];
  const bh0 = r.buyHold[from];
  const dates = r.dates.slice(from);
  const equity = r.equity.slice(from).map((v) => (v / eq0) * initial);
  const buyHold = r.buyHold.slice(from).map((v) => (v / bh0) * initial);
  const s = segmentStats(dates, equity, 0, equity.length - 1);
  const b = segmentStats(dates, buyHold, 0, buyHold.length - 1);
  const trades = r.trades.filter((t) => t.entryDate >= dates[0] || (t.exitDate ?? "9999") >= dates[0]);
  return { dates, equity, buyHold, trades, totalReturnPct: s?.totalReturnPct ?? 0, cagrPct: s?.cagrPct ?? null, mddPct: s?.mddPct ?? 0, sharpe: s?.sharpe ?? null, bhTotalReturnPct: b?.totalReturnPct ?? 0, bhCagrPct: b?.cagrPct ?? null, bhMddPct: b?.mddPct ?? 0, bhSharpe: b?.sharpe ?? null, inMarket: r.inMarket.slice(from) };
}

type Out = {
  res: StrategyResult;
  view: ReturnType<typeof viewFrom>;
  splitIdx: number;
  grid: ReturnType<typeof paramGrid>;
  nb: ReturnType<typeof neighborhood>;
  ax: GridAxis | null;
  ay: GridAxis | null;
  wf: ReturnType<typeof walkForward>;
  lookahead: { sameEq: boolean; sameTrades: boolean; cutDate: string };
  reg: ReturnType<typeof regimes>;
  dataCode: string;
  configCode: string;
};

function Results({ out, symbol, initial, rules, onSave }: { out: Out; symbol: string; initial: number; rules: StrategyRules; onSave: () => void }) {
  const { res, view } = out;
  const st = res.stats;
  const [saved, setSaved] = useState(false);
  const isS = segmentStats(view.dates, view.equity, 0, out.splitIdx);
  const oosS = segmentStats(view.dates, view.equity, out.splitIdx, view.dates.length - 1);
  const isB = segmentStats(view.dates, view.buyHold, 0, out.splitIdx);
  const oosB = segmentStats(view.dates, view.buyHold, out.splitIdx, view.dates.length - 1);
  const tradesInView = view.trades;
  const tabs = [
    {
      key: "curve",
      label: "자산 곡선",
      content: <SimLineChart dates={view.dates} lines={[{ key: "s", label: "전략", values: view.equity }, { key: "b", label: "매수 후 보유", values: view.buyHold, dashed: true, color: "--s2" }]} format="usd" logToggle height={300} ariaLabel="전략 자산 곡선" />,
    },
    {
      key: "trades",
      label: `거래 내역 (${tradesInView.length})`,
      content: (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 text-xs text-ink-2">
            <span>진입 신호 {res.signals.entry}회 → 실제 매수 {res.trades.length}회 (보유 중이라 무시 {res.signals.ignoredEntry}회) · 청산 신호 {res.signals.exit}회</span>
            <button type="button" className="btn btn-sm ml-auto" onClick={() => downloadCsv(`strategy-${symbol}.csv`, [["신호일", "진입일", "진입가", "청산일", "청산가", "수량", "손익(USD)", "수익률(%)", "보유 봉", "보유 일", "받은 분배금", "청산 사유"], ...tradesInView.map((t) => [t.signalDate, t.entryDate, t.entryPrice, t.exitDate ?? "보유 중", t.exitPrice ?? "", t.shares, t.pnl, t.retPct, t.bars, t.days, t.dividends, t.exitReason ?? ""])])}>
              CSV 저장
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>진입 (신호일)</th>
                  <th className="r">진입가</th>
                  <th>청산</th>
                  <th className="r">청산가</th>
                  <th className="r">수익률</th>
                  <th className="r">손익</th>
                  <th className="r">보유</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                {[...tradesInView].reverse().slice(0, 200).map((t, i) => (
                  <tr key={i}>
                    <td className="num text-xs">
                      {t.entryDate} <span className="text-muted">({t.signalDate})</span>
                    </td>
                    <td className="r num">{t.entryPrice.toFixed(2)}</td>
                    <td className="num text-xs">{t.exitDate ?? <span className="text-warn">보유 중</span>}</td>
                    <td className="r num">{t.exitPrice?.toFixed(2) ?? "-"}</td>
                    <td className={`r num ${tone(t.retPct)}`}>{pct(t.retPct, 1)}</td>
                    <td className={`r num ${tone(t.pnl)}`}>{usd(t.pnl, 0)}</td>
                    <td className="r num">{t.days}일</td>
                    <td className="text-xs text-ink-2">{t.exitReason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      key: "stats",
      label: "거래 통계",
      content: (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KV label="승률" value={st.winRatePct !== null ? `${st.winRatePct.toFixed(0)}%` : "계산 불가"} sub={`청산 ${st.closed}회 중 이익 거래 비율`} />
            <KV label="평균 이익 / 평균 손실" value={`${st.avgWinPct !== null ? pct(st.avgWinPct, 1) : "-"} / ${st.avgLossPct !== null ? pct(st.avgLossPct, 1) : "-"}`} sub="거래당 수익률 (비용·분배금 포함)" />
            <KV label="손익비 (Profit Factor)" value={st.profitFactor !== null ? st.profitFactor.toFixed(2) : "계산 불가"} sub="이익 합 ÷ 손실 합" />
            <KV label="거래당 기대값" value={st.expectancyPct !== null ? pct(st.expectancyPct, 2) : "계산 불가"} sub="청산된 거래의 평균 수익률" />
            <KV label="평균 보유 기간" value={st.avgDays !== null ? `${st.avgDays.toFixed(0)}일 (${(st.avgBars ?? 0).toFixed(0)}봉)` : "-"} />
            <KV label="시장 노출" value={`${st.exposurePct.toFixed(0)}%`} sub="보유한 봉 ÷ 전체 봉" />
            <KV label="연 회전율" value={st.turnover !== null ? `${st.turnover.toFixed(1)}배` : "-"} sub="(매수+매도 금액) ÷ 평균 자산 ÷ 연수" />
            <KV label="비용 합계" value={usd(res.costs, 0)} sub="수수료 + 슬리피지" />
          </div>
          {[...st.notes, ...res.notes].map((n) => (
            <p key={n} className="text-xs text-muted">
              {n}
            </p>
          ))}
        </div>
      ),
    },
    {
      key: "risk",
      label: "위험·안정성",
      content: <RiskPanel items={[{ name: "전략", dates: view.dates, index: view.equity, cagrPct: view.cagrPct, mddPct: view.mddPct }, { name: "매수 후 보유", dates: view.dates, index: view.buyHold, cagrPct: view.bhCagrPct, mddPct: view.bhMddPct }]} bench={{ name: "매수 후 보유", dates: view.dates, index: view.buyHold }} rfPct={0} />,
    },
    {
      key: "split",
      label: "학습·평가 구간",
      content: (
        <div className="flex flex-col gap-2">
          <table className="table-basic">
            <thead>
              <tr>
                <th>구간</th>
                <th className="r">전략 수익률</th>
                <th className="r">전략 CAGR</th>
                <th className="r">전략 최대 낙폭</th>
                <th className="r">전략 샤프</th>
                <th className="r">보유 수익률</th>
                <th className="r">보유 샤프</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["학습 (앞)", isS, isB],
                ["평가 (뒤)", oosS, oosB],
              ].map(([l, s, b]) => {
                const S = s as ReturnType<typeof segmentStats>;
                const B = b as ReturnType<typeof segmentStats>;
                return (
                  <tr key={l as string}>
                    <td className="text-xs">
                      {l as string} {S ? `${S.from} ~ ${S.to}` : ""}
                    </td>
                    <td className={`r num ${tone(S?.totalReturnPct)}`}>{S ? pct(S.totalReturnPct, 1) : "-"}</td>
                    <td className="r num">{S?.cagrPct !== null && S?.cagrPct !== undefined ? pct(S.cagrPct, 1) : "1년 미만"}</td>
                    <td className="r num text-down">{S ? pct(S.mddPct, 1) : "-"}</td>
                    <td className="r num">{S?.sharpe !== null && S?.sharpe !== undefined ? S.sharpe.toFixed(2) : "-"}</td>
                    <td className={`r num ${tone(B?.totalReturnPct)}`}>{B ? pct(B.totalReturnPct, 1) : "-"}</td>
                    <td className="r num">{B?.sharpe !== null && B?.sharpe !== undefined ? B.sharpe.toFixed(2) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted">규칙과 파라미터를 학습 구간만 보고 정했다면, 평가 구간 성과가 실제에 더 가까운 추정입니다. 평가 구간에서 크게 나빠지면 과거에 맞춰진(과최적화) 규칙일 수 있습니다.</p>
        </div>
      ),
    },
    {
      key: "grid",
      label: "파라미터 민감도",
      content: out.ax ? <GridView out={out} /> : <p className="text-sm text-muted">검증 설정에서 민감도 파라미터를 고르세요.</p>,
    },
    {
      key: "wf",
      label: "워크포워드",
      content: out.wf ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-2">
            매 창마다 학습 구간에서 샤프가 가장 높은 파라미터를 고르고 바로 다음 1년(평가)에 적용한 결과만 이어 붙였습니다. 평가 구간 연환산 {out.wf.stats?.cagrPct !== null && out.wf.stats?.cagrPct !== undefined ? pct(out.wf.stats.cagrPct, 1) : "-"} · 최대 낙폭 {out.wf.stats ? pct(out.wf.stats.mddPct, 1) : "-"} · 샤프 {out.wf.stats?.sharpe?.toFixed(2) ?? "-"}
          </p>
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>학습</th>
                  <th>평가</th>
                  <th>고른 값</th>
                  <th className="r">학습 샤프</th>
                  <th className="r">평가 수익률</th>
                </tr>
              </thead>
              <tbody>
                {out.wf.windows.map((w) => (
                  <tr key={w.testFrom}>
                    <td className="num text-xs">
                      {w.trainFrom} ~ {w.trainTo}
                    </td>
                    <td className="num text-xs">
                      {w.testFrom} ~ {w.testTo}
                    </td>
                    <td className="text-xs">
                      {out.ax?.key}={w.chosen.x}
                      {out.ay && w.chosen.y !== null ? `, ${out.ay.key}=${w.chosen.y}` : ""}
                    </td>
                    <td className="r num">{w.trainSharpe?.toFixed(2) ?? "-"}</td>
                    <td className={`r num ${tone(w.testReturnPct)}`}>{pct(w.testReturnPct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">고른 값이 창마다 크게 바뀌면 파라미터가 안정적이지 않다는 뜻입니다. 각 파라미터의 전략은 처음부터 끝까지 계속 운용한 결과를 쓰며(보유 상태가 이어짐), 고를 때는 그 창 끝까지의 성과만 봅니다.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">학습 + 평가 기간을 채울 만큼 데이터가 없거나 민감도 파라미터가 없습니다.</p>
      ),
    },
    {
      key: "regime",
      label: "시장 국면",
      content: (
        <div className="flex flex-col gap-2">
          <table className="table-basic">
            <thead>
              <tr>
                <th>국면 (그해 보유 수익률)</th>
                <th className="r">연도 수</th>
                <th className="r">전략 평균</th>
                <th className="r">보유 평균</th>
              </tr>
            </thead>
            <tbody>
              {out.reg.groups.map((g) => (
                <tr key={g.regime}>
                  <td>{g.regime === "상승" ? "상승 (> +10%)" : g.regime === "하락" ? "하락 (< −10%)" : "횡보 (±10%)"}</td>
                  <td className="r">{g.years}</td>
                  <td className={`r num ${tone(g.strategyAvgPct)}`}>{g.strategyAvgPct !== null ? pct(g.strategyAvgPct, 1) : "-"}</td>
                  <td className={`r num ${tone(g.buyHoldAvgPct)}`}>{g.buyHoldAvgPct !== null ? pct(g.buyHoldAvgPct, 1) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-2">{out.reg.rows.map((r) => `${r.year} ${r.regime}: 전략 ${pct(r.strategyPct, 0)} / 보유 ${pct(r.buyHoldPct, 0)}`).join(" · ")}</p>
          <p className="text-xs text-muted">1년 전체가 있는 연도만 봅니다. 국면이 적게 나온 경우(예: 하락 연도 1~2개) 평균은 우연의 영향이 큽니다.</p>
        </div>
      ),
    },
    {
      key: "check",
      label: "검증",
      content: (
        <ul className="flex flex-col gap-1 text-sm">
          <li className={out.lookahead.sameEq && out.lookahead.sameTrades ? "text-good" : "text-critical"}>
            {out.lookahead.sameEq && out.lookahead.sameTrades ? "✓" : "✕"} 미래 정보 검사: {out.lookahead.cutDate} 이후 가격을 크게 바꿔 다시 계산해도 그 전의 평가금액·거래가 {out.lookahead.sameEq && out.lookahead.sameTrades ? "같습니다" : "달라졌습니다 (오류)"}.
          </li>
          <li>✓ 체결: 신호 다음 봉 {res.trades[0] ? `(예: 신호 ${res.trades[0].signalDate} → 체결 ${res.trades[0].entryDate})` : ""}. 같은 종가에 미리 체결하지 않습니다.</li>
          <li>✓ 지표: 차트와 같은 계산 함수 (lib/ta.ts). 진입 조건 {rules.entry.map(describeCond).join(" + ")} / 청산 {rules.exit.map(describeCond).join(" 또는 ") || "없음"}.</li>
          <li className="text-xs text-muted">
            재현: 계산 방식 {ENGINE_VERSION} · 데이터 코드 {out.dataCode} · 설정 코드 {out.configCode}. 같은 코드면 같은 결과가 나와야 합니다.
          </li>
        </ul>
      ),
    },
  ];
  return (
    <Section
      title="4. 결과"
      description={`${view.dates[0]} ~ ${view.dates[view.dates.length - 1]} · ${symbol} · 초기 ${usd(initial, 0)}`}
      right={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            onSave();
            setSaved(true);
          }}
        >
          {saved ? "저장함" : "결과 저장"}
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KV label="전략 총수익률" value={pct(view.totalReturnPct, 1)} valueClass={tone(view.totalReturnPct)} sub={`연 ${view.cagrPct !== null ? pct(view.cagrPct, 1) : "-"} · 매수 후 보유 ${pct(view.bhTotalReturnPct, 1)} (연 ${view.bhCagrPct !== null ? pct(view.bhCagrPct, 1) : "-"})`} />
        <KV label="최대 낙폭" value={pct(view.mddPct, 1)} valueClass="text-down" sub={`매수 후 보유 ${pct(view.bhMddPct, 1)}`} />
        <KV label="샤프 비율" value={view.sharpe?.toFixed(2) ?? "-"} sub={`매수 후 보유 ${view.bhSharpe?.toFixed(2) ?? "-"} (무위험 0%)`} />
        <KV label="거래" value={`${res.trades.length}회`} sub={`노출 ${st.exposurePct.toFixed(0)}% · 비용 ${usd(res.costs, 0)}`} />
      </div>
      <PanelTabs label="전략 결과" tabs={tabs} />
    </Section>
  );
}

function GridView({ out }: { out: Out }) {
  const ax = out.ax as GridAxis;
  const ay = out.ay;
  const [metric, setMetric] = useState<"isSharpe" | "isCagr" | "oosCagr">("isSharpe");
  const cell = (x: number, y: number | null) => out.grid.find((c) => c.x === x && c.y === y);
  const vals = out.grid.map((c) => c[metric]).filter((v): v is number => v !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const bg = (v: number | null) => {
    if (v === null || hi === lo) return undefined;
    const t = (v - lo) / (hi - lo);
    return `color-mix(in srgb, var(--accent) ${Math.round(t * 45)}%, transparent)`;
  };
  const nb = out.nb;
  return (
    <div className="flex flex-col gap-2">
      <Seg label="민감도 지표" value={metric} onChange={setMetric} options={[{ v: "isSharpe", l: "학습 샤프" }, { v: "isCagr", l: "학습 CAGR" }, { v: "oosCagr", l: "평가 CAGR" }]} />
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>
                {ax.key} \ {ay?.key ?? ""}
              </th>
              {(ay ? ay.values : [null]).map((y) => (
                <th key={String(y)} className="r">
                  {y ?? "값"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ax.values.map((x) => (
              <tr key={x}>
                <th className="text-left">{x}</th>
                {(ay ? ay.values : [null]).map((y) => {
                  const c = cell(x, y);
                  const v = c ? c[metric] : null;
                  const best = nb && nb.best.x === x && nb.best.y === y;
                  return (
                    <td key={String(y)} className={`r num ${best ? "font-bold" : ""}`} style={{ background: bg(v) }} title={c ? `거래 ${c.trades}회` : ""}>
                      {v === null ? "-" : metric === "isSharpe" ? v.toFixed(2) : pct(v, 1)}
                      {best ? " ★" : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nb && (
        <p className={`text-xs ${nb.neighborMean !== null && nb.neighborMean < nb.bestValue * 0.5 ? "text-warn" : "text-ink-2"}`}>
          학습 샤프 최고 ★ {ax.key}={nb.best.x}
          {ay && nb.best.y !== null ? `, ${ay.key}=${nb.best.y}` : ""}: {nb.bestValue.toFixed(2)} · 바로 옆 {nb.neighbors}칸 평균 {nb.neighborMean?.toFixed(2) ?? "-"} (최저 {nb.neighborMin?.toFixed(2) ?? "-"}).{" "}
          {nb.neighborMean !== null && nb.neighborMean < nb.bestValue * 0.5 ? "주변 값이 크게 낮아 우연히 잘 맞은 값일 가능성이 큽니다." : "주변 값도 비슷하면 파라미터가 조금 바뀌어도 결과가 크게 흔들리지 않는다는 뜻입니다."} 최고 칸의 평가 CAGR: {nb.best.oosCagr !== null ? pct(nb.best.oosCagr, 1) : "-"}.
        </p>
      )}
      <p className="text-xs text-muted">학습 구간 성과로 고른 최고 값을 그대로 믿지 마세요. 평가 구간 성과와 주변 값의 안정성을 함께 보세요.</p>
    </div>
  );
}


