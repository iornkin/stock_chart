import StrategiesClient from "@/components/sim/StrategiesClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "전략 비교" };

export default function StrategiesPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="전략 비교" description="종목·비중 조합을 저장해 두고 백테스트·시뮬레이터·스트레스 테스트에서 불러옵니다." />
      <StrategiesClient />
    </div>
  );
}
