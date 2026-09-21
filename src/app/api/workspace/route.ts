import { db, projects, seed } from "@/lib/db";
import { publicSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  seed();
  const p = new URL(req.url).searchParams;
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (sql: string, value?: string | number) => {
    where.push(sql);
    if (value !== undefined) args.push(value);
  };
  const view = p.get("view");
  if (view === "archive" || p.get("status") === "归档") add("status='归档'");
  else add("status<>'归档'");
  if (view === "inbox") add("projectId IS NULL");
  if (view === "favorites") add("favorite=1");
  if (p.get("project")) add("projectId=?", p.get("project")!);
  if (p.get("type")) add("type=?", p.get("type")!);
  if (p.get("status")) add("status=?", p.get("status")!);
  if (p.get("tag"))
    add(
      "EXISTS(SELECT 1 FROM json_each(nodes.payload,'$.tags') WHERE value=?)",
      p.get("tag")!,
    );
  if (p.get("q")) {
    const q = "%" + p.get("q")!.replace(/[\\%_]/g, "\\$&") + "%";
    where.push(
      "(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(nodes.payload,'$.tags') WHERE value LIKE ? ESCAPE '\\'))",
    );
    args.push(q, q, q);
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM nodes" + clause).get(...args) as {
      n: number;
    }
  ).n;
  const pages = Math.max(1, Math.ceil(total / 18));
  const page = Math.min(
    pages,
    Math.max(1, Math.floor(Number(p.get("page")) || 1)),
  );
  const nodes = db
    .prepare(
      "SELECT payload FROM nodes" +
        clause +
        " ORDER BY createdAt DESC LIMIT 18 OFFSET ?",
    )
    .all(...args, (page - 1) * 18)
    .map((r) => JSON.parse(r.payload as string));
  const stats = db
    .prepare(
      "SELECT COUNT(*) as total, COALESCE(SUM(projectId IS NULL AND status<>'归档'),0) as inbox, COALESCE(SUM(favorite=1 AND status<>'归档'),0) as favorites, COALESCE(SUM(status='探索中'),0) as exploring FROM nodes",
    )
    .get();
  const tags = db
    .prepare(
      "SELECT DISTINCT value FROM nodes,json_each(nodes.payload,'$.tags') ORDER BY value",
    )
    .all()
    .map((r) => r.value);
  return Response.json({
    nodes,
    projects: projects(),
    settings: publicSettings(),
    total,
    page,
    pages,
    stats,
    tags,
  });
}
