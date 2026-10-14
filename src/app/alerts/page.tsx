import AlertsClient from "@/components/AlertsClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "알림" };

export default function AlertsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="알림" description="배당·일정·총보수·편입 종목·목표 비중·가격·손익률 변화를 이 사이트가 열려 있는 동안 확인해 알려 줍니다. 규칙과 기록은 이 브라우저에만 저장됩니다." />
      <AlertsClient />
    </div>
  );
}
