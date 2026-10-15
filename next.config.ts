import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 이면 GitHub Pages 같은 정적 호스팅용으로 빌드한다.
 * - 빌드 시점의 DB 내용으로 모든 페이지를 미리 만들고(out/), API 라우트(route.ts)는 제외한다.
 * - 화면에서 쓰는 추가 데이터(차트·비교·브리핑 기록)는 scripts/export-static.ts 가 out/data 에 JSON 으로 쓴다.
 * - BASE_PATH: 저장소 이름 경로(예: /stock_chart). GitHub Actions 의 configure-pages 가 알려 준다.
 */
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = isStatic ? (process.env.BASE_PATH ?? "").replace(/\/+$/, "") : "";
const repo = process.env.GITHUB_REPOSITORY ?? "";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@anthropic-ai/sdk"],
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStatic ? "1" : "",
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_REPO_URL: isStatic && repo ? `https://github.com/${repo}` : "",
  },
  ...(isStatic
    ? {
        output: "export" as const,
        basePath: basePath || undefined,
        trailingSlash: true,
        images: { unoptimized: true },
        // route.ts(API)는 서버가 필요하므로 정적 빌드에서는 라우트로 인식하지 않는다
        pageExtensions: ["tsx"],
      }
    : {
        // 서버 모드 보안 헤더 (정적 호스팅(GitHub Pages)은 헤더를 정할 수 없어 적용되지 않음)
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                { key: "X-Frame-Options", value: "SAMEORIGIN" },
                { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
              ],
            },
          ];
        },
        async redirects() {
          // SPLG 는 2025-10-31 SPYM 으로 티커가 변경됨 (State Street 공지)
          return [{ source: "/stock/SPLG", destination: "/stock/SPYM", permanent: false }];
        },
      }),
};

export default nextConfig;
