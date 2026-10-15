import ReportClient from "@/components/ReportClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "투자 보고서" };

export default function ReportPage() {
  return (
    <div className="flex flex-col">
      <div className="no-print">
        <PageHeader title="내 투자 보고서" description="이 브라우저에 저장된 내 자산·거래 기록과 수집된 시세로 지금 상태를 한 장에 정리합니다. 실제 기록과 추정치를 나눠 표시하며, 미래 시뮬레이션 결과는 넣지 않습니다." />
      </div>
      <ReportClient />
    </div>
  );
}
