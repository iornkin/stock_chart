/** 종목별 일일 브리핑 표시 (서버 컴포넌트) */
import type { BriefingNews, Evidence, KeyValue, MarketBriefing, Statement, SymbolBriefing, UpcomingItem } from "@/lib/briefing/types";
import { KIND_LABEL } from "@/lib/briefing/types";
import { formatEt, relativeTime } from "@/lib/time";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { Empty, KindBadge, Notice } from "./ui";

export function StatementItem({ s, prefix }: { s: Statement; prefix: string }) {
  return (
    <li className="flex items-start gap-2 py-1">
      <KindBadge kind={s.kind} />
      <span className="text-sm leading-relaxed">
        {s.text}
        {s.evidence.length > 0 && (
          <span className="ml-1 text-[10px] text-muted">
            {s.evidence.map((e) => (
              <a key={e} href={`#${prefix}-ev-${e}`} className="mr-0.5 hover:text-accent">
                [{e}]
              </a>
            ))}
          </span>
        )}
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
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-sm" title={r.note}>
          <dt className="text-ink-2">
            {r.label}
            {r.note && <span className="ml-1 text-[10px] text-muted">ⓘ</span>}
          </dt>
          <dd className="num text-right font-medium">
            {r.value} <span className="ml-1 text-[10px] font-normal text-muted">{r.kind === "calc" ? "계산" : "사실"}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function H({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-1 flex items-center gap-2 text-[15px] font-semibold">
      {n !== undefined && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">{n}</span>}
      {children}
    </h3>
  );
}

export function NewsCards({ items }: { items: BriefingNews[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((n) => (
        <li key={n.id} id={`news-${n.id}`} className="rounded-lg border border-line p-3">
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:text-accent">
            {n.titleKo ?? n.title}
          </a>
          {n.titleKo && <p className="text-xs text-muted">원제: {n.title}</p>}
          <p className="mt-1 text-sm text-ink-2">
            {n.summaryKo ?? n.summary ?? "제공처 요약 없음 — 원문 링크에서 확인하세요."}
            <span className="ml-1 text-[10px] text-muted">
              {n.summaryBasis === "ai" ? "(AI 요약 · 제목과 제공처 요약문만 사용)" : n.summaryBasis === "provider" ? "(제공처 요약문)" : ""}
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span className="num">게시 {formatEt(n.publishedAt)} ({relativeTime(n.publishedAt)})</span>
            <span>출처 {n.publisher ?? "미상"}</span>
            <span>수집 {n.provider}</span>
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="link">
              원문 보기 ↗
            </a>
          </div>
          <p className="mt-1 text-[11px] text-ink-2">
            <span className="font-semibold">관련 이유:</span> {n.reason}
          </p>
          {n.duplicates.length > 0 && (
            <details className="mt-1 text-[11px] text-muted">
              <summary className="text-accent">같은 내용의 기사 {n.duplicates.length}건 통합</summary>
              <ul className="mt-1 pl-3">
                {n.duplicates.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                      {d.publisher ?? "출처 미상"} · {formatEt(d.publishedAt)} — {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function UpcomingTable({ items }: { items: UpcomingItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-basic">
        <thead>
          <tr>
            <th>날짜(ET)</th>
            <th>구분</th>
            <th>내용</th>
            <th>출처</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u, i) => (
            <tr key={i}>
              <td className="num whitespace-nowrap">{u.date}</td>
              <td className="whitespace-nowrap">{u.kind}</td>
              <td>
                {u.title}
                {u.detail && <span className="ml-1 text-xs text-muted">({u.detail})</span>}
              </td>
              <td className="text-xs text-muted">{u.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvidenceList({ items, prefix }: { items: Evidence[]; prefix: string }) {
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="text-sm font-semibold">근거 자료 {items.length}건 (브리핑 문장의 [ID] 와 연결)</summary>
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
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="link ml-1">
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
    <div className="flex flex-wrap gap-2 text-[11px] text-muted">
      {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <KindBadge kind={k} />
          {k === "fact" && "수집 데이터로 확인된 사실"}
          {k === "calc" && "수집 데이터로 계산한 값"}
          {k === "interpretation" && "사이트의 규칙 기반 해석"}
          {k === "market_view" && "기사에 보도된 시장 참여자의 해석"}
          {k === "ai" && "AI 가 근거 자료만으로 작성"}
          {k === "notice" && "데이터 한계·안내"}
        </span>
      ))}
    </div>
  );
}

export function BasisBlock({ basis, generatedAt, sessionLabel, evidence, prefix }: { basis: SymbolBriefing["basis"]; generatedAt: number; sessionLabel: string; evidence: Evidence[]; prefix: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between gap-2"><dt className="text-ink-2">분석 기준 날짜</dt><dd className="num">{basis.analysisDate} (ET)</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">브리핑 구분</dt><dd className="text-right">{sessionLabel}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">주가 데이터 기준 시각</dt><dd className="num">{basis.priceAsOf ? formatEt(basis.priceAsOf) : "-"} · {basis.priceAsOfLabel}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">뉴스 수집 기준 시각</dt><dd className="num">{basis.newsAsOf ? formatEt(basis.newsAsOf) : "-"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">브리핑 생성 시각</dt><dd className="num">{formatEt(generatedAt)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-ink-2">데이터 제공처</dt><dd className="text-right">{basis.providers.length ? basis.providers.join(", ") : "-"}</dd></div>
      </dl>
      <KindLegend />
      {basis.limitations.length > 0 && (
        <Notice tone="warn" title="자료 부족으로 분석 범위가 제한된 항목">
          <ul className="list-disc pl-4">
            {basis.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Notice>
      )}
      <EvidenceList items={evidence} prefix={prefix} />
      <p className="text-[11px] text-muted">
        이 브리핑은 수집된 데이터와 뉴스에 근거해 자동 생성된 정보 정리이며 매수·매도 권유가 아닙니다. 사실·계산·해석을 구분해 표시하며, 확인되지 않은 원인은 추정하지 않습니다.
      </p>
    </div>
  );
}

export default function BriefingView({ b }: { b: SymbolBriefing }) {
  const prefix = `b-${b.scope}`;
  const priceAll = [...b.price.statements];
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">
          {b.sessionLabel} · 생성 {formatEt(b.generatedAt)}
        </p>
        <h2 className="text-lg font-bold">
          {b.name} ({b.scope}) 오늘의 투자 브리핑
        </h2>
        <p className="text-sm text-ink-2">{b.headline}</p>
        {b.status === "partial" && (
          <Notice tone="warn">가격 데이터가 부족해 일부 분석이 생략되었습니다. 아래 &lsquo;데이터와 분석의 기준&rsquo;에서 제한 사항을 확인하세요.</Notice>
        )}
      </header>

      <section>
        <H n={1}>오늘의 핵심 요약</H>
        <Statements items={b.summary} prefix={prefix} />
      </section>

      {b.ai && (
        <section className="rounded-lg border border-[color-mix(in_srgb,var(--s7)_40%,transparent)] p-3">
          <H>AI 분석 (근거 자료 기반 서술)</H>
          <Statements items={b.ai.paragraphs} prefix={prefix} />
          <p className="mt-1 text-[11px] text-muted">
            {b.ai.model} 가 이 페이지의 근거 자료만 사용해 작성했습니다 ({formatEt(b.ai.generatedAt)}). 근거 ID 가 없는 문장은 표시하지 않습니다.
          </p>
        </section>
      )}

      <section>
        <H n={2}>주가 움직임 분석</H>
        {b.price.available ? (
          <div className="flex flex-col gap-3">
            <Statements items={priceAll} prefix={prefix} />
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
                        <td className={`r ${(r.changePct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtPct(r.changePct)}</td>
                        <td className="r">{fmtCompact(r.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {b.price.intraday.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-2">장중 주요 가격 움직임</p>
                <Statements items={b.price.intraday} prefix={prefix} />
              </div>
            )}
            {b.price.benchmark.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-2">관련 지수·기초자산과 비교</p>
                <Statements items={b.price.benchmark} prefix={prefix} />
              </div>
            )}
            {b.price.causality && (
              <div className="rounded-md bg-surface-2 px-3 py-2">
                <Statements items={[b.price.causality]} prefix={prefix} />
              </div>
            )}
          </div>
        ) : (
          <Notice tone="warn">분석 기준일의 가격 데이터를 확인하지 못해 주가 움직임 분석을 생략했습니다.</Notice>
        )}
      </section>

      <section>
        <H n={3}>관련 뉴스 정리</H>
        <p className="mb-2 text-xs text-muted">{b.news.windowLabel} · 같은 내용의 기사는 하나로 통합 · 이 기간 이전 기사는 오늘 뉴스로 표시하지 않습니다</p>
        {b.news.items.length ? <NewsCards items={b.news.items} /> : <Statements items={b.news.statements} prefix={prefix} />}
        {b.news.holdingsItems.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-ink-2">상위 편입 종목 관련 기사</p>
            <NewsCards items={b.news.holdingsItems} />
          </div>
        )}
        {b.news.olderCount > 0 && <p className="mt-2 text-xs text-muted">이전 7일간 관련 기사 {b.news.olderCount}건은 &lsquo;뉴스&rsquo; 탭에서 날짜와 함께 확인할 수 있습니다.</p>}
      </section>

      <section>
        <H n={4}>기술적 분석</H>
        {b.technical.available ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-2">지표 계산 결과 (일봉)</p>
              <KvTable rows={b.technical.values} />
              {b.technical.levels.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-xs font-semibold text-ink-2">지지·저항 후보 (분석상 참고 수준)</p>
                  <ul className="text-sm">
                    {b.technical.levels.map((l, i) => (
                      <li key={i} className="flex justify-between border-b border-line py-1">
                        <span className={l.kind === "support" ? "text-down" : "text-up"}>{l.kind === "support" ? "지지 후보" : "저항 후보"}</span>
                        <span className="num">{fmtPrice(l.price)}</span>
                        <span className="text-xs text-muted">{l.basis}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-2">해석</p>
              <Statements items={b.technical.interpretations} prefix={prefix} />
            </div>
            <p className="text-[11px] text-muted lg:col-span-2">{b.technical.note}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">일봉 데이터가 부족해 기술적 지표를 계산하지 않았습니다.</p>
        )}
      </section>

      {b.distributions && (
        <section>
          <H>{b.distributions.word} 현황</H>
          <Statements items={b.distributions.statements} prefix={prefix} />
          <div className="mt-2">
            <KvTable rows={b.distributions.table} />
          </div>
        </section>
      )}

      <section>
        <H n={5}>앞으로 확인할 사항</H>
        {b.upcoming.items.length ? <UpcomingTable items={b.upcoming.items} /> : <Empty>{b.upcoming.note}</Empty>}
      </section>

      <section>
        <H n={6}>주요 위험 요인</H>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">일반적인 위험 (상품·기업 유형 설명)</p>
            <ul className="list-disc pl-5 text-sm text-ink-2">
              {b.risks.general.map((r, i) => (
                <li key={i} className="py-0.5">
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">현재 상황 관련 관찰 (데이터 기반)</p>
            <Statements items={b.risks.current} prefix={prefix} empty="데이터로 확인된 특이 사항이 없습니다." />
          </div>
        </div>
      </section>

      <section>
        <H n={7}>데이터와 분석의 기준</H>
        <BasisBlock basis={b.basis} generatedAt={b.generatedAt} sessionLabel={b.sessionLabel} evidence={b.evidence} prefix={prefix} />
      </section>
    </article>
  );
}

export function MarketBriefingView({ b }: { b: MarketBriefing }) {
  const prefix = "b-MARKET";
  return (
    <article className="flex flex-col gap-5">
      <header>
        <p className="text-xs text-muted">
          {b.sessionLabel} · 생성 {formatEt(b.generatedAt)}
        </p>
        <h2 className="text-lg font-bold">오늘의 미국 시장 브리핑</h2>
        <p className="text-sm text-ink-2">{b.headline}</p>
      </header>
      {b.ai && (
        <section className="rounded-lg border border-[color-mix(in_srgb,var(--s7)_40%,transparent)] p-3">
          <H>AI 분석 (근거 자료 기반 서술)</H>
          <Statements items={b.ai.paragraphs} prefix={prefix} />
          <p className="mt-1 text-[11px] text-muted">{b.ai.model} · 근거 ID 가 확인된 문장만 표시</p>
        </section>
      )}
      {b.sections.map((s) => (
        <section key={s.key}>
          <H>{s.title}</H>
          <Statements items={s.statements} prefix={prefix} />
          {s.table && (
            <div className="mt-2">
              <KvTable rows={s.table} />
            </div>
          )}
        </section>
      ))}
      {b.news.length > 0 && (
        <section>
          <H>시장 뉴스 상세</H>
          <p className="mb-2 text-xs text-muted">게시 시각은 기사 발행 시각이며, 기사에서 다루는 사건의 발생 시점과 다를 수 있습니다.</p>
          <NewsCards items={b.news} />
        </section>
      )}
      <section>
        <H>다음 거래일({b.nextDay.date}) 확인 사항</H>
        {b.nextDay.items.length ? <UpcomingTable items={b.nextDay.items} /> : <Empty>다음 거래일에 확인된 주요 일정이 없습니다 (수집된 데이터 기준).</Empty>}
      </section>
      <section>
        <H>데이터와 분석의 기준</H>
        <BasisBlock basis={b.basis} generatedAt={b.generatedAt} sessionLabel={b.sessionLabel} evidence={b.evidence} prefix={prefix} />
      </section>
    </article>
  );
}
