"use client";
/** 현재 URL 의 쿼리 문자열을 부모에 알려 준다 (정적 페이지에서 ?date= 같은 값을 브라우저가 처리할 때 사용) */
import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

function Reader({ onChange }: { onChange: (p: URLSearchParams) => void }) {
  const sp = useSearchParams();
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);
  const key = sp.toString();
  useEffect(() => {
    cb.current(new URLSearchParams(key));
  }, [key]);
  return null;
}

export default function UrlParams({ onChange }: { onChange: (p: URLSearchParams) => void }) {
  return (
    <Suspense fallback={null}>
      <Reader onChange={onChange} />
    </Suspense>
  );
}
