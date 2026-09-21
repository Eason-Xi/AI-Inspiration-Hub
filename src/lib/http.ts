import { ZodError } from "zod";
export function fail(e: unknown) {
  if (e instanceof ZodError)
    return Response.json(
      { error: e.issues[0]?.message || "输入格式不正确" },
      { status: 400 },
    );
  return Response.json(
    { error: e instanceof Error ? e.message : "操作失败，请重试" },
    { status: 400 },
  );
}
export async function jsonBody(req: Request) {
  const raw = await req.text();
  if (raw.length > 100000) throw new Error("内容过长");
  return JSON.parse(raw);
}
