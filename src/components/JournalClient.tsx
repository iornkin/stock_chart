"use client";
/** 투자 판단 기록장 — 최초 판단과 사후 평가를 분리해 보관 (이 브라우저에만 저장) */
import Link from "next/link";
import { useMemo, useState } from "react";
import { etToday, useJournal, useSeriesMap } from "@/lib/client/user-data";
import { journalOutcome } from "@/lib/journal/outcome";
import { JOURNAL_ACTION_KO, type JournalAction, type JournalEntry, type JournalReview } from "@/lib/journal/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { newId } from "@/lib/portfolio/types";
import { Notice, Section } from "@/components/ui";
import { Field, LocalOnlyNote, parseNum, pct, Seg, SymbolField, tone, usd } from "@/components/sim/common";

const EMPTY = { symbol: "", action: "buy" as JournalAction, date: "", price: "", reason: "", horizon: "", expectation: "", maxLoss: "", invalidation: "", reviewDate: "", refs: "", memo: "" };

export default function JournalClient() {
  const j = useJournal();
  const today = etToday();
  const [f, setF] = useState({ ...EMPTY, date: today });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "due">("all");
  const symbols = useMemo(() => [...new Set(j.value.map((e) => e.symbol))], [j.value]);
  const ser = useSeriesMap(symbols);

  const add = () => {
    const sym = normalizeSymbol(f.symbol.trim());
    if (!getInstrument(sym)) return setMsg({ ok: false, text: "지원 종목을 고르세요." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || f.date > today) return setMsg({ ok: false, text: "날짜를 오늘 이전으로 넣으세요." });
    if (!f.reason.trim()) return setMsg({ ok: false, text: "투자 이유를 적으세요." });
    const price = f.price.trim() ? parseNum(f.price) : null;
    if (price !== null && !(price > 0)) return setMsg({ ok: false, text: "가격을 확인하세요." });
    const ml = f.maxLoss.trim() ? parseNum(f.maxLoss) : null;
    if (ml !== null && !(ml > 0 && ml <= 100)) return setMsg({ ok: false, text: "감수할 손실은 0~100% 사이로 넣으세요." });
    const e: JournalEntry = {
      id: newId(),
      symbol: sym,
      action: f.action,
      date: f.date,
      price,
      priceSource: price !== null ? "user" : "close",
      reason: f.reason.trim(),
      horizon: f.horizon.trim(),
      expectation: f.expectation.trim(),
      maxLossPct: ml,
      invalidation: f.invalidation.trim(),
      reviewDate: f.reviewDate || null,
      refs: f.refs.trim(),
      memo: f.memo.trim(),
      createdAt: Date.now(),
      reviews: [],
    };
    void j.set((cur) => [e, ...cur]).then(() => {
      setF({ ...EMPTY, date: today });
      setMsg({ ok: true, text: "기록했습니다. 처음 적은 내용은 고칠 수 없고, 아래에서 사후 평가를 덧붙일 수 있습니다." });
    });
  };

  const list = j.value.filter((e) => filter === "all" || (e.reviewDate && e.reviewDate <= today));
  const due = j.value.filter((e) => e.reviewDate && e.reviewDate <= today && !e.reviews.some((r) => r.date >= (e.reviewDate as string))).length;

  if (!j.loaded) return <div className="skeleton h-64" aria-label="투자 기록을 불러오는 중" />;
  return (
    <div className="flex flex-col gap-5">
      {j.error && <Notice tone="critical" title="저장 오류">{j.error}</Notice>}
      {due > 0 && (
        <Notice tone="warn" title={`다시 볼 날이 지난 기록 ${due}건`}>
          당시 판단과 지금 결과를 비교하고 사후 평가를 남겨 보세요.
        </Notice>
      )}
      <Section title="새 기록" description="필수: 종목·날짜·투자 이유. 가격을 비우면 그날(휴장이면 직전 거래일) 종가를 씁니다.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <SymbolField value={f.symbol} onChange={(v) => setF({ ...f, symbol: v })} label="기록 종목" />
          </div>
          <Field label="종류">
            <Seg label="기록 종류" value={f.action} onChange={(v) => setF({ ...f, action: v })} options={(Object.keys(JOURNAL_ACTION_KO) as JournalAction[]).map((k) => ({ v: k, l: JOURNAL_ACTION_KO[k] }))} />
          </Field>
          <Field label="날짜">
            <input type="date" className="input" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="기록 날짜" />
          </Field>
          <Field label="당시 가격 (선택, USD)">
            <input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="비우면 종가" aria-label="당시 가격" />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="투자 이유">
            <textarea className="input min-h-20" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="투자 이유" />
          </Field>
          <Field label="기대했던 결과">
            <textarea className="input min-h-20" value={f.expectation} onChange={(e) => setF({ ...f, expectation: e.target.value })} aria-label="기대 결과" />
          </Field>
          <Field label="판단이 틀렸다고 볼 조건">
            <textarea className="input min-h-16" value={f.invalidation} onChange={(e) => setF({ ...f, invalidation: e.target.value })} placeholder="예: 분배금이 20% 넘게 줄면" aria-label="틀렸다고 볼 조건" />
          </Field>
          <Field label="참고 자료 (링크·뉴스·공시)">
            <textarea className="input min-h-16" value={f.refs} onChange={(e) => setF({ ...f, refs: e.target.value })} aria-label="참고 자료" />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="예상 투자 기간">
            <input className="input" value={f.horizon} onChange={(e) => setF({ ...f, horizon: e.target.value })} placeholder="예: 3년" aria-label="예상 투자 기간" />
          </Field>
          <Field label="감수할 손실 (%)">
            <input className="input" inputMode="decimal" value={f.maxLoss} onChange={(e) => setF({ ...f, maxLoss: e.target.value })} placeholder="예: 20" aria-label="감수할 손실" />
          </Field>
          <Field label="다시 볼 날짜">
            <input type="date" className="input" value={f.reviewDate} onChange={(e) => setF({ ...f, reviewDate: e.target.value })} aria-label="다시 볼 날짜" />
          </Field>
          <Field label="메모">
            <input className="input" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} aria-label="메모" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={add}>
            기록 저장
          </button>
          {msg && (
            <span role="status" className={`text-xs ${msg.ok ? "text-good" : "text-critical"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </Section>

      <Section title={`기록 ${j.value.length}건`} right={<Seg label="기록 거르기" value={filter} onChange={setFilter} options={[{ v: "all", l: "전체" }, { v: "due", l: "다시 볼 날 지남" }]} />}>
        {list.length ? (
          <ul className="flex flex-col gap-3">
            {list.map((e) => (
              <EntryCard key={e.id} e={e} ser={ser.series[e.symbol]} loading={ser.loading} today={today} onReview={(r) => void j.set((cur) => cur.map((x) => (x.id === e.id ? { ...x, reviews: [...x.reviews, r] } : x)))} onDelete={() => window.confirm(`${e.date} ${e.symbol} 기록과 사후 평가 ${e.reviews.length}건을 지울까요?`) && void j.set((cur) => cur.filter((x) => x.id !== e.id))} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">기록이 없습니다.</p>
        )}
      </Section>
      <LocalOnlyNote what="투자 판단 기록과 사후 평가" />
    </div>
  );
}

function EntryCard({ e, ser, loading, today, onReview, onDelete }: { e: JournalEntry; ser: Parameters<typeof journalOutcome>[1]; loading: boolean; today: string; onReview: (r: JournalReview) => void; onDelete: () => void }) {
  const o = journalOutcome(e, ser, today);
  const [open, setOpen] = useState(false);
  const [r, setR] = useState({ stillValid: "", happened: "", differed: "", missedRisks: "", memo: "" });
  const afterSell = e.action === "sell" || e.action === "watch";
  const save = () => {
    if (!Object.values(r).some((v) => v.trim())) return;
    onReview({ id: newId(), date: today, ...r, snapshot: { price: o.lastPrice, totalReturnPct: o.totalReturnPct }, createdAt: Date.now() });
    setR({ stillValid: "", happened: "", differed: "", missedRisks: "", memo: "" });
    setOpen(false);
  };
  return (
    <li className={`rounded-xl border p-4 ${o.reviewDue && !e.reviews.some((x) => x.date >= (e.reviewDate as string)) ? "border-warn/60" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            <Link href={`/stock/${e.symbol}`} className="hover:text-accent">
              {e.symbol}
            </Link>{" "}
            <span className="text-sm font-normal text-ink-2">
              {JOURNAL_ACTION_KO[e.action]} · {e.date}
              {e.reviewDate && ` · 다시 볼 날 ${e.reviewDate}`}
              {o.reviewDue && <span className="ml-1 text-warn">(지남)</span>}
            </span>
          </p>
          <p className="text-[11px] text-muted">처음 기록: {new Date(e.createdAt).toLocaleString("ko-KR")} — 이 내용은 고치지 않습니다</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={onDelete} aria-label={`${e.symbol} ${e.date} 기록 삭제`}>
          삭제
        </button>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {(
          [
            ["투자 이유", e.reason],
            ["기대했던 결과", e.expectation],
            ["틀렸다고 볼 조건", e.invalidation],
            ["예상 기간", e.horizon],
            ["감수할 손실", e.maxLossPct !== null ? `${e.maxLossPct}%` : ""],
            ["참고 자료", e.refs],
            ["메모", e.memo],
          ] as [string, string][]
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="whitespace-pre-wrap break-words">{v}</dd>
            </div>
          ))}
      </dl>
      <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
        <p className="text-xs font-semibold text-ink-2">{afterSell ? "기록 이후 가격 움직임 (내 수익이 아님)" : "기록 이후 실제 결과"}</p>
        {loading && !ser ? (
          <p className="text-xs text-muted">가격 불러오는 중…</p>
        ) : o.error ? (
          <p className="text-xs text-warn">{o.error}</p>
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div>
              <p className="text-muted">당시 가격</p>
              <p className="num font-semibold">
                {usd(o.basePrice)} <span className="font-normal text-muted">{e.priceSource === "user" ? "(입력)" : `(${o.baseDate} 종가)`}</span>
              </p>
            </div>
            <div>
              <p className="text-muted">지금 ({o.lastDate} 종가)</p>
              <p className="num font-semibold">{usd(o.lastPrice)}</p>
            </div>
            <div>
              <p className="text-muted">가격 변화</p>
              <p className={`num font-semibold ${tone(o.priceReturnPct)}`}>{pct(o.priceReturnPct, 1)}</p>
            </div>
            <div>
              <p className="text-muted">분배금 포함 ({o.days}일)</p>
              <p className={`num font-semibold ${tone(o.totalReturnPct)}`}>{pct(o.totalReturnPct, 1)}</p>
              <p className="text-[10px] text-muted">주당 분배금 {usd(o.dividendsPerShare, 4)}</p>
            </div>
            <div>
              <p className="text-muted">기록 후 최대 하락</p>
              <p className="num font-semibold text-down">{pct(o.maxDrawdownPct, 1)}</p>
              {o.breachedMaxLoss !== null && <p className={`text-[10px] ${o.breachedMaxLoss ? "text-critical" : "text-muted"}`}>{o.breachedMaxLoss ? "감수할 손실 기준을 넘은 적 있음" : "감수할 손실 기준 안"}</p>}
            </div>
          </div>
        )}
      </div>
      {e.reviews.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink-2">사후 평가 {e.reviews.length}건</p>
          <ul className="mt-1 flex flex-col gap-2">
            {e.reviews.map((rv) => (
              <li key={rv.id} className="rounded-lg border border-line p-2 text-xs">
                <p className="text-muted">
                  {rv.date} 평가{rv.snapshot?.totalReturnPct !== null && rv.snapshot?.totalReturnPct !== undefined ? ` · 그때 분배금 포함 ${pct(rv.snapshot.totalReturnPct, 1)}` : ""}
                </p>
                {(
                  [
                    ["지금도 유효한 근거", rv.stillValid],
                    ["실제로 일어난 변화", rv.happened],
                    ["예상과 달랐던 점", rv.differed],
                    ["놓쳤던 위험", rv.missedRisks],
                    ["메모", rv.memo],
                  ] as [string, string][]
                )
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <p key={k} className="mt-0.5 whitespace-pre-wrap">
                      <b>{k}</b>: {v}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["stillValid", "당시 근거 중 지금도 유효한 것"],
              ["happened", "실제로 일어난 변화"],
              ["differed", "예상과 달랐던 점"],
              ["missedRisks", "당시 놓쳤을 수 있는 위험"],
              ["memo", "메모"],
            ] as [keyof typeof r, string][]
          ).map(([k, l]) => (
            <Field key={k} label={l}>
              <textarea className="input min-h-14" value={r[k]} onChange={(ev) => setR({ ...r, [k]: ev.target.value })} aria-label={l} />
            </Field>
          ))}
          <div className="flex items-end gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={save}>
              사후 평가 저장
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sm mt-3" onClick={() => setOpen(true)}>
          사후 평가 쓰기
        </button>
      )}
    </li>
  );
}
