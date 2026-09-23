import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db, dataDir, saveNode, transaction } from "./db";
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

export function createBackup(): Buffer {
  return transaction(() => {
    const size = db
      .prepare(
        "SELECT count(*) AS count, coalesce(sum(length(cast(payload AS BLOB))), 0) AS bytes FROM nodes",
      )
      .get()!;
    const projectCount = db
      .prepare("SELECT count(*) AS count FROM projects")
      .get()!;
    if (
      Number(size.count) > 5000 ||
      Number(projectCount.count) > 5000 ||
      Number(size.bytes) > MAX_BACKUP_BYTES
    )
      throw new Error("资料库超过完整备份限制，请备份整个 data 文件夹");
    const nodes = db
      .prepare("SELECT payload FROM nodes ORDER BY id")
      .all()
      .map((r) => JSON.parse(r.payload as string) as Idea);
    const names = [
      ...new Set(
        nodes.flatMap((n) =>
          n.image ? [n.image.slice("/api/files/".length)] : [],
        ),
      ),
    ];
    let total = 0;
    const images = names.map((name) => {
      if (!imageName.test(name)) throw new Error("记录中存在无效图片路径");
      const filename = path.join(dataDir, "uploads", name);
      try {
        const size = statSync(filename).size;
        total += size;
        if (size > 10 * 1024 * 1024 || total > 20 * 1024 * 1024)
          throw new Error("limit");
        return { name, data: readFileSync(filename).toString("base64") };
      } catch (error) {
        if ((error as Error).message === "limit")
          throw new Error("图片总量超过备份限制，请备份整个 data 文件夹");
        throw new Error("部分图片文件缺失或不可读，无法生成完整备份");
      }
    });
    const output = Buffer.from(
      JSON.stringify({
        format: "inspiration-hub",
        version: 2,
        exportedAt: new Date().toISOString(),
        projects: db.prepare("SELECT * FROM projects ORDER BY id").all(),
        nodes,
        images,
      }),
    );
    parseBackup(output); // Never produce an archive that this version cannot restore.
    return output;
  });
}

export function previewBackup(bytes: Buffer): BackupPreview {
  return plan(parseBackup(bytes), hash(bytes));
}
function plan(backup: Backup, digest: string): BackupPreview {
  const nodeIds = new Set(
    db
      .prepare("SELECT id FROM nodes")
      .all()
      .map((r) => r.id),
  );
  const projectIds = new Set(
    db
      .prepare("SELECT id FROM projects")
      .all()
      .map((r) => r.id),
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
export function restoreBackup(bytes: Buffer, token: string): BackupPreview {
  const backup = parseBackup(bytes);
  const written: string[] = [];
  try {
    return transaction(() => {
      // Reserve the SQLite writer before computing conflicts; other processes cannot race this import.
      db.prepare("INSERT OR IGNORE INTO meta VALUES ('initialized','1')").run();
      const preview = plan(backup, hash(bytes));
      if (!token || token !== preview.token)
        throw new Error("数据或备份已变化，请重新预览再导入");
      const hasProject = db.prepare("SELECT id FROM projects WHERE id=?");
      for (const p of backup.projects) {
        if (!hasProject.get(p.id))
          db.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)").run(
            p.id,
            p.name,
            p.description,
            p.color,
            p.status,
            p.createdAt,
          );
      }
      const hasNode = db.prepare("SELECT id FROM nodes WHERE id=?");
      const nodes = backup.nodes.filter((n) => !hasNode.get(n.id));
      const needed = new Set(
        nodes.flatMap((n) =>
          n.image ? [n.image.slice("/api/files/".length)] : [],
        ),
      );
      const remap = new Map<string, string>();
      mkdirSync(path.join(dataDir, "uploads"), {
        recursive: true,
        mode: 0o700,
      });
      for (const file of backup.images) {
        if (!needed.has(file.name)) continue;
        const name = randomUUID() + "." + file.name.split(".").pop();
        const filename = path.join(dataDir, "uploads", name);
        // Unique filenames never overwrite an existing attachment.
        writeFileSync(filename, Buffer.from(file.data, "base64"), {
          flag: "wx",
          mode: 0o600,
        });
        written.push(filename);
        remap.set("/api/files/" + file.name, "/api/files/" + name);
      }
      const restored = nodes.map((n) => ({
        ...n,
        image: n.image ? remap.get(n.image)! : null,
        aiState: n.analysis ? ("done" as const) : ("idle" as const),
        aiError: null,
      }));
      // Insert all IDs first so child-before-parent archives also work.
      for (const node of restored) saveNode({ ...node, parentId: null });
      for (const node of restored) if (node.parentId) saveNode(node);
      return preview;
    });
  } catch (error) {
    for (const filename of written) {
      try {
        unlinkSync(filename);
      } catch {
        /* Unreferenced files are safe after rollback. */
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
