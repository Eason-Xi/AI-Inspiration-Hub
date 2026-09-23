import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { settingsInput } from "@/lib/validation";
import { setSettings } from "@/lib/settings";
import { fail, jsonBody } from "@/lib/http";
export async function PUT(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    const s = settingsInput.parse(await jsonBody(req));
    return Response.json(await setSettings(s));
  } catch (e) {
    return fail(e);
  }
}
