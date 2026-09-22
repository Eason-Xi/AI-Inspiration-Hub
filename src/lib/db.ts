import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Idea, Project } from "./types";
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR || "./data",
);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const globalDb = globalThis as unknown as { hubDb?: DatabaseSync };
export const db =
  globalDb.hubDb ?? new DatabaseSync(path.join(dataDir, "hub.sqlite"));
globalDb.hubDb = db;
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL, projectId TEXT REFERENCES projects(id) ON DELETE SET NULL, parentId TEXT REFERENCES nodes(id) ON DELETE SET NULL, status TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS nodes_project ON nodes(projectId); CREATE INDEX IF NOT EXISTS nodes_status ON nodes(status); CREATE INDEX IF NOT EXISTS nodes_created ON nodes(createdAt DESC); CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parentId);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_jobs (
 id TEXT PRIMARY KEY, nodeId TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE,
 mode TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 maxAttempts INTEGER NOT NULL DEFAULT 3, nextRunAt INTEGER NOT NULL,
 leaseUntil INTEGER, leaseToken TEXT, error TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_jobs_due ON ai_jobs(status,nextRunAt);`);
export function transaction<T>(work: () => T): T {
  const name = "hub_" + crypto.randomUUID().replaceAll("-", "");
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw error;
  }
}
export function getNode(id: string): Idea | null {
  const row = db.prepare("SELECT payload FROM nodes WHERE id=?").get(id) as
    { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function saveNode(n: Idea) {
  db.prepare(
    `INSERT INTO nodes (id,title,content,type,projectId,parentId,status,favorite,createdAt,updatedAt,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,type=excluded.type,projectId=excluded.projectId,parentId=excluded.parentId,status=excluded.status,favorite=excluded.favorite,updatedAt=excluded.updatedAt,payload=excluded.payload`,
  ).run(
    n.id,
    n.title,
    n.content,
    n.type,
    n.projectId,
    n.parentId,
    n.status,
    Number(n.favorite),
    n.createdAt,
    n.updatedAt,
    JSON.stringify(n),
  );
  return n;
}
export function patchNode(id: string, changes: Partial<Idea>) {
  const old = getNode(id);
  if (!old) return null;
  return saveNode({
    ...old,
    ...changes,
    id,
    updatedAt: new Date().toISOString(),
  });
}
export function newNode(input: Partial<Idea> & { content: string }): Idea {
  const now = new Date().toISOString();
  return saveNode({
    id: crypto.randomUUID(),
    type: "text",
    image: null,
    url: null,
    linkTitle: null,
    linkDescription: null,
    projectId: null,
    parentId: null,
    status: "未处理",
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    analysis: null,
    aiState: "idle",
    aiError: null,
    completedActions: [],
    sample: false,
    ...input,
    title:
      input.title?.trim() ||
      input.content.trim().split("\n")[0].slice(0, 72) ||
      (input.url ? new URL(input.url).hostname : "一张新的灵感图片"),
  });
}
export function projects() {
  return db
    .prepare(
      "SELECT projects.*, (SELECT COUNT(*) FROM nodes WHERE projectId=projects.id) AS nodeCount FROM projects ORDER BY createdAt DESC",
    )
    .all() as unknown as Project[];
}
export function createProject(
  name: string,
  description: string,
  color: string,
) {
  const p: Project = {
    id: crypto.randomUUID(),
    name,
    description,
    color,
    status: "探索中",
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)").run(
    p.id,
    p.name,
    p.description,
    p.color,
    p.status,
    p.createdAt,
  );
  return p;
}
export function getProject(id: string): Project | null {
  return (
    (db
      .prepare(
        "SELECT projects.*, (SELECT COUNT(*) FROM nodes WHERE projectId=projects.id) AS nodeCount FROM projects WHERE id=?",
      )
      .get(id) as Project | undefined) || null
  );
}
export function updateProject(
  id: string,
  input: Pick<Project, "name" | "description" | "color" | "status">,
) {
  db.prepare(
    "UPDATE projects SET name=?,description=?,color=?,status=? WHERE id=?",
  ).run(input.name, input.description, input.color, input.status, id);
  return getProject(id);
}
export function deleteProject(id: string) {
  return transaction(() => {
    const nodes = db
      .prepare("SELECT id FROM nodes WHERE projectId=?")
      .all(id) as { id: string }[];
    for (const node of nodes) patchNode(node.id, { projectId: null });
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    return nodes.length;
  });
}
export function deleteNode(id: string) {
  const children = db
    .prepare("SELECT id FROM nodes WHERE parentId=?")
    .all(id) as { id: string }[];
  for (const child of children) patchNode(child.id, { parentId: null });
  db.prepare("DELETE FROM nodes WHERE id=?").run(id);
}
export function seed() {
  if (db.prepare("SELECT value FROM meta WHERE key='initialized'").get())
    return;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO meta VALUES ('initialized','1')").run();
    const p = createProject(
      "AI 访谈助手",
      "把一次好奇，变成一场有深度的对话。",
      "#8b5cf6",
    );
    const q = createProject(
      "个人知识系统",
      "让收集的内容，真正参与思考。",
      "#14b8a6",
    );
    const seeds = [
      {
        title: "如果 AI 不只是一个聊天框呢？",
        content:
          "为什么现在很多 AI 工具都做成聊天界面？也许更好的交互，是让 AI 出现在我们正在做的事情旁边。\n\n比如写笔记时帮我发现联系，做访谈时提醒一个值得追问的细节。",
        tags: ["AI", "产品思考"],
        projectId: p.id,
        status: "探索中" as const,
        favorite: true,
      },
      {
        title: "给灵感一个可以生长的地方",
        content:
          "收藏夹里的文章越来越多，真正回看的却很少。\n\n想做一个能把「收集」变成「探索」的个人知识系统：每次记录，都能自然延伸出下一步。",
        tags: ["知识管理", "灵感"],
        projectId: q.id,
        status: "探索中" as const,
      },
      {
        title: "访谈之前，先画一张好问题地图",
        content:
          "准备采访时，不是问题越多越好。试着围绕嘉宾的一个关键转折，组织背景、选择、代价、反思四组问题。",
        tags: ["访谈", "用户研究"],
        projectId: p.id,
        status: "待行动" as const,
      },
      {
        title: "把散步时的好奇心留下来",
        content:
          "今天路过一家只卖一种面包的小店。极少的选择，反而让人更容易做决定。\n\n这个思路能不能用在产品的新手引导里？",
        tags: ["日常观察", "产品思考"],
      },
      {
        title: "一种更轻盈的数字花园",
        content:
          "不急着写成完整文章。先种下一段想法，给它加上标签，再慢慢补充上下文。\n\n笔记也可以是持续生长的作品。",
        tags: ["知识管理", "写作"],
        projectId: q.id,
        favorite: true,
      },
      {
        title: "值得研究：GitHub 上的开源灵感",
        content: "整理喜欢的开源工具，记录它们解决的问题和可以借鉴的交互。",
        type: "link" as const,
        url: "https://github.com",
        linkTitle: "GitHub · Build and share software",
        tags: ["开源", "工具"],
      },
    ];
    seeds.forEach((s, i) =>
      newNode({
        ...s,
        sample: true,
        createdAt: new Date(Date.now() - i * 3600000 * 7).toISOString(),
      }),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
