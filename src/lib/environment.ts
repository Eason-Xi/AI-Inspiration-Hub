import path from "node:path";

export const cloudStorage = () => process.env.STORAGE_BACKEND === "supabase";
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR || "./data",
);

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少服务器配置：${name}`);
  return value;
}

export function assertStorageConfiguration() {
  if (process.env.VERCEL && !cloudStorage())
    throw new Error(
      "Vercel 部署必须设置 STORAGE_BACKEND=supabase，不能使用本地文件存储",
    );
  if (cloudStorage()) {
    for (const name of [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "APP_SECRET",
    ])
      requiredEnv(name);
    if (requiredEnv("APP_SECRET").length < 32)
      throw new Error("APP_SECRET 至少需要 32 个字符");
  }
}
