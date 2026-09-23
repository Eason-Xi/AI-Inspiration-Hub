import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { after } from "next/server";
import { db, newNode, seed, transaction, getNode } from "@/lib/db";
import { nodeInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
import { enqueueAnalysis } from "@/lib/jobs";
import { wakeWorker } from "@/lib/worker";
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    await seed();
    const input = nodeInput.parse(await jsonBody(req));
    if (
      input.projectId &&
      !(await db
        .prepare("SELECT id FROM projects WHERE id=?")
        .get(input.projectId))
    )
      throw new Error("项目不存在");
    if (input.parentId && !(await getNode(input.parentId)))
      throw new Error("父节点不存在");
    const n = await transaction(async () => {
      const created = await newNode(input);
      await enqueueAnalysis(created.id);
      return (await getNode(created.id))!;
    });
    after(wakeWorker);
    return Response.json(n, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
