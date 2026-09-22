import { after } from "next/server";
import { z } from "zod";
import { getNode } from "@/lib/db";
import { enqueueAnalysis, cancelTask } from "@/lib/jobs";
import { wakeWorker } from "@/lib/worker";
import { modes } from "@/lib/validation";
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
    const { mode } = z
      .object({
        mode: z.enum(modes).default("默认"),
      })
      .parse(await jsonBody(req));
    const task = enqueueAnalysis(id, mode);
    after(wakeWorker);
    return Response.json({ ok: true, task }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getNode(id))
    return Response.json({ error: "记录不存在" }, { status: 404 });
  return Response.json({ task: cancelTask(id) });
}
