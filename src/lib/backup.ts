import { createHash, randomUUID } from "node:crypto";
import { readImage, writeImage, removeImage } from "./storage";
import { cloudStorage } from "./environment";
import { z } from "zod";
import { db, dialect, saveNode, transaction } from "./db";
import { statuses, type Idea } from "./types";
import { analysisSchema, projectInput, urlSchema } from "./validation";
import { imageExtension } from "./images";

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const imageName = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
const ideaSchema = z.object({
  id: z.uuid(),
  title: z.string().max(160),
  content: z.string().max(50000),
  type: z.enum(["text", "image", "link"]),
  image: z
    .string()
    .regex(/^\/api\/files\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/)
    .nullable(),
  url: urlSchema.nullable(),
  linkTitle: z.string().max(10000).nullable(),
  linkDescription: z.string().max(50000).nullable(),
  linkImage: urlSchema.nullable().default(null),
  projectId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  status: z.enum(statuses),
  tags: z.array(z.string().max(40)).max(20),
  favorite: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  analysis: analysisSchema.nullable(),
  aiState: z.enum(["idle", "pending", "done", "error"]),
  aiError: z.string().max(10000).nullable(),
  completedActions: z.array(z.number().int().min(0).max(9)).max(10),
  sample: z.boolean(),
});
const backupSchema = z.object({
  format: z.literal("inspiration-hub"),
  version: z.literal(2),
  exportedAt: z.iso.datetime(),
  projects: z
    .array(projectInput.extend({ id: z.uuid(), createdAt: z.iso.datetime() }))
    .max(5000),
  nodes: z.array(ideaSchema).max(5000),
  images: z
    .array(z.object({ name: z.string().regex(imageName), data: z.string() }))
    .max(5000),
});
type Backup = z.infer<typeof backupSchema>;
export type BackupPreview = {
  token: string;
  exportedAt: string;
  nodes: number;
  projects: number;
  images: number;
  newNodes: number;
  skippedNodes: number;
  newProjects: number;
  skippedProjects: number;
};
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function parseBackup(bytes: Buffer): Backup {
  if (bytes.length > MAX_BACKUP_BYTES) throw new Error("备份不能超过 32 MB");
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("无法读取备份，请选择完整备份 JSON 文件");
  }
  const result = backupSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "备份格式无效。请选择本应用导出的完整备份（版本 2），普通文字导出不支持恢复。",
    );
  const backup = result.data;
  const nodes = new Map(backup.nodes.map((n) => [n.id, n]));
  const projects = new Set(backup.projects.map((p) => p.id));
  const images = new Set(backup.images.map((i) => i.name));
  if (
    nodes.size !== backup.nodes.length ||
    projects.size !== backup.projects.length ||
    images.size !== backup.images.length
  )
    throw new Error("备份中存在重复 ID 或图片名称");
  const referenced = new Set<string>();
  for (const node of backup.nodes) {
    if (node.projectId && !projects.has(node.projectId))
      throw new Error("备份缺少关联项目");
    if (node.parentId && !nodes.has(node.parentId))
      throw new Error("备份缺少父记录");
    if (node.image) {
      const name = node.image.slice("/api/files/".length);
      if (!images.has(name)) throw new Error("备份缺少图片文件");
      referenced.add(name);
    }
  }
  // Iterative traversal also handles long chains without exhausting the stack.
  const visited = new Set<string>();
  for (const node of backup.nodes) {
    const chain = new Set<string>();
    let current: string | null = node.id;
    while (current && !visited.has(current)) {
      if (chain.has(current)) throw new Error("备份中的父子记录存在循环关联");
      chain.add(current);
      current = nodes.get(current)!.parentId;
    }
    for (const id of chain) visited.add(id);
  }
  let total = 0;
  for (const file of backup.images) {
    if (!referenced.has(file.name)) throw new Error("备份包含未关联的图片");
    if (file.data.length > 14 * 1024 * 1024)
      throw new Error("单张图片不能超过 10 MB");
    const bytes = Buffer.from(file.data, "base64");
    total += bytes.length;
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      total > 20 * 1024 * 1024
    )
      throw new Error("单张图片不能超过 10 MB，图片总量不能超过 20 MB");
    if (
      bytes.toString("base64") !== file.data ||
      imageExtension(bytes) !== file.name.split(".").pop()
    )
      throw new Error("图片内容损坏或格式不匹配");
  }
  return backup;
}

export async function createBackup(): Promise<Buffer> {
  const snapshot = await transaction(async () => {
    const size = await db
      .prepare(
        dialect(
          "SELECT count(*) AS count, coalesce(sum(length(cast(payload AS BLOB))),0) AS bytes FROM nodes",
          "SELECT count(*) AS count, coalesce(sum(octet_length(payload)),0) AS bytes FROM nodes",
        ),
      )
      .get();
    const count = await db
      .prepare("SELECT count(*) AS count FROM projects")
      .get();
    if (
      Number(size.count) > 5000 ||
      Number(count.count) > 5000 ||
      Number(size.bytes) > MAX_BACKUP_BYTES
    )
      throw new Error("资料库超过完整备份限制，请使用数据库备份");
    return {
      nodes: (
        await db.prepare("SELECT payload FROM nodes ORDER BY id").all()
      ).map((r) => JSON.parse(String(r.payload)) as Idea),
      projects: await db.prepare("SELECT * FROM projects ORDER BY id").all(),
    };
  });
  // Files are immutable; fetch them after releasing the database transaction.
  const names = [
    ...new Set(
      snapshot.nodes.flatMap((n) => (n.image ? [n.image.slice(11)] : [])),
    ),
  ];
  const images: { name: string; data: string }[] = [];
  let total = 0;
  for (const name of names) {
    if (!imageName.test(name)) throw new Error("记录中存在无效图片路径");
    let bytes: Buffer;
    try {
      bytes = await readImage(name);
    } catch {
      throw new Error("部分图片文件缺失或不可读，无法生成完整备份");
    }
    total += bytes.length;
    if (bytes.length > 10 * 1024 * 1024 || total > 20 * 1024 * 1024)
      throw new Error("图片总量超过备份限制，请使用存储服务备份");
    images.push({ name, data: bytes.toString("base64") });
  }
  const output = Buffer.from(
    JSON.stringify({
      format: "inspiration-hub",
      version: 2,
      exportedAt: new Date().toISOString(),
      ...snapshot,
      images,
    }),
  );
  parseBackup(output);
  return output;
}

export async function previewBackup(bytes: Buffer): Promise<BackupPreview> {
  return await plan(parseBackup(bytes), hash(bytes));
}
async function plan(backup: Backup, digest: string): Promise<BackupPreview> {
  const nodeIds = new Set(
    (await db.prepare("SELECT id FROM nodes").all()).map((r) => r.id),
  );
  const projectIds = new Set(
    (await db.prepare("SELECT id FROM projects").all()).map((r) => r.id),
  );
  const existingNodes = backup.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => n.id)
    .sort();
  const existingProjects = backup.projects
    .filter((p) => projectIds.has(p.id))
    .map((p) => p.id)
    .sort();
  return {
    token: hash(JSON.stringify([digest, existingNodes, existingProjects])),
    exportedAt: backup.exportedAt,
    nodes: backup.nodes.length,
    projects: backup.projects.length,
    images: backup.images.length,
    newNodes: backup.nodes.length - existingNodes.length,
    skippedNodes: existingNodes.length,
    newProjects: backup.projects.length - existingProjects.length,
    skippedProjects: existingProjects.length,
  };
}
export async function restoreBackup(
  bytes: Buffer,
  token: string,
): Promise<BackupPreview> {
  const backup = parseBackup(bytes);
  const preview = await plan(backup, hash(bytes));
  if (!token || token !== preview.token)
    throw new Error("数据或备份已变化，请重新预览再导入");
  const existing = new Set(
    (await db.prepare("SELECT id FROM nodes").all()).map((r) => r.id),
  );
  const nodes = backup.nodes.filter((n) => !existing.has(n.id));
  const needed = new Set(
    nodes.flatMap((n) => (n.image ? [n.image.slice(11)] : [])),
  );
  const written: string[] = [];
  const remap = new Map<string, string>();
  try {
    for (const file of backup.images) {
      if (!needed.has(file.name)) continue;
      const name = randomUUID() + "." + file.name.split(".").pop();
      await writeImage(name, Buffer.from(file.data, "base64"));
      written.push(name);
      remap.set("/api/files/" + file.name, "/api/files/" + name);
    }
    return await transaction(async () => {
      // Recheck under the writer lock after the slow storage work.
      const current = await plan(backup, hash(bytes));
      if (current.token !== token)
        throw new Error("数据或备份已变化，请重新预览再导入");
      await db
        .prepare(
          "INSERT INTO meta VALUES ('initialized','1') ON CONFLICT(key) DO NOTHING",
        )
        .run();
      const restored = nodes.map((n) => ({
        ...n,
        image: n.image ? remap.get(n.image)! : null,
        aiState: n.analysis ? ("done" as const) : ("idle" as const),
        aiError: null,
      }));
      if (cloudStorage()) {
        // Bulk statements keep a 5,000-record import from making thousands of network round trips.
        await db
          .prepare(
            `INSERT INTO projects (id,name,description,color,status,createdAt)
          SELECT value->>'id',value->>'name',value->>'description',value->>'color',value->>'status',value->>'createdAt'
          FROM jsonb_array_elements(?::text::jsonb) ON CONFLICT(id) DO NOTHING`,
          )
          .run(JSON.stringify(backup.projects));
        await db
          .prepare(
            `INSERT INTO nodes (id,title,content,type,projectId,parentId,status,favorite,createdAt,updatedAt,payload)
          SELECT value->>'id',value->>'title',value->>'content',value->>'type',value->>'projectId',NULL,
          value->>'status',CASE WHEN (value->>'favorite')::boolean THEN 1 ELSE 0 END,
          value->>'createdAt',value->>'updatedAt',value::text FROM jsonb_array_elements(?::text::jsonb)`,
          )
          .run(JSON.stringify(restored));
        await db
          .prepare(
            `UPDATE nodes SET parentId=v.value->>'parentId' FROM jsonb_array_elements(?::text::jsonb) AS v(value) WHERE nodes.id=v.value->>'id'`,
          )
          .run(JSON.stringify(restored));
      } else {
        for (const p of backup.projects)
          await db
            .prepare(
              "INSERT INTO projects VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            )
            .run(p.id, p.name, p.description, p.color, p.status, p.createdAt);
        for (const n of restored) await saveNode({ ...n, parentId: null });
        for (const n of restored) if (n.parentId) await saveNode(n);
      }
      return current;
    });
  } catch (error) {
    for (const name of written) {
      try {
        await removeImage(name);
      } catch {
        /* Unreferenced uploads can be cleaned later. */
      }
    }
    throw error;
  }
}

export async function readBackupRequest(request: Request): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > MAX_BACKUP_BYTES)
    throw new Error("备份不能超过 32 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("请选择备份文件");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BACKUP_BYTES) {
        await reader.cancel();
        throw new Error("备份不能超过 32 MB");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
