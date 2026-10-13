"use client";
/** 홈 화면 설치(PWA): 서비스 워커 등록(운영 빌드에서만)과 설치 안내 */
import { useEffect, useSyncExternalStore } from "react";
import { BASE_PATH } from "@/lib/static-mode";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// 브라우저의 설치 제안 이벤트는 한 번만 오므로 화면 어디서든 쓸 수 있게 보관한다
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export default function PwaRegister() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      notify();
    };
    const onInstalled = () => {
      deferred = null;
      notify();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {
        /* 등록에 실패해도 사이트 사용에는 영향 없음 */
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

type Mode = "installed" | "prompt" | "ios" | "other" | null;

function mode(): Mode {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (deferred) return "prompt";
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}

/** 설치 버튼·안내 (설정 화면·모바일 메뉴) */
export function InstallApp({ compact = false }: { compact?: boolean }) {
  const m = useSyncExternalStore(subscribe, mode, () => null);
  if (m === null) return null;
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    notify();
  };
  if (compact) {
    if (m !== "prompt") return null;
    return (
      <button type="button" className="btn btn-sm w-full" onClick={install}>
        홈 화면에 앱으로 추가
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-2">
      {m === "installed" && <p>지금 홈 화면 앱으로 실행 중입니다.</p>}
      {m === "prompt" && (
        <div>
          <button type="button" className="btn btn-primary" onClick={install}>
            홈 화면에 앱으로 추가
          </button>
        </div>
      )}
      {m === "ios" && <p>Safari 아래쪽의 공유 버튼(네모에 위쪽 화살표)을 누른 뒤 &lsquo;홈 화면에 추가&rsquo;를 고르세요.</p>}
      {m === "other" && <p>브라우저 메뉴(⋮ 또는 주소창 오른쪽)에서 &lsquo;앱 설치&rsquo; 또는 &lsquo;홈 화면에 추가&rsquo;를 고르세요. 브라우저에 따라 지원하지 않을 수 있습니다.</p>}
      <p className="text-xs text-muted">설치해도 개인 데이터는 지금처럼 이 기기의 브라우저에만 저장됩니다. 시세·분배금은 오래된 값을 보여 주지 않도록 저장해 두지 않으므로, 인터넷이 끊기면 &lsquo;연결 안 됨&rsquo; 안내만 나옵니다.</p>
    </div>
  );
}
