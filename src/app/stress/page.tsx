import StressClient from "@/components/sim/StressClient";

export const metadata = { title: "스트레스 테스트" };

export default function StressPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">스트레스 테스트</h1>
        <p className="mt-1 text-sm text-ink-2">분배금이 줄거나 시장이 하락할 때 포트폴리오가 얼마나 영향을 받는지 계산합니다. 백테스트·미래 시뮬레이션과는 별도의 가정 분석입니다.</p>
      </div>
      <StressClient />
    </div>
  );
}
