"use client";
/**
 * 분배금 세율 가정 선택 + 세후 분배금 비교·재투자 가정 패널
 * 고른 세율은 이 브라우저에 기억하고, 같은 화면의 다른 계산기와 함께 바뀐다.
 */
import { useEffect, useState } from "react";
import { compareTaxScenarios, DIV_TAX_PRESETS, reinvestScenario, type TaxPreset } from "@/lib/dividend-tax";

const KEY = "usi-div-tax";
const EVT = "usi-div-tax";
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface TaxChoice {
  id: TaxPreset["id"];
  custom: string;
}

function read(): TaxChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && DIV_TAX_PRESETS.some((p) => p.id === v.id)) return { id: v.id, custom: String(v.custom ?? "") };
  } catch {
    /* 무시 */
  }
  return { id: "none", custom: "" };
}

/** 고른 세율 가정 (기본: 세전) */
export function useDivTax() {
  const [c, setC] = useState<TaxChoice>({ id: "none", custom: "" });
  useEffect(() => {
    setC(read());
    const on = () => setC(read());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const set = (next: TaxChoice) => {
    setC(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
    window.dispatchEvent(new Event(EVT));
  };
  const preset = DIV_TAX_PRESETS.find((p) => p.id === c.id) ?? DIV_TAX_PRESETS[0];
  const customNum = Number(c.custom.replace(/,/g, ""));
  const customOk = c.custom.trim() !== "" && Number.isFinite(customNum) && customNum >= 0 && customNum <= 100;
  const rate = preset.rate ?? (customOk ? customNum : 0);
  const label = preset.id === "custom" ? (customOk ? `직접 입력 ${customNum}%` : "직접 입력 (세율을 넣으세요)") : preset.id === "none" ? "세전" : `세율 ${preset.rate}% 가정`;
  return { choice: c, set, rate, label, preset, customOk };
}

export function TaxRatePicker({ t }: { t: ReturnType<typeof useDivTax> }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">분배금 세율 가정</span>
        <div className="seg" role="group" aria-label="분배금 세율 가정">
          {DIV_TAX_PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={t.choice.id === p.id} onClick={() => t.set({ ...t.choice, id: p.id })} title={p.basis}>
              {p.label}
            </button>
          ))}
        </div>
        {t.choice.id === "custom" && (
          <span className="relative">
            <input className="input w-20 pr-6 text-right" inputMode="decimal" value={t.choice.custom} onChange={(e) => t.set({ ...t.choice, custom: e.target.value })} aria-label="직접 입력 세율" placeholder="예: 15" />
            <span className="pointer-events-none absolute right-2 top-2 text-sm text-muted">%</span>
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted">
        {t.preset.basis}
        {t.choice.id === "custom" && t.choice.custom.trim() !== "" && !t.customOk && <span className="text-critical"> — 0~100 사이 숫자를 넣으세요.</span>}
      </p>
    </div>
  );
}

/**
 * 세후 분배금: 세율 가정별 비교 + 재투자 가정
 * annualGross 는 실제 지급 기록에서 나온 세전 연 금액(최근 12개월 등), value 는 같은 기준의 평가액.
 */
export function AfterTaxPanel({ annualGross, value, basisNote, perYear = 4 }: { annualGross: number; value: number | null; basisNote: string; perYear?: number }) {
  const t = useDivTax();
  const [years, setYears] = useState("10");
  const [growth, setGrowth] = useState("0");
  const scenarios = [
    { label: "세전", rate: 0 },
    { label: "15% (한·미 조세조약)", rate: 15 },
    { label: "30% (조약 미적용)", rate: 30 },
    ...(t.choice.id === "custom" && t.customOk ? [{ label: `직접 입력 ${t.rate}%`, rate: t.rate }] : []),
  ];
  const rows = compareTaxScenarios(annualGross, scenarios);
  const yieldPct = value && value > 0 ? (annualGross / value) * 100 : null;
  const yN = Math.min(50, Math.max(1, Math.round(Number(years) || 0)));
  const g = Number(growth);
  const growthOk = Number.isFinite(g) && g > -100 && g < 100;
  const sim = yieldPct !== null && growthOk ? reinvestScenario({ startValue: value as number, yieldPct, taxPct: t.rate, priceChangePct: g, years: yN, perYear }) : [];
  const shown = sim.filter((r) => r.year === 1 || r.year === 3 || r.year === 5 || r.year % 10 === 0 || r.year === yN);

  return (
    <div className="flex flex-col gap-4">
      <TaxRatePicker t={t} />
      <div className="overflow-x-auto">
        <table className="table-basic">
          <thead>
            <tr>
              <th>세율 가정</th>
              <th className="r">연 세전</th>
              <th className="r">연 세금</th>
              <th className="r">연 세후</th>
              <th className="r">월평균 세후</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.rate === t.rate ? "font-semibold" : ""}>
                <td>
                  {r.label}
                  {r.rate === t.rate && <span className="ml-1 text-[10px] text-accent">선택</span>}
                </td>
                <td className="r">{usd(r.annual.gross)}</td>
                <td className="r">{usd(r.annual.tax)}</td>
                <td className="r">{usd(r.annual.net)}</td>
                <td className="r">{usd(r.monthly.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        {basisNote} 월평균은 연 금액 ÷ 12이며, 실제로는 지급하는 달에 몰려 들어옵니다. 세금은 고른 가정으로 계산한 참고값이며 확정 세액이 아닙니다. 분배금 성격(자본 반환 등)에 따라 원천징수가 다를 수 있고, 이자·배당 등 금융소득이 연 2,000만 원을 넘으면 한국에서 종합과세로 세금이 더 나올 수 있습니다.
      </p>

      <div className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-4">
        <p className="text-sm font-semibold">
          세후 재투자 가정 <span className="rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn">가정</span>
        </p>
        {yieldPct === null ? (
          <p className="mt-2 text-sm text-muted">평가금액이 없어 분배금 수익률을 계산할 수 없습니다.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="field">
                <span>기간 (년)</span>
                <input className="input w-20" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
              </label>
              <label className="field">
                <span>연 가격 변화율 가정 (%)</span>
                <input className="input w-24" inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value)} />
              </label>
              <p className="pb-2 text-xs text-ink-2">
                시작 평가액 {usd(value as number)} · 분배금 수익률 {yieldPct.toFixed(2)}% (위 연 세전 ÷ 평가액) · {t.label} · 연 {perYear}회 지급 가정
              </p>
            </div>
            {!growthOk ? (
              <p className="mt-2 text-xs text-critical">가격 변화율은 −100%보다 크고 100%보다 작게 넣으세요.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="table-basic">
                  <thead>
                    <tr>
                      <th>년</th>
                      <th className="r">세후 재투자</th>
                      <th className="r">세전 재투자 (세금 없다면)</th>
                      <th className="r">재투자 안 함 (평가액 + 받은 세후 현금)</th>
                      <th className="r">그해 세후 분배금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.year}>
                        <td>{r.year}년</td>
                        <td className="r font-semibold">{usd(r.valueNetReinvest)}</td>
                        <td className="r">{usd(r.valueGrossReinvest)}</td>
                        <td className="r">{usd(r.valueNoReinvest + r.cashNoReinvest)}</td>
                        <td className="r">{usd(r.incomeNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">분배금 수익률과 가격 변화율이 매년 같다고 가정한 계산입니다. 실제 분배금·가격은 바뀌며, 분배금을 주는 만큼 가격이 내려갈 수 있습니다. 매수 수수료·환전 비용·한국 세금은 넣지 않았습니다. 앞으로의 결과를 뜻하지 않습니다.</p>
          </>
        )}
      </div>
    </div>
  );
}
