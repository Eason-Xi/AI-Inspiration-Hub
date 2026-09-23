import { authorize } from "@/lib/access";
export const maxDuration = 300;
import path from "node:path";
import { readImage, signedDownload, imageName } from "@/lib/storage";
import { cloudStorage } from "@/lib/environment";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const denied = authorize(_req);
  if (denied) return denied;

  const { name } = await params;
  if (!imageName.test(name)) return new Response(null, { status: 404 });
  try {
    if (cloudStorage())
      return new Response(null, {
        status: 302,
        headers: {
          Location: await signedDownload("images/" + name),
          "Cache-Control": "private, no-store",
        },
      });
    const body = await readImage(name);
    const ext = path.extname(name).slice(1);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/" + (ext === "jpg" ? "jpeg" : ext),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
