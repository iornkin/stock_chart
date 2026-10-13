import StrategiesClient from "@/components/sim/StrategiesClient";

export const metadata = { title: "전략 비교" };

export default function StrategiesPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">포트폴리오 전략 비교</h1>
        <p className="mt-1 text-sm text-ink-2">전략(종목·비중)을 만들어 저장하고, 백테스트·미래 시나리오·스트레스 테스트에 바로 불러와 씁니다. 전략은 이 브라우저에 저장되며 JSON 으로 내보내고 불러올 수 있습니다.</p>
      </div>
      <StrategiesClient />
    </div>
  );
}
