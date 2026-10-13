import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { MARKET_SYMBOLS } from "@/config/instruments";
import { isSupported, normalizeSymbol } from "./instruments";

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

export function errorJson(status: number, message: string) {
  return json({ error: message }, { status });
}

/** 지원 종목 + 시장 지표 심볼만 허용 */
export function allowedSymbol(raw: string): string | null {
  const s = normalizeSymbol(raw);
  if (isSupported(s)) return s;
  if (MARKET_SYMBOLS.some((m) => m.symbol === s)) return s;
  return null;
}

export function checkAdmin(req: Request): Response | null {
  if (!env.adminToken) return errorJson(403, "ADMIN_TOKEN 이 설정되지 않아 관리자 기능을 사용할 수 없습니다");
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(env.adminToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return errorJson(401, "관리자 토큰이 올바르지 않습니다");
  return null;
}
