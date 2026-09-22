import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.NEXT_TEST_BUILD === "1" ? ".next-test" : ".next",
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["node:sqlite"],
  experimental: { proxyClientMaxBodySize: "12mb" },
};
export default config;
