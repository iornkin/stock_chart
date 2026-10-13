"use client";
/** 비교할 포트폴리오 여러 개를 입력하는 카드 (예시·저장한 전략 불러오기) */
import { useStrategies } from "@/lib/client/user-data";
import { HoldingsEditor, PRESETS, rowsFrom, type WeightRow } from "./common";

export interface PortfolioInput {
  key: string;
  name: string;
  rows: WeightRow[];
}

export const LETTERS = ["A", "B", "C", "D"];

export function defaultPortfolios(n = 2): PortfolioInput[] {
  return PRESETS.slice(0, n).map((p, i) => ({ key: LETTERS[i], name: p.name, rows: rowsFrom(p.items) }));
}

export default function PortfolioInputs({ list, onChange, max = 4 }: { list: PortfolioInput[]; onChange: (l: PortfolioInput[]) => void; max?: number }) {
  const strategies = useStrategies();
  const set = (i: number, patch: Partial<PortfolioInput>) => onChange(list.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p, i) => (
          <div key={p.key} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: `var(${["--s1", "--s2", "--s3", "--s7"][i]})` }}>
                {p.key}
              </span>
              <input className="input min-w-0 flex-1 py-1 text-sm" value={p.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`포트폴리오 ${p.key} 이름`} maxLength={60} />
              <select
                className="input w-28 shrink-0 py-1 text-sm"
                aria-label={`포트폴리오 ${p.key} 불러오기`}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("preset:")) {
                    const pr = PRESETS[Number(v.slice(7))];
                    set(i, { name: pr.name, rows: rowsFrom(pr.items) });
                  } else if (v.startsWith("strategy:")) {
                    const s = strategies.value.find((x) => x.id === v.slice(9));
                    if (s) set(i, { name: s.name, rows: rowsFrom(s.items) });
                  }
                }}
              >
                <option value="">불러오기…</option>
                <optgroup label="예시">
                  {PRESETS.map((pr, k) => (
                    <option key={pr.name} value={`preset:${k}`}>
                      {pr.name}
                    </option>
                  ))}
                </optgroup>
                {strategies.value.length > 0 && (
                  <optgroup label="저장한 전략">
                    {strategies.value.map((s) => (
                      <option key={s.id} value={`strategy:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {list.length > 1 && (
                <button type="button" className="btn btn-sm" onClick={() => onChange(list.filter((_, k) => k !== i).map((x, k) => ({ ...x, key: LETTERS[k] })))} aria-label={`포트폴리오 ${p.key} 빼기`}>
                  빼기
                </button>
              )}
            </div>
            <HoldingsEditor rows={p.rows} onChange={(rows) => set(i, { rows })} label={`포트폴리오 ${p.key}`} />
          </div>
        ))}
      </div>
      {list.length < max && (
        <button type="button" className="btn btn-sm self-start" onClick={() => onChange([...list, { key: LETTERS[list.length], name: `포트폴리오 ${LETTERS[list.length]}`, rows: [{ symbol: "", weight: "100" }] }])}>
          + 비교할 포트폴리오 추가
        </button>
      )}
    </div>
  );
}
