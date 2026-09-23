import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { getNode } from "@/lib/db";
import { linkImage } from "@/lib/links";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorize(_req);
  if (denied) return denied;

  const node = await getNode((await params).id);
  if (!node?.url || !node.linkImage) return new Response(null, { status: 404 });
  try {
    const image = await linkImage(node.linkImage);
    return new Response(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
