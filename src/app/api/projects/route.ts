import { z } from "zod";
import { createProject, seed } from "@/lib/db";
import { fail, jsonBody } from "@/lib/http";
export async function POST(req: Request) {
  try {
    seed();
    const p = z
      .object({
        name: z.string().trim().min(1, "请输入项目名称").max(60),
        description: z.string().max(500).default(""),
        color: z
          .string()
          .regex(/^#[a-f0-9]{6}$/i)
          .default("#8b5cf6"),
      })
      .parse(await jsonBody(req));
    return Response.json(createProject(p.name, p.description, p.color), {
      status: 201,
    });
  } catch (e) {
    return fail(e);
  }
}
