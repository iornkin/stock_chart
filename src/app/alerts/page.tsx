import AlertsClient from "@/components/AlertsClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "알림·확인함" };

export default function AlertsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="알림·확인함" description="지금 확인할 일(데이터 점검·투자 기록 재검토·목표 비중 이탈 등)과 알림 규칙을 한곳에서 봅니다. 규칙·기록·확인 상태는 이 브라우저에만 저장됩니다." />
      <AlertsClient />
    </div>
  );
}
