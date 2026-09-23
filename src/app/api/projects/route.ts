import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { createProject, seed, updateProject } from "@/lib/db";
import { projectInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    await seed();
    const p = projectInput.parse(await jsonBody(req));
    const created = await createProject(p.name, p.description, p.color);
    return Response.json(await updateProject(created.id, p), {
      status: 201,
    });
  } catch (e) {
    return fail(e);
  }
}
