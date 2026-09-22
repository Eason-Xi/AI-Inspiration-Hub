import { settingsInput } from "@/lib/validation";
import { setSettings } from "@/lib/settings";
import { fail, jsonBody } from "@/lib/http";
export async function PUT(req: Request) {
  try {
    const s = settingsInput.parse(await jsonBody(req));
    return Response.json(setSettings(s));
  } catch (e) {
    return fail(e);
  }
}
