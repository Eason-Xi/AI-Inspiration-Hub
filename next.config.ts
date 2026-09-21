import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["node:sqlite"],
  experimental: { proxyClientMaxBodySize: "12mb" },
};
export default config;
