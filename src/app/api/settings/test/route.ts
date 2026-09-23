import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { settingsInput } from "@/lib/validation";
import { resolveSettings } from "@/lib/settings";
import { testConnection } from "@/lib/provider";
import { fail, jsonBody } from "@/lib/http";
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    return Response.json(
      await testConnection(
        await resolveSettings(settingsInput.parse(await jsonBody(req))),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
