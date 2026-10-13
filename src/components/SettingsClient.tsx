"use client";
import { useEffect, useState } from "react";
import { DEFAULT_PREFS, usePrefs } from "@/lib/client/prefs";

interface StatusResp {
  schedule: Record<string, string | number | boolean>;
  scheduleRows: { job: string; when: string; label: string }[];
  worker: { alive: boolean; owner: string | null; leaseUntil: number | null };
  adminEnabled: boolean;
  llm: { enabled: boolean; model: string; sessions: string[] };
}

const SCHEDULE_FIELDS: { key: string; label: string; type: "number" | "time" | "bool"; help?: string }[] = [
  { key: "quotesIntervalMin", label: "시세 갱신 주기(분)", type: "number", help: "거래일 04:00~20:00 ET" },
  { key: "newsIntervalMin", label: "뉴스 수집 주기(분)", type: "number" },
  { key: "newsStart", label: "뉴스 수집 시작(ET)", type: "time" },
  { key: "newsEnd", label: "뉴스 수집 종료(ET)", type: "time" },
  { key: "referenceTime", label: "참조 데이터 수집 시각(ET)", type: "time", help: "재무·ETF 정보·실적/경제 일정" },
  { key: "eodDelayMin", label: "장 마감 데이터 수집: 마감 후(분)", type: "number" },
  { key: "intradayBriefingEnabled", label: "장중 브리핑 생성", type: "bool" },
  { key: "intradayBriefingTime", label: "장중 브리핑 시각(ET)", type: "time" },
  { key: "closeBriefingDelayMin", label: "장 마감 후 브리핑: 마감 후(분)", type: "number" },
  { key: "nonTradingBriefingTime", label: "휴장일 브리핑 시각(ET)", type: "time" },
  { key: "maxAttempts", label: "실패 시 최대 재시도", type: "number" },
  { key: "retryDelayMin", label: "재시도 간격(분)", type: "number" },
];

export default function SettingsClient() {
  const [prefs, setPrefs] = usePrefs();
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch("/api/status")
      .then((r) => r.json())
      .then((j: StatusResp) => {
        setStatus(j);
        setDraft(j.schedule);
      })
      .catch(() => setMsg("서버 상태를 불러오지 못했습니다"));
  useEffect(() => {
    load();
    try {
      setToken(sessionStorage.getItem("usi-admin-token") ?? "");
    } catch {
      /* 무시 */
    }
  }, []);

  const saveSchedule = async () => {
    setMsg(null);
    try {
      sessionStorage.setItem("usi-admin-token", token);
    } catch {
      /* 무시 */
    }
    const r = await fetch("/api/admin/schedule", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(draft) });
    const j = await r.json();
    setMsg(r.ok ? "업데이트 일정을 저장했습니다. 워커가 다음 주기부터 적용합니다." : `저장 실패: ${j.error}`);
    if (r.ok) load();
  };

  const runJob = async (job: string) => {
    setMsg(null);
    const r = await fetch("/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ job, force: true }) });
    const j = await r.json();
    setMsg(r.ok ? j.message : `요청 실패: ${j.error}`);
  };

  const btn = (active: boolean) => `rounded-md border px-3 py-1.5 text-sm ${active ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line"}`;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card flex flex-col gap-4 p-5">
        <h2 className="font-semibold">화면</h2>
        <div>
          <p className="mb-1 text-sm text-ink-2">테마</p>
          <div className="flex gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <button key={t} type="button" className={btn(prefs.theme === t)} onClick={() => setPrefs({ theme: t })} aria-pressed={prefs.theme === t}>
                {t === "system" ? "시스템 설정" : t === "light" ? "라이트" : "다크"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm text-ink-2">상승·하락 색상</p>
          <div className="flex gap-2">
            <button type="button" className={btn(prefs.colors === "kr")} onClick={() => setPrefs({ colors: "kr" })} aria-pressed={prefs.colors === "kr"}>
              <span className="text-up">▲빨강</span> / <span className="text-down">▼파랑</span> (한국식)
            </button>
            <button type="button" className={btn(prefs.colors === "us")} onClick={() => setPrefs({ colors: "us" })} aria-pressed={prefs.colors === "us"}>
              <span className="text-up">▲초록</span> / <span className="text-down">▼빨강</span> (미국식)
            </button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm text-ink-2">화면 자동 새로고침 (장 운영 시간에만)</p>
          <div className="flex flex-wrap gap-2">
            {[0, 60, 300, 900].map((s) => (
              <button key={s} type="button" className={btn(prefs.autoRefreshSec === s)} onClick={() => setPrefs({ autoRefreshSec: s })} aria-pressed={prefs.autoRefreshSec === s}>
                {s === 0 ? "끄기" : s < 60 * 2 ? "1분" : `${s / 60}분`}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">새로고침은 서버에 저장된 최신 데이터를 다시 읽으며, 서버는 캐시 정책에 따라 제공처 호출 여부를 결정합니다.</p>
        </div>
        <div>
          <p className="mb-1 text-sm text-ink-2">차트 기본 설정</p>
          <p className="text-xs text-muted">
            현재: {prefs.chart.type === "candle" ? "캔들" : prefs.chart.type === "line" ? "라인" : "영역"} · SMA {prefs.chart.smaPeriods.join(", ") || "없음"} · EMA {prefs.chart.emaPeriods.join(", ") || "없음"} · RSI {prefs.chart.showRSI ? prefs.chart.rsiPeriod : "끔"} · MACD {prefs.chart.showMACD ? `${prefs.chart.macdFast}/${prefs.chart.macdSlow}/${prefs.chart.macdSignal}` : "끔"}
          </p>
          <p className="text-xs text-muted">차트 위의 &lsquo;지표 설정&rsquo;에서 변경하면 자동 저장됩니다.</p>
          <button type="button" className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => setPrefs({ chart: DEFAULT_PREFS.chart })}>
            차트 설정 초기화
          </button>
        </div>
        <div>
          <p className="mb-1 text-sm text-ink-2">관심 종목</p>
          <p className="text-xs text-muted">{prefs.watchlist.join(", ") || "없음"} — 관심 종목 페이지에서 추가·삭제·순서 변경</p>
        </div>
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="font-semibold">데이터 업데이트 일정 (서버)</h2>
        {status ? (
          <>
            <p className={`text-sm ${status.worker.alive ? "text-good" : "text-critical"}`}>
              스케줄러(워커): {status.worker.alive ? `실행 중 (${status.worker.owner})` : "실행되지 않음 — `npm run worker` 로 실행해야 자동 업데이트가 동작합니다"}
            </p>
            <ul className="text-sm">
              {status.scheduleRows.map((r) => (
                <li key={r.job} className="flex justify-between gap-2 border-b border-line py-1">
                  <span className="text-ink-2">{r.label}</span>
                  <span className="text-right text-xs">{r.when}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              AI 서술: {status.llm.enabled ? `사용 (${status.llm.model}, 대상: ${status.llm.sessions.join(", ")})` : "사용 안 함 (ANTHROPIC_API_KEY 미설정 — 규칙 기반 브리핑만 생성)"}
            </p>
            <details className="rounded-lg border border-line p-3">
              <summary className="text-sm font-semibold">관리자: 일정 변경·수동 실행</summary>
              {!status.adminEnabled ? (
                <p className="mt-2 text-xs text-muted">서버에 ADMIN_TOKEN 환경변수를 설정하면 이 화면에서 일정을 변경할 수 있습니다.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    관리자 토큰
                    <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="rounded border border-line bg-surface px-2 py-1" autoComplete="off" />
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SCHEDULE_FIELDS.map((f) => (
                      <label key={f.key} className="flex flex-col gap-1 text-xs" title={f.help}>
                        {f.label}
                        {f.type === "bool" ? (
                          <input type="checkbox" checked={Boolean(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} className="h-4 w-4" />
                        ) : (
                          <input
                            type={f.type === "time" ? "time" : "number"}
                            value={String(draft[f.key] ?? "")}
                            onChange={(e) => setDraft({ ...draft, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                            className="rounded border border-line bg-surface px-2 py-1"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <button type="button" onClick={saveSchedule} className="self-start rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">
                    일정 저장
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {["refresh_quotes", "collect_news", "collect_reference", "collect_eod", "briefing_close", "briefing_intraday", "briefing_non_trading"].map((j) => (
                      <button key={j} type="button" onClick={() => runJob(j)} className="rounded-md border border-line px-2 py-1 text-xs">
                        {j} 지금 실행
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </details>
          </>
        ) : (
          <div className="skeleton h-40" />
        )}
        {msg && <p className="text-sm text-ink-2" role="status">{msg}</p>}
      </section>
    </div>
  );
}
