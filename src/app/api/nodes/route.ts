import { after } from "next/server";
import { db, newNode, seed } from "@/lib/db";
import { nodeInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
import { enrichNode } from "@/lib/ai";
import { publicSettings } from "@/lib/settings";
export async function POST(req: Request) {
  try {
    seed();
    const input = nodeInput.parse(await jsonBody(req));
    if (
      input.projectId &&
      !db.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId)
    )
      throw new Error("项目不存在");
    const n = newNode({
      ...input,
      aiState: publicSettings().configured ? "pending" : "idle",
    });
    after(() => enrichNode(n.id));
    return Response.json(n, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
