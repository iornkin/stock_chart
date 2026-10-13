import { get } from "@/lib/db";
import { jobHealth, recentRuns, pendingRequests } from "@/lib/jobs/runner";
import { describeSchedule, getSchedule } from "@/lib/jobs/schedule";
import { JOB_LABELS, type JobName } from "@/lib/jobs/jobs";
import { providerConfig, providerStats } from "@/lib/views";
import { formatEt } from "@/lib/time";
import { marketStatus, upcomingHolidays } from "@/lib/market-calendar";
import { Notice, PageHeader, Section } from "@/components/ui";
import RelTime from "@/components/RelTime";
import MarketPhaseText from "@/components/MarketPhaseText";
import { perRequest } from "@/lib/page-mode";
import { IS_STATIC } from "@/lib/static-mode";

export const metadata = { title: "데이터 상태" };

const STATUS_STYLE: Record<string, string> = {
  success: "text-good",
  partial: "text-warn",
  failed: "text-critical",
  running: "text-accent",
  skipped: "text-muted",
};
const STATUS_KO: Record<string, string> = { success: "성공", partial: "부분 성공", failed: "실패", running: "실행 중", skipped: "건너뜀" };

export default async function StatusPage() {
  await perRequest();
  const renderedAt = Date.now();
  const lock = get<{ owner: string; expires_at: number }>("SELECT owner, expires_at FROM locks WHERE name='worker'");
  const alive = Boolean(lock && lock.expires_at > Date.now());
  const jobs = jobHealth();
  const runs = recentRuns(40);
  const providers = providerConfig();
  const stats = new Map(providerStats(Date.now() - 24 * 3600_000).map((s) => [s.provider, s]));
  const keyOf: Record<string, string> = {
    "Yahoo Finance": "yahoo",
    "Nasdaq.com": "nasdaq",
    "SEC EDGAR": "sec",
    Finnhub: "finnhub",
    "Polygon.io": "polygon",
    FRED: "fred",
    "Alpha Vantage": "alphavantage",
    "Google News RSS": "googlenews",
    "Anthropic Claude": "anthropic",
  };
  const st = marketStatus(renderedAt);
  const sched = describeSchedule(getSchedule());
  return (
    <div className="flex flex-col">
      <PageHeader title="데이터 상태" description="자동 업데이트 작업의 성공·실패 기록과 데이터 제공처 연결 상태입니다." />
      <div className="flex flex-col gap-5">
        {IS_STATIC && (
          <Notice tone="info" title="GitHub Actions 예약 실행으로 수집합니다">
            이 화면은 {formatEt(renderedAt)} ET 에 만들어진 스냅샷입니다. 자동 수집은 상시 실행되는 워커 대신 GitHub Actions 가 정해진 시각에 실행합니다. 일정은 설정 화면에서 확인할 수 있습니다.
          </Notice>
        )}
        {!IS_STATIC && !alive && (
          <Notice tone="critical" title="스케줄러(워커)가 실행되고 있지 않습니다">
            자동 데이터 수집과 일일 브리핑 생성이 멈춰 있습니다. 서버에서 <code>npm run worker</code> (또는 <code>npm run start:all</code>)를 실행하세요. 화면 조회 시 일부 데이터는 필요할 때 직접 받아옵니다.
          </Notice>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="작업별 상태">
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>작업</th>
                    <th>최근 실행</th>
                    <th>마지막 정상 완료</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.job}>
                      <td>
                        {j.label}
                        <span className="block text-[10px] text-muted">{sched.find((s) => s.job === j.job)?.when}</span>
                      </td>
                      <td className="text-xs">
                        {j.lastRun ? (
                          <>
                            <span className={STATUS_STYLE[j.lastRun.status]}>{STATUS_KO[j.lastRun.status] ?? j.lastRun.status}</span> · {formatEt(j.lastRun.started_at)}
                            <span className="block text-muted">{j.lastRun.message}</span>
                          </>
                        ) : (
                          <span className="text-muted">실행 기록 없음</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {j.lastSuccess ? (
                          <>
                            {formatEt(j.lastSuccess.finished_at ?? j.lastSuccess.started_at)} <RelTime ms={j.lastSuccess.finished_at} paren />
                          </>
                        ) : (
                          "없음"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              {IS_STATIC ? "자동 실행: GitHub Actions 예약 실행" : `워커: ${alive ? `실행 중 (${lock?.owner})` : "중지"} · 대기 중인 수동 요청 ${pendingRequests()}건`} · 시장 <MarketPhaseText at={renderedAt} /> · 다가오는 휴장일:{" "}
              {upcomingHolidays(st.etDate, 60)
                .map((h) => `${h.date} ${h.name}`)
                .join(", ") || "없음(60일 이내)"}
            </p>
          </Section>
          <Section title="데이터 제공처" description="API 키 값은 표시하지 않습니다. 최근 24시간 호출 결과">
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>제공처</th>
                    <th>상태</th>
                    <th className="r">성공/실패</th>
                    <th>최근 오류</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => {
                    const s = stats.get(keyOf[p.name]);
                    return (
                      <tr key={p.name}>
                        <td>
                          {p.name}
                          <span className="block text-[10px] text-muted">{p.role}</span>
                        </td>
                        <td className="text-xs">{p.enabled ? <span className="text-good">사용</span> : <span className="text-muted">미설정{p.keyName ? ` (${p.keyName})` : ""}</span>}</td>
                        <td className="r text-xs">{s ? `${s.ok} / ${s.fail}` : "-"}</td>
                        <td className="max-w-[16rem] truncate text-xs text-critical" title={s?.last_error ?? ""}>
                          {s?.last_error ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
        <Section title="최근 작업 실행 기록">
          <div className="overflow-x-auto">
            <table className="table-basic">
              <thead>
                <tr>
                  <th>시작(ET)</th>
                  <th>작업</th>
                  <th>구분</th>
                  <th>결과</th>
                  <th>메시지</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="num whitespace-nowrap text-xs">{formatEt(r.started_at)}</td>
                    <td className="text-xs">{JOB_LABELS[r.job as JobName] ?? r.job}</td>
                    <td className="text-xs text-muted">
                      {r.trigger === "schedule" ? "예약" : r.trigger === "cli" ? "CLI" : "수동"} · {r.slot}
                    </td>
                    <td className={`text-xs ${STATUS_STYLE[r.status]}`}>{STATUS_KO[r.status] ?? r.status}</td>
                    <td className="text-xs">
                      {r.message}
                      {r.details && (
                        <details>
                          <summary className="text-accent">상세</summary>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-muted">{r.details}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!runs.length && <p className="p-3 text-sm text-muted">실행 기록이 없습니다.</p>}
          </div>
        </Section>
      </div>
    </div>
  );
}
