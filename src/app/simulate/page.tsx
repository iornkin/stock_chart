import FutureClient from "@/components/sim/FutureClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "미래 시뮬레이터" };

export default function SimulatePage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="미래 시뮬레이터" description="앞으로 자산이 어떻게 변할 수 있는지 여러 가정으로 계산합니다. 예측이 아니라 시나리오입니다." />
      <FutureClient />
    </div>
  );
}
