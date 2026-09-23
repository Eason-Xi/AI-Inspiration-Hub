import { authorize } from "@/lib/access";
export const maxDuration = 300;
import { db, projects } from "@/lib/db";
import { downloadResponse } from "@/lib/download";
export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  const nodes = (
    await db.prepare("SELECT payload FROM nodes ORDER BY createdAt").all()
  ).map((r) => JSON.parse(r.payload as string));
  return downloadResponse(
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: await projects(),
          nodes,
        },
        null,
        2,
      ),
    ),
    `inspiration-hub-${new Date().toISOString().slice(0, 10)}.json`,
  );
}
