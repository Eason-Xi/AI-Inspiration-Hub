import { after } from "next/server";
import { db, getNode, patchNode, deleteNode } from "@/lib/db";
import { nodePatch } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
import { analyzeNode } from "@/lib/ai";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const n = getNode(id);
  return n
    ? Response.json({
        node: n,
        children: db
          .prepare(
            "SELECT payload FROM nodes WHERE parentId=? ORDER BY createdAt",
          )
          .all(id)
          .map((r) => JSON.parse(r.payload as string)),
        parent: n.parentId ? getNode(n.parentId) : null,
      })
    : Response.json({ error: "记录不存在" }, { status: 404 });
}
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = nodePatch.parse(await jsonBody(req));
    const current = getNode(id);
    if (!current)
      return Response.json({ error: "记录不存在" }, { status: 404 });
    if (
      input.projectId &&
      !db.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId)
    )
      throw new Error("项目不存在");
    const changed =
      input.content !== undefined && input.content !== current.content;
    const n = patchNode(id, {
      ...input,
      ...(changed
        ? { analysis: null, aiState: "idle" as const, completedActions: [] }
        : {}),
    });
    if (changed) after(() => analyzeNode(id));
    return Response.json(n);
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  deleteNode((await params).id);
  return Response.json({ ok: true });
}
