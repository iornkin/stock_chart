import BacktestClient from "@/components/sim/BacktestClient";

export const metadata = { title: "백테스팅" };

export default function BacktestPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">과거 백테스팅</h1>
        <p className="mt-1 text-sm text-ink-2">직접 정한 시작일·종료일로 ETF 포트폴리오의 과거 성과를 실제 종가와 분배금 기록으로 검증합니다. 여러 포트폴리오와 벤치마크를 같은 조건으로 비교합니다. 계산은 이 브라우저 안에서 이루어집니다.</p>
      </div>
      <BacktestClient />
    </div>
  );
}
