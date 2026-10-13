"use client";
/**
 * 개인 데이터 내보내기·불러오기·암호화 백업·초기화 (모두 브라우저 안에서 처리, 서버 전송 없음)
 *
 * 암호화 백업
 * - 비밀번호 → PBKDF2(SHA-256, 60만 회, 무작위 솔트) → AES-GCM 256비트 키
 * - 비밀번호와 키는 어디에도 저장하지 않는다. 비밀번호를 잊으면 백업 파일을 복구할 수 없다.
 */
import { clearLocal, LOCAL_KEYS, readLocal, writeLocal, type LocalKey } from "./local-store";

export const BUNDLE_FORMAT = "usi-userdata";
export const ENCRYPTED_FORMAT = "usi-userdata-encrypted";
const PBKDF2_ITERATIONS = 600_000;

export interface UserBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  exportedAt: string;
  data: Partial<Record<LocalKey, unknown>>;
  /** 화면 설정·관심 종목·계산기 입력 등 localStorage 값 (usi- 로 시작하는 키) */
  browser: Record<string, string>;
}

export interface EncryptedBackup {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
}

function browserKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("usi-") && !k.startsWith("usi-local:")) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch {
    /* 접근 불가 */
  }
  return out;
}

export async function collectBundle(): Promise<UserBundle> {
  const data: UserBundle["data"] = {};
  for (const k of LOCAL_KEYS) {
    const v = await readLocal(k);
    if (v !== undefined) data[k] = v;
  }
  return { format: BUNDLE_FORMAT, version: 1, exportedAt: new Date().toISOString(), data, browser: browserKeys() };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** 불러온 파일 형식 확인 — 모르는 형식이나 깨진 구조는 적용하지 않는다 */
export function validateBundle(x: unknown): { ok: true; bundle: UserBundle; summary: string[] } | { ok: false; error: string } {
  if (!isObj(x)) return { ok: false, error: "JSON 객체가 아닙니다." };
  if (x.format === ENCRYPTED_FORMAT) return { ok: false, error: "암호화된 백업 파일입니다. '암호화 백업 복원'에서 비밀번호와 함께 불러오세요." };
  if (x.format !== BUNDLE_FORMAT) return { ok: false, error: "이 사이트에서 내보낸 데이터 파일이 아닙니다." };
  if (x.version !== 1) return { ok: false, error: `지원하지 않는 파일 버전입니다 (${String(x.version)}).` };
  if (!isObj(x.data)) return { ok: false, error: "data 항목이 없습니다." };
  const d = x.data;
  const summary: string[] = [];
  if (d.portfolio !== undefined) {
    const p = d.portfolio;
    if (!isObj(p) || (p.mode !== "simple" && p.mode !== "ledger") || !isObj(p.simple) || !Array.isArray((p.simple as Record<string, unknown>).holdings) || !Array.isArray(p.ledger))
      return { ok: false, error: "내 자산 데이터 형식이 올바르지 않습니다." };
    summary.push(`내 자산: ${p.mode === "ledger" ? `거래 ${(p.ledger as unknown[]).length}건` : `보유 종목 ${((p.simple as Record<string, unknown>).holdings as unknown[]).length}개`}`);
  }
  if (d.virtual !== undefined) {
    if (!isObj(d.virtual) || !Array.isArray(d.virtual.trades) || typeof d.virtual.initialCash !== "number") return { ok: false, error: "가상 투자 데이터 형식이 올바르지 않습니다." };
    summary.push(`가상 투자: 거래 ${d.virtual.trades.length}건`);
  }
  if (d.strategies !== undefined) {
    if (!Array.isArray(d.strategies) || d.strategies.some((s) => !isObj(s) || typeof s.name !== "string" || !Array.isArray(s.items))) return { ok: false, error: "전략 데이터 형식이 올바르지 않습니다." };
    summary.push(`전략: ${d.strategies.length}개`);
  }
  if (d.runs !== undefined && !Array.isArray(d.runs)) return { ok: false, error: "최근 계산 결과 형식이 올바르지 않습니다." };
  const browser = isObj(x.browser) ? Object.fromEntries(Object.entries(x.browser).filter(([k, v]) => k.startsWith("usi-") && typeof v === "string")) : {};
  if (Object.keys(browser).length) summary.push(`화면 설정·관심 종목 등 ${Object.keys(browser).length}개 항목`);
  return { ok: true, bundle: { format: BUNDLE_FORMAT, version: 1, exportedAt: String(x.exportedAt ?? ""), data: d as UserBundle["data"], browser: browser as Record<string, string> }, summary };
}

/** 현재 데이터를 모두 지우고 파일 내용으로 바꾼다 */
export async function restoreBundle(b: UserBundle): Promise<void> {
  await clearLocal();
  for (const k of LOCAL_KEYS) if (b.data[k] !== undefined) await writeLocal(k, b.data[k]);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("usi-") && !k.startsWith("usi-local:")) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(b.browser)) localStorage.setItem(k, v);
  } catch {
    /* 접근 불가 */
  }
}

/** 모든 개인 데이터 초기화 (IndexedDB + usi- 로 시작하는 localStorage) */
export async function resetAll(): Promise<void> {
  await clearLocal();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("usi-")) localStorage.removeItem(k);
  } catch {
    /* 접근 불가 */
  }
  try {
    indexedDB.deleteDatabase("usi-local");
  } catch {
    /* 무시 */
  }
}

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "비밀번호는 8자 이상으로 정하세요.";
  return null;
}

export async function encryptBundle(b: UserBundle, password: string): Promise<EncryptedBackup> {
  const p = passwordProblem(password);
  if (p) throw new Error(p);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(b))));
  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    data: b64(ct),
  };
}

export async function decryptBackup(x: unknown, password: string): Promise<unknown> {
  if (!isObj(x) || x.format !== ENCRYPTED_FORMAT || !isObj(x.kdf) || !isObj(x.cipher) || typeof x.data !== "string") throw new Error("이 사이트의 암호화 백업 파일이 아닙니다.");
  const iterations = Number(x.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 10_000_000) throw new Error("백업 파일의 암호화 설정이 올바르지 않습니다.");
  try {
    const key = await deriveKey(password, unb64(String(x.kdf.salt)), iterations);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(String(x.cipher.iv)) as BufferSource }, key, unb64(x.data) as BufferSource);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error("비밀번호가 맞지 않거나 파일이 손상되었습니다.");
  }
}

export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > 20 * 1024 * 1024) throw new Error("파일이 너무 큽니다 (20MB 초과).");
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽지 못했습니다.");
  }
}

