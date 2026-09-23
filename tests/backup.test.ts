import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const temp = mkdtempSync(path.join(tmpdir(), "inspiration-backup-"));
process.env.DATA_DIR = temp;
const store = await import("../src/lib/db");
const backup = await import("../src/lib/backup");
const uploads = path.join(temp, "uploads");
mkdirSync(uploads);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
async function fixture() {
  const project = {
    id: crypto.randomUUID(),
    name: "恢复项目",
    description: "目标",
    color: "#8b5cf6",
    status: "探索中",
    createdAt: new Date().toISOString(),
  };
  // Use the database constructor for a complete, valid record then remove it.
  const parent = await store.newNode({ content: "备份父记录" });
  await store.deleteNode(parent.id);
  parent.projectId = project.id;
  parent.linkImage = "https://example.com/cover.png";
  const child = {
    ...parent,
    id: crypto.randomUUID(),
    content: "子记录",
    parentId: parent.id,
    aiState: "pending" as const,
    image: `/api/files/${crypto.randomUUID()}.png`,
  };
  return {
    format: "inspiration-hub",
    version: 2,
    exportedAt: new Date().toISOString(),
    projects: [project],
    nodes: [child, parent],
    images: [{ name: child.image.slice(11), data: png.toString("base64") }],
  };
}
after(async () => {
  await store.db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("完整备份往返保留图片、项目、父子关系，预览不写入且恢复不触发 AI", async () => {
  const source = await fixture();
  const bytes = encode(source);
  const preview = await backup.previewBackup(bytes);
  assert.equal(preview.newNodes, 2);
  assert.equal(await store.getNode(source.nodes[0].id), null);
  assert.equal(readdirSync(uploads).length, 0);
  await backup.restoreBackup(bytes, preview.token);
  const child = (await store.getNode(source.nodes[0].id))!;
  assert.equal(child.parentId, source.nodes[1].id);
  assert.equal(child.projectId, source.projects[0].id);
  assert.equal(child.aiState, "idle");
  assert.equal(child.linkImage, "https://example.com/cover.png");
  assert.equal(
    (await store.db.prepare("SELECT count(*) AS n FROM ai_jobs").get())!.n,
    0,
  );
  assert.deepEqual(
    readFileSync(path.join(uploads, child.image!.slice(11))),
    png,
  );
  assert.notEqual(child.image, source.nodes[0].image);
  const roundtrip = backup.parseBackup(await backup.createBackup());
  assert.equal(roundtrip.images.length, 1);
  assert.equal(roundtrip.images[0].data, png.toString("base64"));
  assert.deepEqual(Object.keys(roundtrip).sort(), [
    "exportedAt",
    "format",
    "images",
    "nodes",
    "projects",
    "version",
  ]);
  // Reimport with a fresh preview is idempotent, preserving edits and attachments.
  await store.patchNode(child.id, { content: "本机最新内容" });
  const repeated = await backup.previewBackup(bytes);
  const beforeFiles = readdirSync(uploads);
  assert.equal(repeated.skippedNodes, 2);
  await backup.restoreBackup(bytes, repeated.token);
  assert.equal((await store.getNode(child.id))!.content, "本机最新内容");
  assert.deepEqual(readdirSync(uploads), beforeFiles);
});
test("拒绝过期预览，确认前必须重新检查冲突", async () => {
  const source = await fixture();
  const bytes = encode(source);
  const preview = await backup.previewBackup(bytes);
  await store.newNode({ ...source.nodes[1], projectId: null });
  await assert.rejects(
    async () => await backup.restoreBackup(bytes, preview.token),
    /重新预览/,
  );
  assert.equal(await store.getProject(source.projects[0].id), null);
  assert.equal(await store.getNode(source.nodes[0].id), null);
  await assert.rejects(
    async () => await backup.restoreBackup(bytes, ""),
    /重新预览/,
  );
});
test("旧版备份缺少链接封面字段时仍可预览", async () => {
  const source = await fixture();
  for (const node of source.nodes)
    delete (node as Partial<typeof node>).linkImage;
  const parsed = backup.parseBackup(encode(source));
  assert.equal(parsed.nodes[0].linkImage, null);
});
test("损坏、路径穿越、缺图、重复 ID 和循环关联均在写入前拒绝", async () => {
  for (const mutate of [
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.images[0].name = "../../settings.json";
    },
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.images[0].data = Buffer.from("not an image").toString("base64");
    },
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.images = [];
    },
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.nodes.push(b.nodes[0]);
    },
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.nodes[1].parentId = b.nodes[0].id;
    },
    (b: Awaited<ReturnType<typeof fixture>>) => {
      b.projects = [];
    },
  ]) {
    const source = await fixture();
    mutate(source);
    await assert.rejects(
      async () => await backup.previewBackup(encode(source)),
    );
    assert.equal(await store.getNode(source.nodes[0].id), null);
  }
  assert.throws(() => backup.parseBackup(Buffer.from("broken")), /无法读取/);
  assert.throws(
    () => backup.parseBackup(encode({ version: 1, nodes: [] })),
    /版本 2/,
  );
});
test("数据库写入失败时，项目、记录及新图片全部回滚", async () => {
  const source = await fixture();
  const bytes = encode(source);
  const preview = await backup.previewBackup(bytes);
  const before = readdirSync(uploads);
  await store.db.exec(
    "CREATE TRIGGER backup_failure BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
  );
  try {
    await assert.rejects(
      async () => await backup.restoreBackup(bytes, preview.token),
      /simulated failure/,
    );
  } finally {
    await store.db.exec("DROP TRIGGER backup_failure");
  }
  assert.deepEqual(readdirSync(uploads), before);
  assert.equal(await store.getNode(source.nodes[0].id), null);
  assert.equal(await store.getProject(source.projects[0].id), null);
});
test("缺失本机图片时拒绝生成不完整备份", async () => {
  const node = await store.newNode({
    content: "丢失图片",
    image: `/api/files/${crypto.randomUUID()}.png`,
  });
  try {
    await assert.rejects(
      async () => await backup.createBackup(),
      /图片文件缺失/,
    );
  } finally {
    await store.deleteNode(node.id);
  }
});
test("请求超出限制时拒绝，包括未声明长度的流式请求", async () => {
  await assert.rejects(
    backup.readBackupRequest(
      new Request("http://localhost", {
        method: "POST",
        body: "{}",
        headers: { "content-length": String(backup.MAX_BACKUP_BYTES + 1) },
      }),
    ),
    /32 MB/,
  );
  let count = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (++count === 34) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(backup.readBackupRequest(request), /32 MB/);
  assert.equal(cancelled, true);
});
