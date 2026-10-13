import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-lg font-bold">페이지 또는 종목을 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-muted">이 사이트는 설정 파일에 등록된 미국 주식·ETF 만 지원합니다.</p>
      <Link href="/stocks" className="link mt-4 inline-block text-sm">지원 종목 목록 보기</Link>
    </div>
  );
}
