/** 종목별·시장 일일 브리핑 표시 (서버·브라우저 공용, 상태 없음) */
import type { BriefingNews, Evidence, KeyValue, MarketBriefing, Statement, SymbolBriefing, UpcomingItem } from "@/lib/briefing/types";
import { KIND_DESC, KIND_LABEL } from "@/lib/briefing/types";
import type { ChangeItem, ChangeTag, CompareRow } from "@/lib/briefing/signals";
import type { Judgment } from "@/lib/briefing/judgment";
import { formatEt } from "@/lib/time";
import { changeClass, fmtCompact, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import RelTime from "./RelTime";
import NewsThumb from "./NewsThumb";
import { Empty, KindBadge, Notice } from "./ui";
import { safeLinkUrl } from "@/lib/news-utils";

// ─────────────────────────────── 공용 조각 ───────────────────────────────

/** 근거 자료 연결 — 문장 끝에 작게 표시 */
function EvRef({ ids, prefix }: { ids: string[]; prefix: string }) {
  if (!ids.length) return null;
  return (
    <a href={`#${prefix}-ev-${ids[0]}`} title={`근거 자료: ${ids.join(", ")}`} className="ml-1.5 whitespace-nowrap align-[1px] text-[10px] text-muted hover:text-accent">
      근거 {ids.join("·")}
    </a>
  );
}

export function StatementItem({ s, prefix }: { s: Statement; prefix: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <KindBadge kind={s.kind} />
      <span className="prose-ko-sm min-w-0 text-ink">
        {s.text}
        <EvRef ids={s.evidence} prefix={prefix} />
      </span>
    </li>
  );
}

export function Statements({ items, prefix, empty }: { items: Statement[]; prefix: string; empty?: string }) {
  if (!items.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="flex flex-col">
      {items.map((s, i) => (
        <StatementItem key={i} s={s} prefix={prefix} />
      ))}
    </ul>
  );
}

function KvTable({ rows }: { rows: KeyValue[] }) {
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm" title={r.note}>
          <dt className="text-ink-2">
            {r.label}
            {r.note && <span className="ml-1 text-[10px] text-muted">ⓘ</span>}
          </dt>
          <dd className="num text-right font-semibold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 브리핑 안의 구획 제목 */
function Block({ title, sub, children, id }: { title: string; sub?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-bold tracking-tight">{title}</h3>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

/** 접어 두는 상세 구획 (제목은 항상 보임) */
function Fold({ title, hint, children, open = false }: { title: string; hint?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-line">
      <summary className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {hint}
          <span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

export function NewsCards({ items }: { items: BriefingNews[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((n) => (
        <li key={n.id} id={`news-${n.id}`} className="flex gap-3 rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
          <NewsThumb src={n.image} label={n.publisher} className="h-[72px] w-24 sm:h-20 sm:w-32" />
          <div className="min-w-0 flex-1">
            <a href={safeLinkUrl(n.url)} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[15px] font-semibold leading-snug hover:text-accent">
              {n.titleKo ?? n.title}
            </a>
            <p className="mt-1 text-xs text-muted">
              {n.publisher ?? "출처 미상"} · <span className="num">{formatEt(n.publishedAt)}</span> <RelTime ms={n.publishedAt} paren />
            </p>
            {(n.summaryKo ?? n.summary) && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-2">{n.summaryKo ?? n.summary}</p>}
            <details className="mt-1 text-[11px] text-muted">
              <summary className="inline-block hover:text-accent">관련 이유·출처{n.duplicates.length ? ` · 같은 내용 ${n.duplicates.length}건` : ""}</summary>
              <div className="mt-1 flex flex-col gap-0.5">
                <span>관련 이유: {n.reason}</span>
                {n.titleKo && <span>원제: {n.title}</span>}
                <span>
                  수집 {n.provider}
                  {n.summaryBasis === "ai" ? " · 요약은 AI(제목·제공처 요약문만 사용)" : n.summaryBasis === "provider" ? " · 요약은 제공처 요약문" : ""}
                </span>
                {n.duplicates.map((d) => (
                  <a key={d.url} href={safeLinkUrl(d.url)} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                    {d.publisher ?? "출처 미상"} · {formatEt(d.publishedAt)} — {d.title}
                  </a>
                ))}
              </div>
            </details>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function UpcomingTable({ items }: { items: UpcomingItem[] }) {
  return (
    <ol className="flex flex-col">
      {items.map((u, i) => (
        <li key={i} className="flex items-baseline gap-3 border-b border-line py-2 last:border-0">
          <span className="num w-[5.5rem] shrink-0 text-sm font-semibold">{u.date.slice(5).replace("-", "/")}</span>
          <span className="w-16 shrink-0 text-xs text-muted">{u.kind}</span>
          <span className="min-w-0 flex-1 text-sm">
            {u.title}
            {u.detail && <span className="ml-1 text-xs text-muted">({u.detail})</span>}
            <span className="ml-1.5 text-[10px] text-muted">{u.source}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function EvidenceList({ items, prefix }: { items: Evidence[]; prefix: string }) {
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-semibold">근거 자료 {items.length}건 (문장 끝 &lsquo;근거&rsquo; 표시와 연결)</summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {items.map((e) => (
          <li key={e.id} id={`${prefix}-ev-${e.id}`} className="scroll-mt-20">
            <span className="font-mono font-semibold">{e.id}</span> · {e.label}
            {e.value && <span className="text-ink-2"> — {e.value}</span>}
            <span className="text-muted">
              {" "}
              (출처: {e.source}
              {e.asOf ? `, 기준 ${e.asOf}` : ""})
            </span>
            {e.url && (
              <a href={safeLinkUrl(e.url)} target="_blank" rel="noopener noreferrer" className="link ml-1">
                원문↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function KindLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
      {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <KindBadge kind={k} />
          {KIND_DESC[k]}
        </span>
      ))}
    </div>
  );
}

export function BasisBlock({ basis, generatedAt, sessionLabel, evidence, prefix }: { basis: SymbolBriefing["basis"]; generatedAt: number; sessionLabel: string; evidence: Evidence[]; prefix: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
        <div className="flex justify-between gap-2"><dt className="text-ink-2">분석 기준 날짜</dt><dd className="num">{basis.analysisDate} (ET)</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">브리핑 구분</dt><dd className="text-right">{sessionLabel}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">주가 데이터 기준</dt><dd className="num text-right">{basis.priceAsOf ? formatEt(basis.priceAsOf) : "-"} · {basis.priceAsOfLabel}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">뉴스 수집 기준</dt><dd className="num">{basis.newsAsOf ? formatEt(basis.newsAsOf) : "-"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">브리핑 생성</dt><dd className="num">{formatEt(generatedAt)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">데이터 제공처</dt><dd className="text-right">{basis.providers.length ? basis.providers.join(", ") : "-"}</dd></div>
      </dl>
      <KindLegend />
      {basis.limitations.length > 0 && (
        <Notice tone="warn" title="자료가 부족해 분석 범위가 줄어든 항목">
          <ul className="list-disc pl-4">
            {basis.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Notice>
      )}
      <EvidenceList items={evidence} prefix={prefix} />
      <p className="text-[11px] leading-relaxed text-muted">
        수집된 데이터와 뉴스로 자동 생성한 정보 정리이며 매수·매도 권유가 아닙니다. 확인되지 않은 원인은 추정하지 않습니다.
      </p>
    </div>
  );
}

// ─────────────────────────────── 한눈에 보기 ───────────────────────────────

const TAG_LABEL: Record<ChangeTag, string> = { price: "가격", volume: "거래량", technical: "기술적", news: "뉴스", dividend: "배당", event: "일정", relative: "비교", risk: "위험" };

const dirText = (d: "up" | "down" | "neutral") => (d === "up" ? "text-up" : d === "down" ? "text-down" : "text-ink-2");
const dirBg = (d: "up" | "down" | "neutral") => (d === "up" ? "bg-up-soft text-up" : d === "down" ? "bg-down-soft text-down" : "bg-surface-3 text-ink-2");
const dirBar = (d: "up" | "down" | "neutral") => (d === "up" ? "bg-up" : d === "down" ? "bg-down" : "bg-line-strong");

function stanceTone(j: Judgment): "up" | "down" | "neutral" {
  return j.score > 0 ? "up" : j.score < 0 ? "down" : "neutral";
}

/** −max ~ +max 점수 막대 */
function ScoreMeter({ j }: { j: Judgment }) {
  const n = Math.max(j.maxScore, 1);
  const cells = Array.from({ length: n * 2 + 1 }, (_, i) => i - n);
  return (
    <div className="flex items-center gap-1" aria-label={`규칙 점수 ${j.score} / ${j.maxScore}`}>
      {cells.map((v) => {
        const on = (j.score > 0 && v > 0 && v <= j.score) || (j.score < 0 && v < 0 && v >= j.score) || (j.score === 0 && v === 0);
        return <span key={v} className={`h-2 w-5 rounded-full ${on ? (v > 0 ? "bg-up" : v < 0 ? "bg-down" : "bg-ink-2") : "bg-surface-3"} ${v === 0 ? "w-2" : ""}`} />;
      })}
    </div>
  );
}

function GlanceStat({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`num mt-0.5 text-[15px] font-semibold ${cls}`}>{value}</dd>
    </div>
  );
}

function Glance({ b }: { b: SymbolBriefing }) {
  const g = b.glance;
  const j = b.judgment;
  const chips = (b.changes?.items ?? []).slice(0, 4);
  return (
    <div className="grid gap-4 rounded-2xl border border-line bg-surface-2 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        {g && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="num text-3xl font-bold tracking-tight">{fmtUsd(g.price)}</span>
              <span className={`num text-lg font-semibold ${changeClass(g.changePct)}`}>{fmtPct(g.changePct)}</span>
              <span className="text-xs text-muted">{b.session === "intraday" ? "장중 잠정" : `${b.tradeDate} 종가`}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <GlanceStat label="거래량 (20일 평균 대비)" value={g.volRatio !== null ? `${g.volRatio.toFixed(1)}배` : "-"} />
              <GlanceStat label="20거래일 수익률" value={fmtPct(g.ret20)} cls={changeClass(g.ret20)} />
              <GlanceStat label="RSI(14)" value={g.rsi !== null ? g.rsi.toFixed(0) : "-"} cls={g.rsi !== null && (g.rsi >= 70 || g.rsi <= 30) ? "text-warn" : ""} />
              <GlanceStat label="1년 고점 대비" value={fmtPct(g.fromHigh)} />
            </dl>
          </>
        )}
        {chips.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="오늘의 주요 변화">
            {chips.map((c, i) => (
              <li key={i} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${dirBg(c.direction)}`}>
                {c.short}
              </li>
            ))}
          </ul>
        )}
      </div>
      {j && (
        <div className="flex min-w-[220px] flex-col justify-between gap-3 rounded-xl bg-surface p-4">
          <div>
            <p className="text-[11px] text-muted">오늘의 종합 판단</p>
            <p className={`mt-0.5 text-xl font-bold ${dirText(stanceTone(j))}`}>{j.label}</p>
          </div>
          {j.stance !== "unavailable" && <ScoreMeter j={j} />}
          <p className="text-[11px] text-muted">
            위험 수준 <span className={`font-semibold ${j.risk.level === "high" ? "text-critical" : j.risk.level === "low" ? "text-good" : "text-ink-2"}`}>{j.risk.level === "high" ? "높음" : j.risk.level === "low" ? "낮음" : "보통"}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function ChangeList({ items, prefix }: { items: ChangeItem[]; prefix: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((c, i) => (
        <li key={i} className="flex gap-3 rounded-xl border border-line p-3">
          <span aria-hidden className={`w-1 shrink-0 rounded-full ${dirBar(c.direction)}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[15px] font-semibold ${dirText(c.direction)}`}>{c.short}</span>
              {c.importance === 3 && <span className="rounded bg-critical-soft px-1.5 py-0.5 text-[10px] font-semibold text-critical">중요</span>}
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{TAG_LABEL[c.tag]}</span>
              <KindBadge kind={c.kind} />
            </div>
            <p className="prose-ko-sm mt-1">
              {c.text}
              <EvRef ids={c.evidence} prefix={prefix} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CompareTable({ rows, prevDate, curDate }: { rows: CompareRow[]; prevDate: string; curDate: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-basic">
        <thead>
          <tr>
            <th>항목</th>
            <th className="r">전일 ({prevDate.slice(5).replace("-", "/")})</th>
            <th className="r">오늘 ({curDate.slice(5).replace("-", "/")})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="text-ink-2">{r.label}</td>
              <td className="r text-muted">{r.prev}</td>
              <td className={`r font-semibold ${r.direction === "neutral" ? "" : dirText(r.direction)}`}>
                {r.cur} {r.direction === "up" ? "▲" : r.direction === "down" ? "▼" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JudgmentCard({ j, prefix }: { j: Judgment; prefix: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="prose-ko">{j.summary}</p>
      {j.factors.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {j.factors.map((f) => (
            <li key={f.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{f.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.score === null ? "bg-surface-2 text-ink-2" : dirBg(f.score > 0 ? "up" : f.score < 0 ? "down" : "neutral")}`}>
                  {f.verdict}
                  {f.score !== null && ` (${f.score > 0 ? "+" : ""}${f.score})`}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                {f.text}
                <EvRef ids={f.evidence} prefix={prefix} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {j.cautions.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-warn">주의할 점</p>
            <ul className="flex flex-col gap-1.5">
              {j.cautions.map((c, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                  <span aria-hidden className="text-warn">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        {j.watch.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-2">앞으로 확인할 가격·일정</p>
            <ul className="flex flex-col gap-1.5">
              {j.watch.map((w, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                  <span aria-hidden className="text-accent">✓</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {j.income.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3 text-[13px]">
          {j.income.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        위험 수준: {j.risk.text || "-"} · {j.note}
      </p>
    </div>
  );
}

// ─────────────────────────────── 종목 브리핑 ───────────────────────────────

export default function BriefingView({ b }: { b: SymbolBriefing }) {
  const prefix = `b-${b.scope}`;
  const ch = b.changes;
  return (
    <article className="flex flex-col gap-7">
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">
          {b.sessionLabel} · 생성 {formatEt(b.generatedAt)}
        </p>
        <h2 className="text-xl font-bold tracking-tight">
          {b.name} <span className="text-muted">{b.scope}</span>
        </h2>
        <p className="text-sm text-ink-2">{b.headline}</p>
        {b.status === "partial" && <Notice tone="warn">가격 데이터가 부족해 일부 분석을 생략했습니다. 맨 아래 &lsquo;데이터와 분석의 기준&rsquo;에서 제한 사항을 확인하세요.</Notice>}
      </header>

      {(b.glance || b.judgment) && <Glance b={b} />}

      {ch && (
        <Block title="오늘의 핵심 변화" sub={ch.comparedWith ? `${ch.comparedWith} 대비 새로 생긴 변화만 표시` : undefined}>
          {ch.items.length ? <ChangeList items={ch.items} prefix={prefix} /> : <Empty>{ch.note}</Empty>}
          {ch.table.length > 0 && ch.comparedWith && (
            <div className="mt-3">
              <Fold title="전일과 달라진 수치" hint={`${ch.table.length}개 항목`}>
                <CompareTable rows={ch.table} prevDate={ch.comparedWith} curDate={b.tradeDate} />
              </Fold>
            </div>
          )}
        </Block>
      )}

      {b.judgment && (
        <Block title="종합 판단" sub="규칙 기반 자동 분석 · 투자 권유 아님">
          <JudgmentCard j={b.judgment} prefix={prefix} />
        </Block>
      )}

      {b.ai && (
        <Block title="AI 분석" sub={`${b.ai.model} · 근거 자료만 사용 · ${formatEt(b.ai.generatedAt)}`}>
          <Statements items={b.ai.paragraphs} prefix={prefix} />
        </Block>
      )}

      <Block title="오늘의 핵심 요약">
        <Statements items={b.summary} prefix={prefix} />
      </Block>

      <Block title="관련 뉴스와 발표" sub={b.news.windowLabel}>
        {b.news.items.length ? <NewsCards items={b.news.items} /> : <Empty>이 기간에 확인된 관련 뉴스가 없습니다.</Empty>}
        {b.news.holdingsItems.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-ink-2">상위 편입 종목 관련 기사</p>
            <NewsCards items={b.news.holdingsItems} />
          </div>
        )}
        {b.price.causality && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{b.price.causality.text}</p>}
        {b.news.olderCount > 0 && <p className="mt-2 text-xs text-muted">이전 7일 관련 기사 {b.news.olderCount}건은 &lsquo;뉴스&rsquo; 탭에서 볼 수 있습니다.</p>}
      </Block>

      <div className="flex flex-col gap-3">
        <Fold title="주가·거래량 상세" hint={b.price.available ? `${b.price.table.length}개 수치` : "데이터 없음"}>
          {b.price.available ? (
            <div className="flex flex-col gap-4">
              <Statements items={b.price.statements} prefix={prefix} />
              <KvTable rows={b.price.table} />
              {b.price.recent.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table-basic">
                    <caption className="mb-1 text-left text-xs text-muted">최근 거래일 흐름</caption>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th className="r">종가</th>
                        <th className="r">등락률</th>
                        <th className="r">거래량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.price.recent.map((r) => (
                        <tr key={r.date}>
                          <td className="num">{r.date}</td>
                          <td className="r">{fmtPrice(r.close)}</td>
                          <td className={`r ${changeClass(r.changePct)}`}>{fmtPct(r.changePct)}</td>
                          <td className="r">{fmtCompact(r.volume)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {b.price.intraday.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-ink-2">장중 흐름</p>
                  <Statements items={b.price.intraday} prefix={prefix} />
                </div>
              )}
              {b.price.benchmark.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-ink-2">관련 지수·기초자산과 비교</p>
                  <Statements items={b.price.benchmark} prefix={prefix} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">분석 기준일의 가격 데이터를 확인하지 못했습니다.</p>
          )}
        </Fold>

        <Fold title="기술적 분석" hint={b.technical.available ? `해석 ${b.technical.interpretations.length}건` : "데이터 부족"}>
          {b.technical.available ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <Statements items={b.technical.interpretations} prefix={prefix} />
              </div>
              <div>
                <KvTable rows={b.technical.values} />
                {b.technical.levels.length > 0 && (
                  <ul className="mt-3 text-sm">
                    {b.technical.levels.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2 border-b border-line py-1.5">
                        <span className={l.kind === "support" ? "text-down" : "text-up"}>{l.kind === "support" ? "지지 후보" : "저항 후보"}</span>
                        <span className="num font-semibold">{fmtPrice(l.price)}</span>
                        <span className="text-xs text-muted">{l.basis}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-[11px] text-muted lg:col-span-2">{b.technical.note}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">일봉 데이터가 부족해 기술적 지표를 계산하지 않았습니다.</p>
          )}
        </Fold>

        {b.distributions && (
          <Fold title={`${b.distributions.word} 현황`} hint={b.distributions.available ? "지급 기록 있음" : "기록 없음"}>
            <Statements items={b.distributions.statements} prefix={prefix} />
            <div className="mt-3">
              <KvTable rows={b.distributions.table} />
            </div>
          </Fold>
        )}

        <Fold title="앞으로 확인할 일정" hint={b.upcoming.items.length ? `${b.upcoming.items.length}건` : "없음"} open={b.upcoming.items.length > 0 && b.upcoming.items.length <= 6}>
          {b.upcoming.items.length ? <UpcomingTable items={b.upcoming.items} /> : <p className="text-sm text-muted">{b.upcoming.note}</p>}
        </Fold>

        <Fold title="주요 위험 요인" hint={`현재 관찰 ${b.risks.current.length}건`}>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-2">현재 상황 (데이터 기반)</p>
              <Statements items={b.risks.current} prefix={prefix} empty="데이터로 확인된 특이 사항이 없습니다." />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-2">상품·기업 유형의 일반적인 위험</p>
              <ul className="list-disc pl-5 text-[13px] leading-relaxed text-ink-2">
                {b.risks.general.map((r, i) => (
                  <li key={i} className="py-0.5">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Fold>

        <Fold title="데이터와 분석의 기준" hint={`근거 ${b.evidence.length}건`}>
          <BasisBlock basis={b.basis} generatedAt={b.generatedAt} sessionLabel={b.sessionLabel} evidence={b.evidence} prefix={prefix} />
        </Fold>
      </div>
    </article>
  );
}

// ─────────────────────────────── 시장 브리핑 ───────────────────────────────

export function MarketBriefingView({ b, compact = false }: { b: MarketBriefing; compact?: boolean }) {
  const prefix = "b-MARKET";
  if (compact)
    // 목록 화면용 요약: 헤드라인 + 첫 부분만 (전체는 시장 브리핑 화면에서)
    return (
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <p className="text-xs text-muted">
            {b.sessionLabel} · 생성 {formatEt(b.generatedAt)}
          </p>
          <p className="text-[15px] font-semibold leading-snug">{b.headline}</p>
        </header>
        {(b.ai ? [{ key: "ai", title: "AI 분석", statements: b.ai.paragraphs, table: undefined }] : b.sections.slice(0, 1)).map((s) => (
          <Block key={s.key} title={s.title}>
            <Statements items={s.statements} prefix={prefix} />
            {s.table && (
              <div className="mt-2">
                <KvTable rows={s.table} />
              </div>
            )}
          </Block>
        ))}
      </article>
    );
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">
          {b.sessionLabel} · 생성 {formatEt(b.generatedAt)}
        </p>
        <h2 className="text-xl font-bold tracking-tight">오늘의 미국 시장 브리핑</h2>
        <p className="text-sm text-ink-2">{b.headline}</p>
      </header>
      {b.ai && (
        <Block title="AI 분석" sub={`${b.ai.model} · 근거 ID 가 확인된 문장만 표시`}>
          <Statements items={b.ai.paragraphs} prefix={prefix} />
        </Block>
      )}
      {b.sections.map((s) => (
        <Block key={s.key} title={s.title}>
          <Statements items={s.statements} prefix={prefix} />
          {s.table && (
            <div className="mt-2">
              <KvTable rows={s.table} />
            </div>
          )}
        </Block>
      ))}
      {b.news.length > 0 && (
        <Block title="시장 뉴스" sub="게시 시각은 기사 발행 시각이며 사건 발생 시점과 다를 수 있습니다">
          <NewsCards items={b.news} />
        </Block>
      )}
      <Block title={`다음 거래일(${b.nextDay.date}) 확인 사항`}>
        {b.nextDay.items.length ? <UpcomingTable items={b.nextDay.items} /> : <Empty>다음 거래일에 확인된 주요 일정이 없습니다 (수집된 데이터 기준).</Empty>}
      </Block>
      <Fold title="데이터와 분석의 기준" hint={`근거 ${b.evidence.length}건`}>
        <BasisBlock basis={b.basis} generatedAt={b.generatedAt} sessionLabel={b.sessionLabel} evidence={b.evidence} prefix={prefix} />
      </Fold>
    </article>
  );
}
