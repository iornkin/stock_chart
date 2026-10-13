import StressClient from "@/components/sim/StressClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "스트레스 테스트" };

export default function StressPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="스트레스 테스트" description="분배금이 줄거나 시장이 하락하면 포트폴리오가 얼마나 영향을 받는지 가정으로 계산합니다." />
      <StressClient />
    </div>
  );
}
