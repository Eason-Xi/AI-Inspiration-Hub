import { authorize } from "@/lib/access";
export const maxDuration = 300;
import {
  createBackup,
  previewBackup,
  readBackupRequest,
  restoreBackup,
} from "@/lib/backup";
import { fail } from "@/lib/http";
import { jsonBody } from "@/lib/http";
import { cloudStorage } from "@/lib/environment";
import { readObject, removeObject } from "@/lib/storage";
import { downloadResponse } from "@/lib/download";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    return downloadResponse(
      await createBackup(),
      `inspiration-hub-full-${new Date().toISOString().slice(0, 10)}.json`,
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    let key: string | undefined;
    let bytes: Buffer;
    if (cloudStorage()) {
      const input = await jsonBody(request);
      if (
        typeof input.key !== "string" ||
        !/^temporary\/\d+-[a-f0-9-]{36}\.backup$/.test(input.key)
      )
        throw new Error("请先上传完整备份");
      key = input.key;
      bytes = await readObject(key!, 32 * 1024 * 1024);
    } else bytes = await readBackupRequest(request);
    const token = request.headers.get("x-backup-preview");
    const result =
      token === null
        ? await previewBackup(bytes)
        : await restoreBackup(bytes, token);
    if (key && token !== null) await removeObject(key).catch(() => {});
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
