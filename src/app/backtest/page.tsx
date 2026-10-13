import BacktestClient from "@/components/sim/BacktestClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "백테스팅" };

export default function BacktestPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="과거 백테스트" description="정한 기간의 실제 종가·분배금 기록으로 포트폴리오 성과를 검증합니다. 계산은 이 브라우저 안에서 합니다." />
      <BacktestClient />
    </div>
  );
}
