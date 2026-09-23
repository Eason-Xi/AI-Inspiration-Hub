import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { fail } from "@/lib/http";
import { imageExtension } from "@/lib/images";
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > 11 * 1024 * 1024)
      throw new Error("图片不能超过 10 MB");
    const form = await req.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0
    )
      throw new Error("请选择 10 MB 以内的图片");
    const b = Buffer.from(await file.arrayBuffer());
    const ext = imageExtension(b);
    if (!ext) throw new Error("仅支持 JPG、PNG、WEBP 或 GIF 图片");
    const name = crypto.randomUUID() + "." + ext;
    mkdirSync(path.join(dataDir, "uploads"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dataDir, "uploads", name), b, { mode: 0o600 });
    return Response.json({ url: "/api/files/" + name });
  } catch (e) {
    return fail(e);
  }
}
