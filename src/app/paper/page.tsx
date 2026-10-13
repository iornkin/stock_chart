import PaperClient from "@/components/portfolio/PaperClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "가상 투자" };

export default function PaperPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="가상 투자" description="가상 자금으로 사고팔아 보는 모의 계좌입니다. 실제 보유 자산과 따로 계산하며 실제 주문으로 이어지지 않습니다." />
      <PaperClient />
    </div>
  );
}
