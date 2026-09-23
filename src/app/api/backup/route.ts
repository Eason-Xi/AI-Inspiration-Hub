import {
  createBackup,
  previewBackup,
  readBackupRequest,
  restoreBackup,
} from "@/lib/backup";
import { fail } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    return new Response(new Uint8Array(createBackup()), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="inspiration-hub-full-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    const bytes = await readBackupRequest(request);
    const token = request.headers.get("x-backup-preview");
    return Response.json(
      token === null ? previewBackup(bytes) : restoreBackup(bytes, token),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
