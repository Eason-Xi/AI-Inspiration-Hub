import { settingsInput } from "@/lib/validation";
import { resolveSettings } from "@/lib/settings";
import { testConnection } from "@/lib/provider";
import { fail, jsonBody } from "@/lib/http";
export async function POST(req: Request) {
  try {
    return Response.json(
      await testConnection(
        resolveSettings(settingsInput.parse(await jsonBody(req))),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
