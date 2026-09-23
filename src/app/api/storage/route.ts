import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { cloudStorage } from "@/lib/environment";
import { storageBucket, removeObject } from "@/lib/storage";
import { fail, jsonBody } from "@/lib/http";
import { z } from "zod";

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const { kind, size } = z
      .object({
        kind: z.enum(["image", "backup"]),
        size: z.number().int().positive(),
      })
      .parse(await jsonBody(request));
    const max = (kind === "image" ? 10 : 32) * 1024 * 1024;
    if (size > max)
      throw new Error(
        kind === "image" ? "图片不能超过 10 MB" : "备份不能超过 32 MB",
      );
    if (!cloudStorage()) return Response.json({ mode: "local" });
    const key = `temporary/${Date.now()}-${crypto.randomUUID()}.${kind}`;
    const { data, error } = await storageBucket().createSignedUploadUrl(key);
    if (error) throw new Error("无法准备云端上传，请检查私有存储桶配置");
    return Response.json({ mode: "supabase", key, signedUrl: data.signedUrl });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const { key } = z
      .object({
        key: z.string().regex(/^temporary\/\d+-[a-f0-9-]{36}\.(image|backup)$/),
      })
      .parse(await jsonBody(request));
    if (cloudStorage()) await removeObject(key);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
