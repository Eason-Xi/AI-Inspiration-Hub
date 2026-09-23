import { authorize } from "@/lib/access";
import { db, projects, seed, dialect } from "@/lib/db";
import { after } from "next/server";
import { wakeWorker } from "@/lib/worker";
import { publicSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  await seed();
  after(wakeWorker);
  const p = new URL(req.url).searchParams;
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (sql: string, value?: string | number) => {
    where.push(sql);
    if (value !== undefined) args.push(value);
  };
  const view = p.get("view");
  const tagTable = dialect(
    "json_each(nodes.payload,'$.tags')",
    "jsonb_array_elements_text(nodes.payload::jsonb->'tags') AS tags(value)",
  );
  if (view === "archive" || p.get("status") === "归档") add("status='归档'");
  else add("status<>'归档'");
  if (view === "inbox") add("projectId IS NULL");
  if (view === "favorites") add("favorite=1");
  if (p.get("project")) add("projectId=?", p.get("project")!);
  if (p.get("type")) add("type=?", p.get("type")!);
  if (p.get("status")) add("status=?", p.get("status")!);
  if (p.get("tag"))
    add(`EXISTS(SELECT 1 FROM ${tagTable} WHERE value=?)`, p.get("tag")!);
  if (p.get("q")) {
    const q = "%" + p.get("q")!.replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      `(lower(title) LIKE lower(?) ESCAPE '\\' OR lower(content) LIKE lower(?) ESCAPE '\\' OR EXISTS(SELECT 1 FROM ${tagTable} WHERE lower(value) LIKE lower(?) ESCAPE '\\'))`,
    );
    args.push(q, q, q);
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = (
    (await db
      .prepare("SELECT COUNT(*) AS n FROM nodes" + clause)
      .get(...args)) as {
      n: number;
    }
  ).n;
  const pages = Math.max(1, Math.ceil(total / 18));
  const page = Math.min(
    pages,
    Math.max(1, Math.floor(Number(p.get("page")) || 1)),
  );
  const nodes = (
    await db
      .prepare(
        "SELECT payload FROM nodes" +
          clause +
          " ORDER BY createdAt DESC LIMIT 18 OFFSET ?",
      )
      .all(...args, (page - 1) * 18)
  ).map((r) => JSON.parse(r.payload as string));
  const stats = await db
    .prepare(
      "SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN projectId IS NULL AND status<>'归档' THEN 1 ELSE 0 END),0) as inbox, COALESCE(SUM(CASE WHEN favorite=1 AND status<>'归档' THEN 1 ELSE 0 END),0) as favorites, COALESCE(SUM(CASE WHEN status='探索中' THEN 1 ELSE 0 END),0) as exploring FROM nodes",
    )
    .get();
  const tags = (
    await db
      .prepare(`SELECT DISTINCT value FROM nodes,${tagTable} ORDER BY value`)
      .all()
  ).map((r) => r.value);
  return Response.json({
    nodes,
    projects: await projects(),
    settings: await publicSettings(),
    total,
    page,
    pages,
    stats,
    tags,
  });
}
