import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@anthropic-ai/sdk"],
  async redirects() {
    // SPLG 는 2025-10-31 SPYM 으로 티커가 변경됨 (State Street 공지)
    return [{ source: "/stock/SPLG", destination: "/stock/SPYM", permanent: false }];
  },
};

export default nextConfig;
