/**
 * 외부 데이터 제공처 호출 공통 계층
 * - 제공처별 최소 호출 간격(rate limit) 및 동시성 제한
 * - 타임아웃, 재시도(429/5xx/네트워크 오류), 호출 로그(provider_calls)
 * - API 키는 로그에 남기지 않는다.
 */
import { redactSecrets } from "./redact";
import { env } from "./env";
import { run, get } from "./db";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

interface LimiterState {
  last: number;
  queue: Promise<unknown>;
}
const limiters = new Map<string, LimiterState>();

/** 제공처별 최소 호출 간격(ms) */
const MIN_INTERVAL: Record<string, number> = {
  yahoo: 350,
  nasdaq: 600,
  sec: 150,
  polygon: 12500, // 무료 플랜 분당 5회
  finnhub: 1100, // 무료 플랜 분당 60회
  fred: 600,
  alphavantage: 1500,
  googlenews: 1200,
  anthropic: 0,
};

/** 테스트·프록시 환경에서 호출 간격을 조정 (기본 1) */
function rateScale(): number {
  const v = Number(process.env.RATE_LIMIT_SCALE ?? "1");
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

function schedule<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  let st = limiters.get(provider);
  if (!st) {
    st = { last: 0, queue: Promise.resolve() };
    limiters.set(provider, st);
  }
  const state = st;
  const p = state.queue.then(async () => {
    const wait = (MIN_INTERVAL[provider] ?? 300) * rateScale() - (Date.now() - state.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    state.last = Date.now();
    return fn();
  });
  state.queue = p.catch(() => undefined);
  return p;
}

function maskUrl(u: string): string {
  return u
    .replace(/(apiKey|apikey|api_key|token|crumb)=[^&]+/gi, "$1=***")
    .slice(0, 300);
}

export function logProviderCall(provider: string, endpoint: string, ok: boolean, status: number | null, error: string | null, ms: number) {
  try {
    run(
      "INSERT INTO provider_calls(provider, endpoint, ok, status, error, at, ms) VALUES(?,?,?,?,?,?,?)",
      provider,
      maskUrl(endpoint),
      ok ? 1 : 0,
      status,
      error ? redactSecrets(error).slice(0, 500) : null,
      Date.now(),
      ms,
    );
  } catch {
    // 로그 실패는 무시
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
  /** 응답 본문을 http_cache 에 저장할 캐시 키와 TTL */
  cacheKey?: string;
  cacheTtlMs?: number;
  redirect?: RequestRedirect;
  /** 정상으로 간주할 추가 HTTP 상태 (예: 쿠키 발급용 404) */
  acceptStatus?: number[];
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/**
 * 서킷 브레이커: 같은 제공처에서 네트워크 오류가 연속으로 발생하면 잠시 호출을 중단해
 * 장애 시 작업이 재시도 대기로 오래 멈추지 않게 한다.
 */
const circuit = new Map<string, { fails: number; openUntil: number }>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 2 * 60_000;

function circuitCheck(provider: string) {
  const c = circuit.get(provider);
  if (c && c.openUntil > Date.now()) {
    throw new ProviderError(provider, `연속 연결 실패로 ${Math.ceil((c.openUntil - Date.now()) / 1000)}초간 호출 중단`, undefined, true);
  }
}

function circuitResult(provider: string, networkFailure: boolean) {
  const c = circuit.get(provider) ?? { fails: 0, openUntil: 0 };
  if (!networkFailure) {
    c.fails = 0;
    c.openUntil = 0;
  } else {
    c.fails += 1;
    if (c.fails >= CIRCUIT_THRESHOLD) c.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
  circuit.set(provider, c);
}

export function resetCircuits() {
  circuit.clear();
}

export async function request(provider: string, url: string, opts: RequestOptions = {}): Promise<Response> {
  circuitCheck(provider);
  const retries = opts.retries ?? 2;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    const started = Date.now();
    try {
      const res = await schedule(provider, () =>
        fetch(url, {
          method: opts.method ?? "GET",
          headers: opts.headers,
          body: opts.body,
          redirect: opts.redirect ?? "follow",
          signal: AbortSignal.timeout(opts.timeoutMs ?? env.httpTimeoutMs),
        }),
      );
      const ms = Date.now() - started;
      circuitResult(provider, res.status >= 500);
      if (res.status === 429 || res.status >= 500) {
        logProviderCall(provider, url, false, res.status, `HTTP ${res.status}`, ms);
        lastErr = new ProviderError(provider, `HTTP ${res.status}`, res.status, true);
        attempt++;
        if (attempt <= retries) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      const okish = res.ok || (opts.acceptStatus ?? []).includes(res.status);
      logProviderCall(provider, url, okish, res.status, okish ? null : `HTTP ${res.status}`, ms);
      return res;
    } catch (e) {
      const ms = Date.now() - started;
      const msg = e instanceof Error ? e.message : String(e);
      logProviderCall(provider, url, false, null, msg, ms);
      lastErr = new ProviderError(provider, `네트워크 오류: ${msg}`, undefined, true);
      circuitResult(provider, true);
      attempt++;
      const c = circuit.get(provider);
      if (c && c.openUntil > Date.now()) break;
      if (attempt <= retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError(provider, String(lastErr));
}

function readCache(key: string): string | null {
  const row = get<{ body: string; expires_at: number }>("SELECT body, expires_at FROM http_cache WHERE key = ?", key);
  if (row && row.expires_at > Date.now()) return row.body;
  return null;
}

function writeCache(key: string, body: string, ttl: number) {
  const now = Date.now();
  run(
    "INSERT INTO http_cache(key, body, fetched_at, expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at",
    key,
    body,
    now,
    now + ttl,
  );
}

export async function requestText(provider: string, url: string, opts: RequestOptions = {}): Promise<string> {
  if (opts.cacheKey) {
    const hit = readCache(opts.cacheKey);
    if (hit !== null) return hit;
  }
  const res = await request(provider, url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(provider, `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, false);
  }
  if (opts.cacheKey && opts.cacheTtlMs) writeCache(opts.cacheKey, text, opts.cacheTtlMs);
  return text;
}

export async function requestJson<T = unknown>(provider: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const text = await requestText(provider, url, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, `JSON 파싱 실패: ${text.slice(0, 120)}`);
  }
}

/** 하루 호출 예산 (Alpha Vantage 무료 플랜 등) */
export function consumeBudget(provider: string, day: string, limit: number): boolean {
  const row = get<{ count: number }>("SELECT count FROM api_budget WHERE provider = ? AND day = ?", provider, day);
  const count = row?.count ?? 0;
  if (count >= limit) return false;
  run(
    "INSERT INTO api_budget(provider, day, count) VALUES(?,?,1) ON CONFLICT(provider, day) DO UPDATE SET count = count + 1",
    provider,
    day,
  );
  return true;
}
