import WatchlistClient from "@/components/WatchlistClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "관심 종목" };

export default function WatchlistPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="관심 종목" description="자주 보는 종목을 모아 봅니다. 이 브라우저에만 저장됩니다." />
      <WatchlistClient />
    </div>
  );
}
