import { after } from "next/server";
import { z } from "zod";
import { getNode, patchNode } from "@/lib/db";
import { analyzeNode } from "@/lib/ai";
import { publicSettings } from "@/lib/settings";
import { fail, jsonBody } from "@/lib/http";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const n = getNode(id);
    if (!n) return Response.json({ error: "记录不存在" }, { status: 404 });
    if (!publicSettings().configured)
      return Response.json(
        { error: "请先在设置中连接 AI 模型" },
        { status: 409 },
      );
    if (
      n.aiState === "pending" &&
      Date.now() - Date.parse(n.updatedAt) < 100000
    )
      return Response.json({ error: "正在生成，请稍候" }, { status: 409 });
    const { mode } = z
      .object({
        mode: z.enum(["默认", "实用", "创意", "反向", "产品"]).default("默认"),
      })
      .parse(await jsonBody(req));
    patchNode(id, { aiState: "pending", aiError: null });
    after(() => analyzeNode(id, mode));
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
