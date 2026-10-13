"use client";
/** 대시보드의 '내 투자' 카드 — 브라우저에 저장된 내 자산·전략·최근 결과 (입력 전에는 금액을 표시하지 않음) */
import Link from "next/link";
import { usePortfolio, useRuns, useStrategies, useFx } from "@/lib/client/user-data";
import { usePortfolioSummary } from "@/lib/client/portfolio-summary";
import { Section } from "@/components/ui";
import { KV, Money, pct, tone, usd } from "@/components/sim/common";

export default function MyDashboard() {
  const p = usePortfolio();
  const s = usePortfolioSummary(p.value);
  const strategies = useStrategies();
  const runs = useRuns();
  const fx = useFx();
  if (!p.loaded) return <div className="skeleton h-40" aria-label="내 투자 현황을 불러오는 중" />;
  const ledger = s.mode === "ledger";
  const footer = (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
      <Link href="/strategies" className="hover:text-accent">
        저장한 전략 {strategies.value.length}개
      </Link>
      <Link href="/strategies" className="hover:text-accent">
        최근 계산 결과 {runs.value.length}개
      </Link>
    </p>
  );
  return (
    <Section title="내 투자" right={<Link href="/portfolio" className="text-xs link">{s.empty ? "입력하기" : "자세히"}</Link>}>
      {s.empty ? (
        <div className="flex flex-col gap-3 text-sm text-ink-2">
          <p>보유 종목을 입력하면 총자산·손익·예상 분배금을 여기에 보여 줍니다. 입력 전에는 금액을 표시하지 않습니다.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/portfolio" className="btn btn-sm btn-primary">
              내 자산 입력
            </Link>
            <Link href="/strategies" className="btn btn-sm">
              전략 만들기
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <KV label="총자산" value={<Money v={s.missingPrices.length ? null : s.totalAssets} fx={fx.rate} />} sub={s.missingPrices.length ? `${s.missingPrices.join(", ")} 시세 없음` : undefined} />
            <KV
              label={ledger ? "총수익률 (달러 기준)" : "평가 수익률 (달러 기준)"}
              value={pct(s.totalReturnPct)}
              valueClass={tone(s.totalReturnPct)}
              sub={<Money v={ledger ? s.totalPnl : s.missingPrices.length ? null : s.unrealized} fx={fx.rate} signed />}
            />
            <KV label="최근 12개월 실제 분배금" value={ledger ? usd(s.dividendsActualTtm) : "기록 없음"} />
            <KV label="예상 연간 분배금" value={usd(s.expectedAnnual, 0)} sub="추정 · 확정 아님" />
          </div>
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-ink-2">이번 달 분배금 일정</p>
            {s.thisMonth.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {s.thisMonth.slice(0, 4).map((u) => (
                  <li key={u.symbol + u.ex} className="flex items-baseline justify-between gap-2">
                    <span>
                      <span className="font-semibold">{u.symbol}</span> <span className="num text-xs text-muted">지급 {u.pay ? u.pay.slice(5).replace("-", "/") : "미제공"}</span>
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
      {footer}
    </Section>
  );
}
