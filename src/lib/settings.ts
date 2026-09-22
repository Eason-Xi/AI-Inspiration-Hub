import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./db";
const file = path.join(dataDir, "settings.json");
export function credentials() {
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return {
    baseUrl:
      saved.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: saved.model || process.env.AI_MODEL || "gpt-4.1-mini",
    apiKey: saved.apiKey || process.env.AI_API_KEY || "",
  };
}
export function publicSettings() {
  const c = credentials();
  return { baseUrl: c.baseUrl, model: c.model, configured: !!c.apiKey };
}
export type Credentials = ReturnType<typeof credentials>;
export function resolveSettings(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Credentials {
  const current = credentials();
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  if (
    current.apiKey &&
    baseUrl !== current.baseUrl.replace(/\/+$/, "") &&
    !input.apiKey
  ) {
    throw new Error("更换 API 地址时，请重新填写对应的 API Key");
  }
  return {
    baseUrl,
    model: input.model,
    apiKey: input.apiKey || current.apiKey,
  };
}
export function setSettings(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const next = resolveSettings(input);
  writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return publicSettings();
}
