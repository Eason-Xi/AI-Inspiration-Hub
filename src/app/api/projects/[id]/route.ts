import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { getProject, updateProject, deleteProject } from "@/lib/db";
import { projectInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Context) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!(await getProject(id)))
      return Response.json({ error: "项目不存在" }, { status: 404 });
    return Response.json(
      await updateProject(id, projectInput.parse(await jsonBody(req))),
    );
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(_req: Request, { params }: Context) {
  const denied = authorize(_req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!(await getProject(id)))
      return Response.json({ error: "项目不存在" }, { status: 404 });
    return Response.json({ ok: true, movedNodes: await deleteProject(id) });
  } catch (error) {
    return fail(error);
  }
}
