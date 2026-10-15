"use client";
/**
 * CSV 가져오기 (브라우저 안에서만 읽고 서버로 보내지 않음)
 * 파일 → 열 맞추기 → 행별 검증·중복 표시 → 반영 전후 미리 보기 → 확인한 뒤에만 반영 → 방금 가져온 묶음 되돌리기
 */
import { useMemo, useState } from "react";
import { etToday } from "@/lib/client/user-data";
import { buildHoldings, buildTxns, guessMapping, HOLDING_FIELD_KO, parseCsv, TXN_FIELD_KO, type HoldingField, type TxnField } from "@/lib/portfolio/csv-import";
import { computeLedger } from "@/lib/portfolio/ledger";
import { TXN_KO, type PortfolioData, type Txn } from "@/lib/portfolio/types";

const TF = Object.keys(TXN_FIELD_KO) as TxnField[];
const HF = Object.keys(HOLDING_FIELD_KO) as HoldingField[];
const fmt = (v: number) => (Math.round(v * 10000) / 10000).toLocaleString("en-US");

export default function CsvImport({ p, save }: { p: PortfolioData; save: (fn: (cur: PortfolioData) => PortfolioData) => Promise<void> }) {
  const ledger = p.mode === "ledger";
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [batch] = useState(() => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ""));
  const fields: string[] = ledger ? TF : HF;
  const labels: Record<string, string> = ledger ? TXN_FIELD_KO : HOLDING_FIELD_KO;

  const onFile = async (f: File) => {
    setMsg(null);
    if (f.size > 5_000_000) return setMsg({ ok: false, text: "파일이 너무 큽니다 (5MB 이하)." });
    try {
      const rows = parseCsv(await f.text());
      if (rows.length < 1) return setMsg({ ok: false, text: "읽을 행이 없습니다." });
      setFile({ name: f.name, rows });
      setMap(guessMapping(rows[0], fields as TxnField[]));
      setExcluded({});
      setIncluded({});
    } catch {
      setMsg({ ok: false, text: "CSV 파일을 읽지 못했습니다." });
    }
  };

  const headers = file ? (hasHeader ? file.rows[0] : file.rows[0].map((_, i) => `${i + 1}번째 열`)) : [];
  const body = file ? (hasHeader ? file.rows.slice(1) : file.rows) : [];
  const today = etToday();

  const txRows = useMemo(() => (file && ledger ? buildTxns(body, map as Record<TxnField, number | null>, p.ledger, { today, batch, now: Date.now() }) : []), [file, body, map, p.ledger, today, batch, ledger]);
  const hRows = useMemo(() => (file && !ledger ? buildHoldings(body, map as Record<HoldingField, number | null>, p.simple.holdings, { today, batch }) : []), [file, body, map, p.simple.holdings, today, batch, ledger]);
  const chosen = (i: number, def: boolean) => (excluded[i] ? false : included[i] ? true : def);

  const preview = useMemo(() => {
    if (!ledger) return null;
    const add = txRows.filter((r, i) => r.txn && chosen(i, r.include)).map((r) => r.txn as Txn);
    const before = computeLedger(p.ledger, {});
    const after = computeLedger([...p.ledger, ...add], {});
    const syms = [...new Set([...before.positions, ...after.positions].map((x) => x.symbol))];
    return {
      add,
      cash: { before: before.cash, after: after.cash },
      contrib: { before: before.netContributions, after: after.netContributions },
      positions: syms.map((sym) => ({ symbol: sym, before: before.positions.find((x) => x.symbol === sym)?.shares ?? 0, after: after.positions.find((x) => x.symbol === sym)?.shares ?? 0 })).filter((x) => Math.abs(x.after - x.before) > 1e-9),
      newIssues: after.issues.filter((i) => !before.issues.some((b) => b.txnId === i.txnId && b.message === i.message)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRows, excluded, included, p.ledger, ledger]);

  const apply = async () => {
    try {
      if (ledger && preview) {
        if (!preview.add.length) return;
        if (!window.confirm(`거래 ${preview.add.length}건을 추가합니다.\n현금 $${fmt(preview.cash.before)} → $${fmt(preview.cash.after)}\n${preview.positions.map((x) => `${x.symbol} ${fmt(x.before)}주 → ${fmt(x.after)}주`).join("\n")}\n\n계속할까요? (나중에 '이번에 가져온 거래 되돌리기'로 한 번에 지울 수 있음)`)) return;
        await save((cur) => ({ ...cur, ledger: [...cur.ledger, ...preview.add] }));
        setMsg({ ok: true, text: `거래 ${preview.add.length}건을 추가했습니다 (묶음 ${batch}).` });
      } else {
        const add = hRows.filter((r, i) => r.holding && chosen(i, r.include)).map((r) => r.holding!);
        if (!add.length) return;
        const rep = add.filter((h) => p.simple.holdings.some((x) => x.symbol === h.symbol)).map((h) => h.symbol);
        if (!window.confirm(`보유 종목 ${add.length}개를 반영합니다.${rep.length ? `\n이미 있는 ${rep.join(", ")}는 파일 값으로 바뀝니다.` : ""}\n계속할까요?`)) return;
        await save((cur) => ({ ...cur, simple: { ...cur.simple, holdings: [...cur.simple.holdings.filter((h) => !add.some((a) => a.symbol === h.symbol)), ...add] } }));
        setMsg({ ok: true, text: `보유 종목 ${add.length}개를 반영했습니다.` });
      }
      setFile(null);
    } catch (e) {
      setMsg({ ok: false, text: `반영하지 못했습니다 (기존 데이터는 그대로입니다): ${String((e as Error).message ?? e)}` });
    }
  };

  const batches = ledger ? [...new Set(p.ledger.map((t) => t.importBatch).filter((b): b is string => !!b))].sort().reverse() : [];
  const undo = (b: string) => {
    const n = p.ledger.filter((t) => t.importBatch === b).length;
    if (!window.confirm(`CSV 가져오기 묶음 ${b}의 거래 ${n}건을 지웁니다. 계속할까요?`)) return;
    void save((cur) => ({ ...cur, ledger: cur.ledger.filter((t) => t.importBatch !== b) })).then(() => setMsg({ ok: true, text: `묶음 ${b}의 거래 ${n}건을 지웠습니다.` }));
  };

  const okCount = ledger ? txRows.filter((r, i) => r.txn && chosen(i, r.include)).length : hRows.filter((r, i) => r.holding && chosen(i, r.include)).length;
  const badCount = ledger ? txRows.filter((r) => r.problems.length).length : hRows.filter((r) => r.problems.length).length;
  const dupCount = ledger ? txRows.filter((r) => r.duplicate).length : 0;

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-semibold">CSV 파일로 {ledger ? "거래 내역" : "보유 종목"} 가져오기</summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <p className="text-xs leading-relaxed text-muted">
          증권사에서 내려받은 CSV 를 이 브라우저 안에서만 읽습니다 (서버로 보내지 않음). 열 이름이 달라도 아래에서 직접 맞출 수 있고, 확인을 누르기 전에는 아무것도 바뀌지 않습니다. 금액은 달러 기준이어야 합니다.
          {ledger ? " 거래 종류는 매수·매도·입금·출금·배당(분배금)·재투자·기초 보유를 읽습니다." : " 열: 티커·수량·평균 단가(필수), 최초 매수일·메모(선택)."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-sm cursor-pointer">
            CSV 파일 고르기
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="가져올 CSV 파일" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          </label>
          {file && (
            <>
              <span className="text-xs text-ink-2">
                {file.name} · {body.length}행
              </span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> 첫 줄은 열 이름
              </label>
            </>
          )}
        </div>
        {msg && (
          <p role="status" className={`text-xs ${msg.ok ? "text-good" : "text-critical"}`}>
            {msg.text}
          </p>
        )}
        {file && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {fields.map((f) => (
                <label key={f} className="field">
                  <span>{labels[f]}</span>
                  <select className="input py-1 text-sm" value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? null : Number(e.target.value) })} aria-label={`${labels[f]} 열`}>
                    <option value="">(없음)</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `${i + 1}번째 열`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs">
              가져올 행 <b>{okCount}</b> · 문제 있는 행 <span className={badCount ? "font-semibold text-critical" : ""}>{badCount}</span>
              {ledger && (
                <>
                  {" "}
                  · 중복 의심 <span className={dupCount ? "font-semibold text-warn" : ""}>{dupCount}</span> (기본 제외, 직접 넣을 수 있음)
                </>
              )}
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border border-line">
              <table className="table-basic text-xs">
                <thead>
                  <tr>
                    <th>가져오기</th>
                    <th>행</th>
                    <th>{ledger ? "거래" : "보유 종목"}</th>
                    <th>문제·중복</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger
                    ? txRows.map((r, i) => (
                        <tr key={i} className={r.problems.length ? "text-critical" : r.duplicate ? "text-warn" : ""}>
                          <td>
                            <input type="checkbox" disabled={!r.txn} checked={!!r.txn && chosen(i, r.include)} onChange={(e) => (e.target.checked ? (setIncluded({ ...included, [i]: true }), setExcluded({ ...excluded, [i]: false })) : (setExcluded({ ...excluded, [i]: true }), setIncluded({ ...included, [i]: false })))} aria-label={`${r.line}행 가져오기`} />
                          </td>
                          <td>{r.line}</td>
                          <td className="whitespace-nowrap">{r.txn ? `${r.txn.date} ${TXN_KO[r.txn.type]} ${r.txn.symbol ?? ""} ${r.txn.shares ? `${r.txn.shares}주` : ""}${r.txn.price ? ` @$${r.txn.price}` : ""}${r.txn.amount ? ` $${r.txn.amount}` : ""}${r.txn.fee ? ` 수수료 $${r.txn.fee}` : ""}${r.txn.tax ? ` 세금 $${r.txn.tax}` : ""}` : r.raw.join(" | ")}</td>
                          <td>{r.problems.length ? r.problems.join(", ") : r.duplicate === "existing" ? "이미 있는 거래와 같음" : r.duplicate === "file" ? "파일 앞 행과 같음" : "-"}</td>
                        </tr>
                      ))
                    : hRows.map((r, i) => (
                        <tr key={i} className={r.problems.length ? "text-critical" : ""}>
                          <td>
                            <input type="checkbox" disabled={!r.holding} checked={!!r.holding && chosen(i, r.include)} onChange={(e) => (e.target.checked ? setExcluded({ ...excluded, [i]: false }) : setExcluded({ ...excluded, [i]: true }))} aria-label={`${r.line}행 가져오기`} />
                          </td>
                          <td>{r.line}</td>
                          <td>{r.holding ? `${r.holding.symbol} ${r.holding.shares}주 @$${r.holding.avgCost}${r.holding.firstDate ? ` (${r.holding.firstDate})` : ""}` : "-"}</td>
                          <td>{r.problems.length ? r.problems.join(", ") : r.replaces ? "이미 있는 종목 — 파일 값으로 바뀜" : "-"}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {ledger && preview && preview.add.length > 0 && (
              <div className="rounded-lg bg-surface-2 p-3 text-xs">
                <p className="font-semibold">반영하면 바뀌는 것 (미리 보기)</p>
                <p className="mt-1">
                  현금 ${fmt(preview.cash.before)} → <b>${fmt(preview.cash.after)}</b> · 순납입 원금 ${fmt(preview.contrib.before)} → <b>${fmt(preview.contrib.after)}</b>
                </p>
                {preview.positions.length > 0 && <p className="mt-1">보유 수량: {preview.positions.map((x) => `${x.symbol} ${fmt(x.before)} → ${fmt(x.after)}주`).join(" · ")}</p>}
                {preview.newIssues.length > 0 && <p className="mt-1 text-warn">반영 뒤 확인할 점: {preview.newIssues.map((i) => i.message).join(" / ")}</p>}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={!okCount}>
                확인하고 {okCount}건 반영
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setFile(null)}>
                취소
              </button>
            </div>
          </>
        )}
        {batches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-xs">
            <span className="text-muted">CSV 로 가져온 묶음:</span>
            {batches.slice(0, 5).map((b) => (
              <button key={b} type="button" className="btn btn-sm" onClick={() => undo(b)}>
                {b} 되돌리기 ({p.ledger.filter((t) => t.importBatch === b).length}건)
              </button>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
