import { getProject, updateProject, deleteProject } from "@/lib/db";
import { projectInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!getProject(id))
      return Response.json({ error: "项目不存在" }, { status: 404 });
    return Response.json(
      updateProject(id, projectInput.parse(await jsonBody(req))),
    );
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!getProject(id))
      return Response.json({ error: "项目不存在" }, { status: 404 });
    return Response.json({ ok: true, movedNodes: deleteProject(id) });
  } catch (error) {
    return fail(error);
  }
}
