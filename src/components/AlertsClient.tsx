"use client";
/** 알림 규칙 관리·기록 (이 브라우저에만 저장) */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAlerts, usePortfolio } from "@/lib/client/user-data";
import { heldSymbols } from "@/lib/client/portfolio-summary";
import { ALERT_KIND_KO, SYMBOL_KINDS, type AlertKind, type AlertRule } from "@/lib/alerts/types";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { newId } from "@/lib/portfolio/types";
import { formatEt, relativeTime } from "@/lib/time";
import { Notice, Section } from "@/components/ui";
import { Field, LocalOnlyNote, parseNum, Seg, SymbolField } from "@/components/sim/common";
import { ALERT_CHECK_EVENT } from "./AlertRunner";

const KINDS = Object.keys(ALERT_KIND_KO) as AlertKind[];
const HINT: Record<AlertKind, string> = {
  dividend_change: "최근 정기 지급의 주당 금액이 처음 확인한 값과 달라지면 알립니다 (처음 확인할 때는 기준만 저장).",
  new_schedule: "처음 확인한 뒤 새로운 배당락일이 발표되면 알립니다.",
  ex_soon: "발표된 배당락일이 정한 날 수 안으로 다가오면 한 번 알립니다.",
  expense_change: "제공처가 알려 준 총보수가 바뀌면 알립니다 (ETF).",
  holdings_change: "상위 10개 편입 종목에 새로 들어오거나 빠진 종목이 있으면 알립니다 (비중 변화만으로는 알리지 않음).",
  target_drift: "내 자산 → 목표 비중에 저장한 목표에서 이탈 기준보다 크게 벗어난 종목이 새로 생기면 알립니다.",
  price: "수집된 시세가 정한 가격 이상(이하)이 되면 알립니다. 실시간 시세가 아닙니다.",
  pnl: "내 자산의 총수익률(달러 기준)이 정한 값 이상(이하)이 되면 알립니다.",
};

type Perm = "unsupported" | "default" | "granted" | "denied";

export default function AlertsClient() {
  const a = useAlerts();
  const pf = usePortfolio();
  const d = a.value;
  const [kind, setKind] = useState<AlertKind>("dividend_change");
  const [symbol, setSymbol] = useState("");
  const [days, setDays] = useState("3");
  const [op, setOp] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [perm, setPerm] = useState<Perm>("default");
  useEffect(() => {
    setPerm(typeof window !== "undefined" && "Notification" in window ? (Notification.permission as Perm) : "unsupported");
  }, []);

  const save = (fn: (cur: typeof d) => typeof d) => a.set(fn).catch(() => {});
  const check = () => window.dispatchEvent(new Event(ALERT_CHECK_EVENT));

  const add = () => {
    const sym = normalizeSymbol(symbol.trim());
    const needSym = SYMBOL_KINDS.includes(kind);
    if (needSym && !getInstrument(sym)) return setMsg({ ok: false, text: "지원 종목을 고르세요." });
    const r: AlertRule = { id: newId(), kind, enabled: true, createdAt: Date.now(), ...(needSym ? { symbol: sym } : {}) };
    if (kind === "ex_soon") {
      const n = parseNum(days);
      if (!(n >= 0 && n <= 60)) return setMsg({ ok: false, text: "날 수는 0~60 사이로 넣으세요." });
      r.days = Math.round(n);
    }
    if (kind === "price" || kind === "pnl") {
      const v = parseNum(value);
      if (!Number.isFinite(v) || (kind === "price" && !(v > 0))) return setMsg({ ok: false, text: kind === "price" ? "가격을 0보다 크게 넣으세요." : "손익률(%)을 숫자로 넣으세요." });
      r.op = op;
      r.value = v;
    }
    if (kind === "target_drift" && !pf.value.targets?.items.length) setMsg({ ok: true, text: "규칙을 추가했습니다. 내 자산 → 목표 비중에서 목표를 저장해야 확인합니다." });
    else setMsg({ ok: true, text: "규칙을 추가했습니다. 바로 한 번 확인합니다." });
    void save((cur) => ({ ...cur, rules: [...cur.rules, r] }));
  };

  const addHeld = () => {
    const syms = heldSymbols(pf.value).filter((s) => getInstrument(s));
    if (!syms.length) return setMsg({ ok: false, text: "내 자산에 보유 종목이 없습니다." });
    const have = new Set(d.rules.map((r) => `${r.kind}:${r.symbol}`));
    const now = Date.now();
    const rs: AlertRule[] = syms.flatMap((s) =>
      (["dividend_change", "new_schedule", "ex_soon"] as AlertKind[]).filter((k) => !have.has(`${k}:${s}`)).map((k) => ({ id: newId(), kind: k, symbol: s, enabled: true, createdAt: now, ...(k === "ex_soon" ? { days: 3 } : {}) })),
    );
    setMsg({ ok: true, text: rs.length ? `보유 종목 ${syms.length}개에 배당 알림 ${rs.length}개를 추가했습니다.` : "이미 모두 추가되어 있습니다." });
    if (rs.length) void save((cur) => ({ ...cur, rules: [...cur.rules, ...rs] }));
  };

  const askPermission = async () => {
    if (!("Notification" in window)) return;
    const p = (await Notification.requestPermission()) as Perm;
    setPerm(p);
    if (p === "granted") void save((cur) => ({ ...cur, notify: true }));
  };

  const unread = d.log.filter((e) => !e.read).length;
  const describe = (r: AlertRule) =>
    `${r.symbol ? `${r.symbol} · ` : ""}${ALERT_KIND_KO[r.kind]}${r.kind === "ex_soon" ? ` (${r.days}일 전부터)` : ""}${r.kind === "price" ? ` $${r.value} ${r.op === "below" ? "이하" : "이상"}` : ""}${r.kind === "pnl" ? ` ${r.value}% ${r.op === "below" ? "이하" : "이상"}` : ""}`;
  const baseText = (r: AlertRule) => {
    const b = d.baseline[r.id];
    if (b === undefined) return "아직 확인 전 (데이터가 없으면 확인하지 않음)";
    if (r.kind === "dividend_change") {
      const x = b as { ex: string; amount: number };
      return `기준: 주당 $${x.amount} (배당락 ${x.ex})`;
    }
    if (r.kind === "expense_change") return `기준: ${(b as number).toFixed(2)}%`;
    if (r.kind === "holdings_change") return `기준: ${(b as string[]).join(", ")}`;
    if (r.kind === "new_schedule") return `확인한 배당락일: ${(b as string[]).slice(-3).join(", ") || "없음"}`;
    if (r.kind === "ex_soon") return `알린 배당락일: ${(b as string[]).slice(-3).join(", ") || "없음"}`;
    if (r.kind === "target_drift") return `현재 이탈: ${(b as string[]).join(", ") || "없음"}`;
    return b === true ? "조건 충족 상태 (풀렸다가 다시 맞으면 또 알림)" : "조건 미충족";
  };

  if (!a.loaded) return <div className="skeleton h-64" aria-label="알림 설정을 불러오는 중" />;
  return (
    <div className="flex flex-col gap-5">
      {a.error && <Notice tone="critical" title="저장 오류">{a.error}</Notice>}
      <Notice title="이렇게 동작합니다">
        이 사이트를 연 브라우저 탭이 있을 때만 15분마다(그리고 화면으로 돌아올 때) 확인합니다. 데이터는 수집 작업이 실행될 때 바뀌므로 그보다 빨리 알 수는 없습니다.
        브라우저를 완전히 닫았을 때 오는 푸시 알림은 <b>지원하지 않습니다</b> — 서버가 사용자별 규칙과 구독 정보를 보관해야 해서, 개인 데이터를 브라우저에만 두는 이 사이트의 원칙과 맞지 않아 구현하지 않았습니다.
      </Notice>

      <Section title="브라우저 알림" description="켜 두면 새 알림이 생길 때 운영체제 알림도 띄웁니다 (사이트가 열려 있을 때만)">
        {perm === "unsupported" ? (
          <p className="text-sm text-muted">이 브라우저는 알림(Notification)을 지원하지 않습니다. 이 화면과 위쪽 종 아이콘의 기록으로 확인하세요.</p>
        ) : perm === "denied" ? (
          <p className="text-sm text-warn">브라우저에서 이 사이트의 알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용으로 바꾸면 쓸 수 있습니다.</p>
        ) : perm === "default" ? (
          <button type="button" className="btn btn-sm" onClick={askPermission}>
            브라우저 알림 허용하기
          </button>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.notify} onChange={(e) => void save((cur) => ({ ...cur, notify: e.target.checked }))} className="h-4 w-4" />
            새 알림을 브라우저 알림으로도 띄우기
          </label>
        )}
        <p className="mt-2 text-[11px] text-muted">
          마지막 확인: {d.lastCheck ? `${formatEt(d.lastCheck)} (${relativeTime(d.lastCheck)})` : "아직 없음"}{" "}
          <button type="button" className="btn btn-sm ml-2" onClick={check} disabled={!d.rules.some((r) => r.enabled)}>
            지금 확인
          </button>
        </p>
      </Section>

      <Section title="규칙 추가">
        <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <Field label="알림 종류">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {ALERT_KIND_KO[k]}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            {SYMBOL_KINDS.includes(kind) && (
              <div className="w-44">
                <SymbolField value={symbol} onChange={setSymbol} label="알림 종목" />
              </div>
            )}
            {kind === "ex_soon" && (
              <Field label="며칠 전부터">
                <input className="input w-20" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            )}
            {(kind === "price" || kind === "pnl") && (
              <>
                <Seg label="조건" value={op} onChange={setOp} options={[{ v: "above", l: "이상" }, { v: "below", l: "이하" }]} />
                <Field label={kind === "price" ? "가격 (달러)" : "총수익률 (%)"}>
                  <input className="input w-28" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "price" ? "예: 30" : "예: -10"} />
                </Field>
              </>
            )}
            <button type="button" className="btn btn-primary btn-sm mb-0.5" onClick={add}>
              추가
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{HINT[kind]}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={addHeld}>
            내 보유 종목 배당 알림 한 번에 추가
          </button>
          <span className="text-[11px] text-muted">금액 변경·새 일정·배당락 3일 전 알림을 보유 종목마다 추가</span>
        </div>
        {msg && (
          <p role="status" className={`mt-2 text-xs ${msg.ok ? "text-good" : "text-critical"}`}>
            {msg.text}
          </p>
        )}
      </Section>

      <Section title={`규칙 ${d.rules.length}개`}>
        {d.rules.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {d.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className={r.enabled ? "font-semibold" : "font-semibold text-muted line-through"}>{describe(r)}</p>
                  <p className="text-[11px] text-muted">{baseText(r)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => void save((cur) => ({ ...cur, rules: cur.rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) }))}>
                    {r.enabled ? "끄기" : "켜기"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void save((cur) => {
                        const baseline = { ...cur.baseline };
                        delete baseline[r.id];
                        return { ...cur, rules: cur.rules.filter((x) => x.id !== r.id), baseline };
                      })
                    }
                    aria-label={`${describe(r)} 삭제`}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">규칙이 없습니다. 위에서 추가하세요.</p>
        )}
      </Section>

      <Section
        title={`알림 기록${unread ? ` (읽지 않음 ${unread})` : ""}`}
        right={
          d.log.length > 0 && (
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => void save((cur) => ({ ...cur, log: cur.log.map((e) => ({ ...e, read: true })) }))} disabled={!unread}>
                모두 읽음
              </button>
              <button type="button" className="btn btn-sm" onClick={() => window.confirm("알림 기록을 모두 지울까요?") && void save((cur) => ({ ...cur, log: [] }))}>
                기록 지우기
              </button>
            </div>
          )
        }
      >
        {d.log.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {d.log.map((e) => (
              <li key={e.id} className={`py-2 text-sm ${e.read ? "" : "font-semibold"}`}>
                <p>
                  {!e.read && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" aria-label="읽지 않음" />}
                  {e.title}
                </p>
                <p className="text-xs font-normal text-ink-2">{e.body}</p>
                <p className="text-[11px] font-normal text-muted">
                  {formatEt(e.at)} 확인{e.dataAsOf ? ` · 데이터 기준 ${e.dataAsOf}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">아직 알림이 없습니다. 변경 알림은 처음 확인한 값을 기준으로 하므로, 기준 이후에 바뀐 경우에만 생깁니다.</p>
        )}
      </Section>
      <p className="text-[11px] text-muted">
        목표 비중은 <Link className="link" href="/portfolio">내 자산 → 목표 비중</Link>에서 저장합니다.
      </p>
      <LocalOnlyNote what="알림 규칙·기준값·알림 기록" />
    </div>
  );
}
