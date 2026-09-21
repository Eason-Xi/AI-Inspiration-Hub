import { db, projects } from "@/lib/db";
export async function GET() {
  const nodes = db
    .prepare("SELECT payload FROM nodes ORDER BY createdAt")
    .all()
    .map((r) => JSON.parse(r.payload as string));
  return new Response(
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects(),
        nodes,
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="inspiration-hub-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    },
  );
}
