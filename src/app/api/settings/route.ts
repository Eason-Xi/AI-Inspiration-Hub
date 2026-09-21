import { z } from "zod";
import { setSettings } from "@/lib/settings";
import { fail, jsonBody } from "@/lib/http";
export async function PUT(req: Request) {
  try {
    const s = z
      .object({
        baseUrl: z
          .url()
          .refine(
            (x) =>
              new URL(x).protocol === "https:" ||
              ["localhost", "127.0.0.1"].includes(new URL(x).hostname),
            "远程模型服务须使用 HTTPS",
          ),
        model: z.string().trim().min(1).max(100),
        apiKey: z.string().max(1000).optional(),
      })
      .parse(await jsonBody(req));
    return Response.json(setSettings(s));
  } catch (e) {
    return fail(e);
  }
}
