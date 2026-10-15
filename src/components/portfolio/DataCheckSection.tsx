"use client";
/** 내 자산 → 데이터 점검: 거래 기록·시세·환율·분배금 기록의 오류와 최신성 (사용자 입력은 확인 후에만 바꿈) */
import { useMemo, useState } from "react";
import { etToday, QUOTE_OLD_MS, useFx, useSeriesMap } from "@/lib/client/user-data";
import { heldSymbols, type PortfolioSummary } from "@/lib/client/portfolio-summary";
import { CHECK_STATUS_KO, checkPortfolioData, type CheckItem, type CheckStatus } from "@/lib/portfolio/data-check";
import { TXN_KO, type PortfolioData } from "@/lib/portfolio/types";
import { Notice, Section } from "@/components/ui";

const ORDER: CheckStatus[] = ["error", "check", "missing", "stale", "ok"];
const TONE: Record<CheckStatus, string> = {
  error: "border-critical/50 bg-critical-soft",
  check: "border-warn/50 bg-warn-soft",
  missing: "border-line-strong bg-surface-2",
  stale: "border-line-strong bg-surface-2",
  ok: "border-line bg-surface",
};

/** 화면에서 쓰는 점검 결과 (확인함에서도 같은 함수를 쓴다) */
export function useDataCheck(p: PortfolioData, s: PortfolioSummary): { items: CheckItem[] | null } {
  const held = heldSymbols(p);
  const ser = useSeriesMap(held);
  const fx = useFx();
  const items = useMemo(() => {
    if (ser.loading || s.loading || fx.loading) return null;
    const income: Record<string, { perYear: number | null; latestEx: string | null }> = {};
    for (const sym of held) {
      const inf = s.income?.[sym];
      if (inf) income[sym] = { perYear: inf.perYear, latestEx: inf.latest?.ex ?? null };
    }
    return checkPortfolioData({
      p,
      today: etToday(),
      now: Date.now(),
      quotes: held.map((sym) => {
        const q = s.quotes[sym];
        return { symbol: sym, time: q ? (q.marketTime ?? q.fetchedAt) : null, source: q?.source ?? null };
      }),
      quotesError: s.quotesError,
      fx: { time: fx.rate !== null ? fx.time : null },
      series: ser.series,
      income,
      staleQuoteMs: QUOTE_OLD_MS,
    });
    // held 는 p 에서 나온 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, s, ser, fx.loading, fx.rate, fx.time]);
  return { items };
}

export default function DataCheckSection({ p, s, save }: { p: PortfolioData; s: PortfolioSummary; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void> }) {
  const { items } = useDataCheck(p, s);
  const [msg, setMsg] = useState<string | null>(null);
  if (!items) return <div className="skeleton h-48" aria-label="데이터 점검 중" />;
  const counts = ORDER.map((st) => ({ st, n: items.filter((i) => i.status === st).length }));
  const removeDup = (it: CheckItem) => {
    const ids = it.removable ?? [];
    const rows = p.ledger.filter((t) => ids.includes(t.id));
    const desc = rows.map((t) => `${t.date} ${TXN_KO[t.type]} ${t.symbol ?? ""} ${t.shares ?? ""}${t.amount ? ` $${t.amount}` : ""}`).join("\n");
    if (!window.confirm(`다음 ${rows.length}건을 지웁니다 (같은 내용의 기록 1건은 남김).\n\n${desc}\n\n거래 ${p.ledger.length}건 → ${p.ledger.length - rows.length}건. 계속할까요?`)) return;
    void save((cur) => ({ ...cur, ledger: cur.ledger.filter((t) => !ids.includes(t.id)) })).then(() => setMsg(`${rows.length}건을 지웠습니다. 설정 → 데이터 관리에서 백업해 두었다면 되돌릴 수 있습니다.`));
  };
  return (
    <div className="flex flex-col gap-5">
      <Section title="데이터 점검" description="잘못된 기록이나 오래된 데이터로 잘못 판단하지 않도록 확인할 점을 모았습니다. 기록은 직접 확인한 뒤에만 바뀝니다.">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {counts.map(({ st, n }) => (
            <div key={st} className={`rounded-lg border px-3 py-2 ${n && st !== "ok" ? TONE[st] : "border-line"}`}>
              <p className="text-xs text-muted">{CHECK_STATUS_KO[st]}</p>
              <p className="num text-lg font-bold">{n}</p>
            </div>
          ))}
        </div>
        {msg && (
          <p role="status" className="mb-3 text-xs text-good">
            {msg}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {ORDER.flatMap((st) => items.filter((i) => i.status === st)).map((it) => (
            <li key={it.key} className={`rounded-lg border p-3 ${TONE[it.status]}`}>
              <p className="text-sm font-semibold">
                <span className="mr-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px] font-semibold">{CHECK_STATUS_KO[it.status]}</span>
                {it.title}
              </p>
              <p className="mt-1 text-xs text-ink-2">{it.cause}</p>
              {it.affects.length > 0 && <p className="mt-1 text-[11px] text-muted">영향받는 계산: {it.affects.join(", ")}</p>}
              {it.fix && <p className="mt-1 text-[11px] text-ink-2">해결 방법: {it.fix}</p>}
              {it.removable && it.removable.length > 0 && (
                <button type="button" className="btn btn-sm mt-2" onClick={() => removeDup(it)}>
                  중복 {it.removable.length}건 지우기 (확인 후)
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Notice title="점검 범위">
        거래 기록의 계산 오류·중복·금액·가격(그날 실제 종가 대비, 주식분할 영향)·기록하지 않은 분배금, 시세·환율·분배금 기록의 최신성, 일별 가격 기록 유무를 봅니다. 증권사 실제 잔고와의 차이는 이 사이트가 알 수 없으니 잔고와 직접 비교해 보세요.
      </Notice>
    </div>
  );
}
