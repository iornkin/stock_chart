"use client";
/**
 * 개인 데이터 저장소 (이 브라우저 안에만 저장, 서버로 보내지 않음)
 * - 기본: IndexedDB (용량이 크고 구조화된 데이터에 적합)
 * - IndexedDB 를 쓸 수 없으면 localStorage, 그것도 막혀 있으면 현재 탭 메모리 (새로고침하면 사라짐)
 * - 같은 브라우저의 다른 탭과는 BroadcastChannel 로 변경을 맞춘다
 */
import { useCallback, useEffect, useState } from "react";

export type LocalKey = "portfolio" | "strategies" | "runs";
export const LOCAL_KEYS: LocalKey[] = ["portfolio", "strategies", "runs"];
/** 없앤 기능의 옛 데이터 (가상 투자 계좌) — 이 브라우저에 남지 않게 지운다 */
const LEGACY_KEYS = ["virtual"];

const DB_NAME = "usi-local";
const STORE = "kv";
const LS_PREFIX = "usi-local:";

export type Backend = "indexeddb" | "localstorage" | "memory";

let backendPromise: Promise<Backend> | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, unknown>();
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();
let channel: BroadcastChannel | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB 열기 실패"));
      req.onblocked = () => reject(new Error("IndexedDB 가 다른 탭에서 사용 중입니다"));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

export function storageBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        if (typeof indexedDB !== "undefined") {
          await openDb();
          return "indexeddb" as const;
        }
      } catch {
        /* 사생활 보호 모드 등 */
      }
      try {
        localStorage.setItem(`${LS_PREFIX}__test`, "1");
        localStorage.removeItem(`${LS_PREFIX}__test`);
        return "localstorage" as const;
      } catch {
        return "memory" as const;
      }
    })();
    backendPromise.then(dropLegacy).catch(() => {});
  }
  return backendPromise;
}

function dropLegacy(b: Backend) {
  for (const k of LEGACY_KEYS) {
    if (b === "indexeddb") idbRequest("readwrite", (s) => s.delete(k)).catch(() => {});
    else if (b === "localstorage")
      try {
        localStorage.removeItem(LS_PREFIX + k);
      } catch {
        /* 무시 */
      }
  }
}

function idbRequest<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 오류"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 저장 취소됨 (용량 부족일 수 있음)"));
      }),
  );
}

export async function readLocal<T>(key: LocalKey): Promise<T | undefined> {
  if (cache.has(key)) return cache.get(key) as T;
  const b = await storageBackend();
  let v: T | undefined;
  if (b === "indexeddb") v = await idbRequest<T | undefined>("readonly", (s) => s.get(key));
  else if (b === "localstorage") {
    const raw = localStorage.getItem(LS_PREFIX + key);
    v = raw ? (JSON.parse(raw) as T) : undefined;
  } else v = memory.get(key) as T | undefined;
  if (v !== undefined) cache.set(key, v);
  return v;
}

export async function writeLocal<T>(key: LocalKey, value: T): Promise<void> {
  cache.set(key, value);
  notify(key);
  const b = await storageBackend();
  if (b === "indexeddb") await idbRequest("readwrite", (s) => s.put(value, key));
  else if (b === "localstorage") localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  else memory.set(key, value);
  channel?.postMessage({ key });
}

export async function clearLocal(): Promise<void> {
  const b = await storageBackend();
  cache.clear();
  memory.clear();
  if (b === "indexeddb") await idbRequest("readwrite", (s) => s.clear());
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
  } catch {
    /* 무시 */
  }
  for (const k of LOCAL_KEYS) notify(k);
  channel?.postMessage({ key: "*" });
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel("usi-local");
  channel.onmessage = (e: MessageEvent<{ key: string }>) => {
    const keys = e.data.key === "*" ? LOCAL_KEYS : [e.data.key];
    for (const k of keys) {
      cache.delete(k);
      notify(k);
    }
  };
}

/**
 * 저장된 값을 읽고 쓰는 훅. loaded 가 false 인 동안에는 저장소를 읽는 중이다.
 * set 은 즉시 화면에 반영하고 저장이 끝나면 resolve 한다.
 */
export function useLocal<T>(key: LocalKey, initial: T): { value: T; set: (v: T | ((prev: T) => T)) => Promise<void>; loaded: boolean; error: string | null } {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureChannel();
    let alive = true;
    const load = () =>
      readLocal<T>(key)
        .then((v) => {
          if (!alive) return;
          setValue(v === undefined ? initial : v);
          setLoaded(true);
        })
        .catch((e) => {
          if (!alive) return;
          setError(String((e as Error).message ?? e));
          setLoaded(true);
        });
    load();
    const l = () => load();
    let subs = listeners.get(key);
    if (!subs) listeners.set(key, (subs = new Set()));
    subs.add(l);
    return () => {
      alive = false;
      subs.delete(l);
    };
    // initial 은 첫 렌더링 값만 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    async (v: T | ((prev: T) => T)) => {
      const cur = (cache.has(key) ? cache.get(key) : value) as T;
      const next = typeof v === "function" ? (v as (p: T) => T)(cur) : v;
      setValue(next);
      try {
        await writeLocal(key, next);
        setError(null);
      } catch (e) {
        setError(`저장하지 못했습니다: ${String((e as Error).message ?? e)}`);
        throw e;
      }
    },
    [key, value],
  );

  return { value, set, loaded, error };
}

/** 브라우저에 '데이터를 지우지 말아 달라'고 요청 (지원하는 브라우저만) */
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageInfo(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}
