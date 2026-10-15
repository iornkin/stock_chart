"use client";
/** 비교할 포트폴리오 여러 개를 입력하는 카드 (예시·저장한 전략 불러오기) */
import { useStrategies } from "@/lib/client/user-data";
import { HoldingsEditor, PRESETS, rowsFrom, type WeightRow } from "./common";

export interface PortfolioInput {
  key: string;
  name: string;
  rows: WeightRow[];
  /** true(기본): 이름을 종목·비중으로 자동으로 짓는다. 사용자가 이름을 직접 고치면 false */
  auto?: boolean;
}

export const LETTERS = ["A", "B", "C", "D"];

/** 종목·비중으로 만든 이름 (예: "QQQ 50% + SCHD 50%") */
export function compositionName(rows: WeightRow[], fallback: string): string {
  const items = rows.filter((r) => r.symbol.trim()).map((r) => `${r.symbol.trim().toUpperCase()} ${r.weight.trim() || "?"}%`);
  if (!items.length) return fallback;
  return items.length > 3 ? `${items.slice(0, 3).join(" + ")} 외 ${items.length - 3}개` : items.join(" + ");
}

export function defaultPortfolios(n = 2): PortfolioInput[] {
  return PRESETS.slice(0, n).map((p, i) => ({ key: LETTERS[i], name: p.name, rows: rowsFrom(p.items), auto: true }));
}

export default function PortfolioInputs({ list, onChange, max = 4 }: { list: PortfolioInput[]; onChange: (l: PortfolioInput[]) => void; max?: number }) {
  const strategies = useStrategies();
  const set = (i: number, patch: Partial<PortfolioInput>) =>
    onChange(
      list.map((p, k) => {
        if (k !== i) return p;
        const next = { ...p, ...patch };
        // 이름을 직접 고치지 않았다면 종목·비중이 바뀔 때 이름도 따라 바뀐다
        if (patch.rows && next.auto !== false && patch.name === undefined) next.name = compositionName(next.rows, `포트폴리오 ${p.key}`);
        return next;
      }),
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p, i) => (
          <div key={p.key} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: `var(${["--s1", "--s2", "--s3", "--s7"][i]})` }}>
                {p.key}
              </span>
              <input
                className="input min-w-0 flex-1 py-1 text-sm"
                value={p.name}
                onChange={(e) => set(i, { name: e.target.value, auto: false })}
                onBlur={() => !p.name.trim() && set(i, { name: compositionName(p.rows, `포트폴리오 ${p.key}`), auto: true })}
                aria-label={`포트폴리오 ${p.key} 이름`}
                title="이름을 직접 입력할 수 있습니다. 비워 두면 종목·비중으로 자동으로 짓습니다."
                placeholder="포트폴리오 이름"
                maxLength={60}
              />
              {p.auto === false && (
                <button type="button" className="btn btn-sm shrink-0" onClick={() => set(i, { name: compositionName(p.rows, `포트폴리오 ${p.key}`), auto: true })} title="종목·비중으로 이름 다시 짓기" aria-label={`포트폴리오 ${p.key} 이름 자동`}>
                  자동 이름
                </button>
              )}
              <select
                className="input w-28 shrink-0 py-1 text-sm"
                aria-label={`포트폴리오 ${p.key} 불러오기`}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("preset:")) {
                    const pr = PRESETS[Number(v.slice(7))];
                    set(i, { name: pr.name, rows: rowsFrom(pr.items), auto: true });
                  } else if (v.startsWith("strategy:")) {
                    const s = strategies.value.find((x) => x.id === v.slice(9));
                    if (s) set(i, { name: s.name, rows: rowsFrom(s.items), auto: false });
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
        <button type="button" className="btn btn-sm self-start" onClick={() => onChange([...list, { key: LETTERS[list.length], name: `포트폴리오 ${LETTERS[list.length]}`, rows: [{ symbol: "", weight: "100" }], auto: true }])}>
          + 비교할 포트폴리오 추가
        </button>
      )}
    </div>
  );
}
