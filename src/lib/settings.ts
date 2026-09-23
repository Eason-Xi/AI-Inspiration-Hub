import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import path from "node:path";
import { db } from "./db";
import { dataDir, cloudStorage, requiredEnv } from "./environment";
const file = path.join(dataDir, "settings.json");
function key() {
  return createHash("sha256").update(requiredEnv("APP_SECRET")).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export async function credentials() {
  let saved: Partial<Credentials> = {};
  if (cloudStorage()) {
    const row = await db
      .prepare("SELECT value FROM meta WHERE key='ai_settings'")
      .get();
    if (row) saved = JSON.parse(decrypt(String(row.value)));
  } else if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8"));
  return {
    baseUrl:
      saved.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: saved.model || process.env.AI_MODEL || "gpt-4.1-mini",
    apiKey: saved.apiKey || process.env.AI_API_KEY || "",
  };
}
export async function publicSettings() {
  const c = await credentials();
  return {
    baseUrl: c.baseUrl,
    model: c.model,
    configured: !!c.apiKey,
    storage: cloudStorage() ? "supabase" : "local",
  };
}
export type Credentials = { baseUrl: string; model: string; apiKey: string };
export async function resolveSettings(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<Credentials> {
  const current = await credentials();
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
export async function setSettings(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const next = await resolveSettings(input);
  if (cloudStorage()) {
    await db
      .prepare(
        "INSERT INTO meta (key,value) VALUES ('ai_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(encrypt(JSON.stringify(next)));
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  return await publicSettings();
}
