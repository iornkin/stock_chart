import WatchlistClient from "@/components/WatchlistClient";

export const metadata = { title: "관심 종목" };

export default function WatchlistPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">관심 종목</h1>
        <p className="text-sm text-muted">자주 확인하는 종목을 모아 봅니다. 관심 종목은 이 브라우저에만 저장됩니다(로그인 없음).</p>
      </div>
      <WatchlistClient />
    </div>
  );
}
