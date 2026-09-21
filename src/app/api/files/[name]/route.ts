import { readFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(name))
    return new Response(null, { status: 404 });
  try {
    const body = readFileSync(path.join(dataDir, "uploads", name));
    const ext = path.extname(name).slice(1);
    return new Response(body, {
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
