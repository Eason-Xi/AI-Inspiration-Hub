import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { readObject, removeObject, writeImage } from "@/lib/storage";
import { cloudStorage } from "@/lib/environment";
import { fail, jsonBody } from "@/lib/http";
import { imageExtension } from "@/lib/images";
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  let staged: string | undefined;
  try {
    let b: Buffer;
    if (cloudStorage()) {
      const { key } = await jsonBody(req);
      if (
        typeof key !== "string" ||
        !/^temporary\/\d+-[a-f0-9-]{36}\.image$/.test(key)
      )
        throw new Error("无效的上传凭据");
      staged = key;
      b = await readObject(key, 10 * 1024 * 1024);
    } else {
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
      b = Buffer.from(await file.arrayBuffer());
    }
    const ext = imageExtension(b);
    if (!ext) throw new Error("仅支持 JPG、PNG、WEBP 或 GIF 图片");
    const name = crypto.randomUUID() + "." + ext;
    await writeImage(name, b);
    return Response.json({ url: "/api/files/" + name });
  } catch (e) {
    return fail(e);
  } finally {
    if (staged) await removeObject(staged).catch(() => {});
  }
}
