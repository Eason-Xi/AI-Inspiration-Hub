import { createProject, seed, updateProject } from "@/lib/db";
import { projectInput } from "@/lib/validation";
import { fail, jsonBody } from "@/lib/http";
export async function POST(req: Request) {
  try {
    seed();
    const p = projectInput.parse(await jsonBody(req));
    const created = createProject(p.name, p.description, p.color);
    return Response.json(updateProject(created.id, p), {
      status: 201,
    });
  } catch (e) {
    return fail(e);
  }
}
