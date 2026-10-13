/**
 * 오류 문구에 API 키·연락처 같은 비밀 값이 섞여 DB·화면·로그에 남지 않도록 가린다.
 * (예: 비밀 값을 잘못 넣어 HTTP 헤더 오류 메시지에 값이 그대로 포함되는 경우)
 */
import { env } from "./env";

function secretValues(): string[] {
  const raw = [env.finnhubKey, env.polygonKey, env.fredKey, env.alphaVantageKey, env.anthropicKey, env.secUserAgent, env.adminToken];
  const parts = raw.flatMap((v) => [v, ...v.split(/[\r\n]+/)]).map((v) => v.trim());
  // 긴 값부터 바꿔야 일부만 가려지는 일이 없다
  return [...new Set(parts.filter((v) => v.length >= 6))].sort((a, b) => b.length - a.length);
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const v of secretValues()) out = out.split(v).join("***");
  return out
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|AGENT))\s*=\s*\S+/g, "$1=***")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => (/@example\.(com|org)$/i.test(m) ? m : "***@***"));
}
