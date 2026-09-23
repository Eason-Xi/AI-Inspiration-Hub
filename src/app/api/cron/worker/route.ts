import { timingSafeEqual } from "node:crypto";
import { wakeWorker } from "@/lib/worker";
import { cleanupTemporaryFiles } from "@/lib/storage";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const value = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(value) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  )
    return new Response(null, { status: 401 });
  await wakeWorker();
  await cleanupTemporaryFiles();
  return Response.json({ ok: true });
}
