import IncomeTargetClient from "@/components/sim/IncomeTargetClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "목표 배당 계산기" };

export default function IncomeTargetPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="목표 배당 계산기" description="매달 받고 싶은 금액을 넣으면, 최근 12개월 실제 지급 기준으로 필요한 투자금을 거꾸로 계산합니다." />
      <IncomeTargetClient />
    </div>
  );
}
