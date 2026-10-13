import PaperClient from "@/components/portfolio/PaperClient";

export const metadata = { title: "가상 투자" };

export default function PaperPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">가상 투자</h1>
        <p className="mt-1 text-sm text-ink-2">가상 초기 자금으로 사이트 안에서만 사고팔아 보는 모의 계좌입니다. 실제 보유 자산과 따로 저장·계산하며, 실제 증권 주문으로 이어지지 않습니다.</p>
      </div>
      <PaperClient />
    </div>
  );
}
