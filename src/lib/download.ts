import { cloudStorage } from "./environment";
import { signedDownload, writeObject } from "./storage";

export async function downloadResponse(bytes: Buffer, filename: string) {
  if (cloudStorage()) {
    const key = `temporary/${Date.now()}-${crypto.randomUUID()}.export`;
    await writeObject(key, bytes, "application/json");
    return new Response(null, {
      status: 302,
      headers: {
        Location: await signedDownload(key, filename),
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
