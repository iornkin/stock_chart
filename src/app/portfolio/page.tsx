import PortfolioClient from "@/components/portfolio/PortfolioClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "내 자산" };

export default function PortfolioPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="내 자산" description="보유 자산을 직접 입력해 관리합니다. 가입·계좌 연결이 없고, 입력한 내용은 이 브라우저에만 저장됩니다." />
      <PortfolioClient />
    </div>
  );
}
