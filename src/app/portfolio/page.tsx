import PortfolioClient from "@/components/portfolio/PortfolioClient";

export const metadata = { title: "내 자산" };

export default function PortfolioPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">내 자산</h1>
        <p className="mt-1 text-sm text-ink-2">회원가입·계좌 연결 없이 보유 자산을 직접 입력해 관리합니다. 이름·이메일·계좌번호는 묻지 않으며, 입력한 내용은 이 브라우저에만 저장됩니다.</p>
      </div>
      <PortfolioClient />
    </div>
  );
}
