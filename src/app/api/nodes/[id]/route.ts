import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { after } from "next/server";
import { db, getNode, patchNode, deleteNode, transaction } from "@/lib/db";
import { nodePatch } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
import { enqueueAnalysis, getTask } from "@/lib/jobs";
import { wakeWorker } from "@/lib/worker";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorize(_req);
  if (denied) return denied;

  const { id } = await params;
  after(wakeWorker);
  const n = await getNode(id);
  return n
    ? Response.json({
        node: n,
        task: await getTask(id),
        children: (
          await db
            .prepare(
              "SELECT payload FROM nodes WHERE parentId=? ORDER BY createdAt",
            )
            .all(id)
        ).map((r) => JSON.parse(r.payload as string)),
        parent: n.parentId ? await getNode(n.parentId) : null,
      })
    : Response.json({ error: "记录不存在" }, { status: 404 });
}
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    const input = nodePatch.parse(await jsonBody(req));
    const current = await getNode(id);
    if (!current)
      return Response.json({ error: "记录不存在" }, { status: 404 });
    if (
      input.projectId &&
      !(await db
        .prepare("SELECT id FROM projects WHERE id=?")
        .get(input.projectId))
    )
      throw new Error("项目不存在");
    const changed = (["content", "title", "projectId"] as const).some(
      (key) => input[key] !== undefined && input[key] !== current[key],
    );
    const n = await transaction(async () => {
      await patchNode(id, {
        ...input,
        ...(changed
          ? { analysis: null, aiState: "idle" as const, completedActions: [] }
          : {}),
      });
      if (changed)
        await enqueueAnalysis(id, (await getTask(id))?.mode || "默认", true);
      return await getNode(id);
    });
    if (changed) after(wakeWorker);
    return Response.json(n);
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorize(_req);
  if (denied) return denied;

  await deleteNode((await params).id);
  return Response.json({ ok: true });
}
