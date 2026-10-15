"use client";
/** 주소의 #앵커가 접힌 <details> 안에 있으면 펼쳐서 보이게 한다 (근거 자료 링크 등) */
import { useEffect } from "react";

export default function HashOpener() {
  useEffect(() => {
    const open = () => {
      let id = window.location.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // 잘못된 % 인코딩이면 그대로 쓴다
      }
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") (p as HTMLDetailsElement).open = true;
      el.scrollIntoView({ block: "center" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
