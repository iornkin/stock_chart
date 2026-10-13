"use client";
/** 기사 대표 이미지 (제공처가 준 주소만 사용). 없거나 불러오지 못하면 출처 머리글자 타일로 대신한다 */
import { useState } from "react";

export default function NewsThumb({ src, label, className = "" }: { src?: string | null; label?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (label ?? "뉴스").trim().slice(0, 1).toUpperCase() || "N";
  if (!src || failed) {
    return (
      <div aria-hidden className={`flex shrink-0 items-center justify-center rounded-lg bg-surface-3 text-lg font-bold text-muted ${className}`}>
        {initial}
      </div>
    );
  }
  return (
    // 외부 기사 이미지라 next/image 최적화 대신 원본 주소를 그대로 사용 (정적 사이트 호환)
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg bg-surface-3 object-cover ${className}`}
    />
  );
}
