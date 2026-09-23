import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { cloudStorage, dataDir, requiredEnv } from "./environment";

export const imageName = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
export const bucketName = () =>
  process.env.SUPABASE_STORAGE_BUCKET || "inspiration-hub";
export function storageBucket() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  ).storage.from(bucketName());
}
function validateName(name: string) {
  if (!imageName.test(name)) throw new Error("无效图片路径");
}
export async function readObject(
  key: string,
  maxBytes: number,
): Promise<Buffer> {
  const { data, error } = await storageBucket().download(key);
  if (error || !data) throw new Error("云端文件不存在或无法读取");
  if (data.size > maxBytes) throw new Error("文件超出大小限制");
  return Buffer.from(await data.arrayBuffer());
}
export async function writeObject(
  key: string,
  bytes: Buffer,
  contentType: string,
) {
  const { error } = await storageBucket().upload(key, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error("云端文件保存失败，请检查私有存储桶配置");
}
export async function removeObject(key: string) {
  const { error } = await storageBucket().remove([key]);
  if (error) throw new Error("云端临时文件清理失败");
}
export async function signedDownload(key: string, download?: string) {
  const { data, error } = await storageBucket().createSignedUrl(key, 60, {
    download,
  });
  if (error) throw new Error("无法生成下载地址");
  return data.signedUrl;
}
export async function readImage(name: string) {
  validateName(name);
  return cloudStorage()
    ? readObject("images/" + name, 10 * 1024 * 1024)
    : readFile(path.join(dataDir, "uploads", name));
}
export async function writeImage(name: string, bytes: Buffer) {
  validateName(name);
  if (cloudStorage()) {
    const ext = name.split(".").pop();
    await writeObject(
      "images/" + name,
      bytes,
      "image/" + (ext === "jpg" ? "jpeg" : ext),
    );
  } else {
    await mkdir(path.join(dataDir, "uploads"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path.join(dataDir, "uploads", name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
}
export async function removeImage(name: string) {
  validateName(name);
  if (cloudStorage()) await removeObject("images/" + name);
  else await unlink(path.join(dataDir, "uploads", name));
}

export async function cleanupTemporaryFiles() {
  if (!cloudStorage()) return;
  const bucket = storageBucket();
  const { data, error } = await bucket.list("temporary", {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error) throw new Error("无法检查临时文件");
  const expired = data.filter(
    (file) =>
      /^\d+-[a-f0-9-]{36}\.(image|backup|export)$/.test(file.name) &&
      Number(file.name.split("-")[0]) < Date.now() - 24 * 3600_000,
  );
  if (expired.length) {
    const { error } = await bucket.remove(
      expired.map((file) => "temporary/" + file.name),
    );
    if (error) throw new Error("无法清理临时文件");
  }
}
