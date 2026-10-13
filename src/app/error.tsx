"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-lg font-bold">페이지를 표시하는 중 오류가 발생했습니다</h1>
      <p className="mt-2 break-all text-sm text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm">
        다시 시도
      </button>
    </div>
  );
}
