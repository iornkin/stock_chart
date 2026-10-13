"use client";
import { useEffect } from "react";
import { applyDocumentPrefs, usePrefs } from "@/lib/client/prefs";

/** 저장된 테마·색상 설정을 문서에 반영 (탭 간 동기화 포함) */
export default function PrefsApplier() {
  const [prefs] = usePrefs();
  useEffect(() => applyDocumentPrefs(prefs), [prefs]);
  return null;
}
