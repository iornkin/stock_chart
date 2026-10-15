import StressClient from "@/components/sim/StressClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "스트레스 테스트" };

export default function StressPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="스트레스 테스트" description="분배금이 줄거나 시장·섹터·금리가 나빠지면 포트폴리오가 얼마나 영향을 받는지 가정으로 계산하고, 내가 정한 최대 손실 기준과 비교합니다." />
      <StressClient />
    </div>
  );
}
