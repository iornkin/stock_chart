"use client";
/** 대시보드의 개인 영역 — 브라우저에 저장된 내 자산·전략·최근 계산 결과 (입력 전에는 금액을 표시하지 않음) */
import Link from "next/link";
import { usePortfolio, useRuns, useStrategies, useVirtual, useFx } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { Section } from "@/components/ui";
import { KV, Money, pct, tone, usd } from "@/components/sim/common";

export default function MyDashboard() {
  const p = usePortfolio();
  const s = usePortfolioSummary(p.value);
  const strategies = useStrategies();
  const runs = useRuns();
  const virtual = useVirtual();
  const fx = useFx();
  if (!p.loaded) return <div className="skeleton h-32" aria-label="내 투자 현황을 불러오는 중" />;
  const ledger = s.mode === "ledger";
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Section title="내 투자 현황" description="이 브라우저에 저장된 내 자산 기준" right={<Link href="/portfolio" className="text-xs link">{s.empty ? "자산 입력하기" : "자세히"}</Link>}>
        {s.empty ? (
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-sm text-ink-2">
            아직 입력한 자산이 없어 총자산·손익·분배금을 표시하지 않습니다.{" "}
            <Link href="/portfolio" className="link">
              내 자산
            </Link>
            에서 보유 종목을 입력하세요. 회원가입 없이 이 브라우저에만 저장됩니다.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <KV label="총자산" value={<Money v={s.missingPrices.length ? null : s.totalAssets} fx={fx.rate} />} sub={s.missingPrices.length ? `${s.missingPrices.join(", ")} 시세 없음` : `현금 ${usd(s.cash, 0)} 포함`} />
              <KV
                label={ledger ? "투자 손익 (총수익률)" : "미실현 손익"}
                value={<Money v={ledger ? s.totalPnl : s.missingPrices.length ? null : s.unrealized} fx={fx.rate} signed />}
                valueClass={tone(ledger ? s.totalPnl : s.unrealized)}
                sub={pct(s.totalReturnPct)}
              />
              <KV label="최근 12개월 실제 분배금" value={ledger ? usd(s.dividendsActualTtm) : "기록 없음"} sub={ledger ? "입력한 수령 기록 (세전)" : "거래 내역 모드에서 기록"} />
              <KV label="예상 연간 분배금" value={usd(s.expectedAnnual, 0)} sub="보유 수량 × 최근 12개월 실제 주당 지급액 (추정)" />
            </div>
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-ink-2">이번 달 분배금 일정 (확인된 기록)</p>
              {s.thisMonth.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {s.thisMonth.slice(0, 6).map((u) => (
                    <li key={u.symbol + u.ex} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <span className="font-semibold">{u.symbol}</span> <span className="num text-xs text-muted">지급 {u.pay ?? "미제공"} · 배당락 {u.ex}</span>
                      </span>
                      <span className="num">
                        {usd(u.amount)} <span className="text-[11px] text-muted">{u.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">이번 달에 확인된 지급 일정이 없습니다.</p>
              )}
            </div>
          </>
        )}
      </Section>
      <div className="flex flex-col gap-5">
        <Section title="저장한 전략" right={<Link href="/strategies" className="text-xs link">전략 비교</Link>}>
          {strategies.value.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {strategies.value.slice(0, 5).map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{x.name}</span>
                  <Link href={`/backtest?strategy=${x.id}`} className="shrink-0 text-xs link">
                    백테스트
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              저장한 전략이 없습니다. <Link href="/strategies" className="link">전략 만들기</Link>
            </p>
          )}
          {virtual.value && (
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-2">
              가상 투자 계좌: 초기 {usd(virtual.value.initialCash, 0)} · 거래 {virtual.value.trades.length}건{" "}
              <Link href="/paper" className="link">
                보기
              </Link>
            </p>
          )}
        </Section>
        <Section title="최근 백테스트·시뮬레이션 결과" right={<Link href="/strategies" className="text-xs link">모두 보기</Link>}>
          {runs.value.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {runs.value.slice(0, 3).map((r) => (
                <li key={r.id} className="rounded-lg bg-surface-2 px-3 py-2">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="text-xs text-ink-2">{r.summary.slice(0, 3).map((x) => `${x.label} ${x.value}`).join(" · ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              저장한 결과가 없습니다. <Link href="/backtest" className="link">백테스트</Link>나 <Link href="/simulate" className="link">미래 시뮬레이터</Link>에서 &apos;결과 저장&apos;을 누르면 여기에 표시됩니다.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
