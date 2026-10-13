import FutureClient from "@/components/sim/FutureClient";

export const metadata = { title: "미래 시뮬레이터" };

export default function SimulatePage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">미래 포트폴리오 시뮬레이터</h1>
        <p className="mt-1 text-sm text-ink-2">과거 백테스트와 별도로, 앞으로의 기간에 자산이 어떻게 변할 수 있는지 여러 가정으로 계산합니다. 결과는 시나리오 분석이며 예측이나 보장이 아닙니다.</p>
      </div>
      <FutureClient />
    </div>
  );
}
