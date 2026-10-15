import StrategyClient from "@/components/sim/StrategyClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "지표 전략 검증" };

export default function StrategyPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="지표 전략 검증" description="이동평균·RSI·MACD·볼린저 등 기술적 지표 규칙을 한 종목의 과거 일봉에 적용해 봅니다. 신호는 종가 확정 뒤 다음 봉에 체결하고, 비용·학습/평가 구간·파라미터 민감도·워크포워드로 과최적화를 점검합니다." />
      <StrategyClient />
    </div>
  );
}
