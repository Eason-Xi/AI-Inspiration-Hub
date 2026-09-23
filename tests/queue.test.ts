import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const dir = mkdtempSync(path.join(tmpdir(), "inspiration-queue-"));
process.env.DATA_DIR = dir;
const {
  db,
  newNode,
  getNode,
  patchNode,
  deleteNode,
  createProject,
  updateProject,
  deleteProject,
  getProject,
} = await import("../src/lib/db");
const {
  enqueueAnalysis,
  runNextJob,
  getTask,
  claimNextJob,
  cancelTask,
  recoverLegacyTasks,
} = await import("../src/lib/jobs");
const { setSettings, resolveSettings, credentials } =
  await import("../src/lib/settings");
const { testConnection, chatJson } = await import("../src/lib/provider");
let status = 200;
let gate: Promise<void> | null = null;
let observed: ((input: Record<string, unknown>) => void) | null = null;
let malformed = false;
const server = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const request = JSON.parse(text);
  const raw = request.messages[1].content;
  const probe = typeof raw === "string";
  const input = probe ? {} : JSON.parse(raw[0].text);
  const currentStatus = status;
  const currentGate = gate;
  const currentMalformed = malformed;
  observed?.(input);
  if (currentGate) await currentGate;
  res.writeHead(currentStatus, { "Content-Type": "application/json" });
  const result = probe
    ? { ok: true }
    : {
        summary: String(input.title),
        tags: ["产品"],
        category: "产品想法",
        expansions: [
          { title: "用户验证", content: "访问 3 位目标用户，记录当前做法。" },
          { title: "原型验证", content: "用纸面原型演示一次核心操作。" },
          { title: "结果对比", content: "比较原方案和原型完成任务的时间。" },
        ],
        actions: ["收集 3 次访谈反馈"],
      };
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: currentMalformed ? "not json" : JSON.stringify(result),
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
await setSettings({
  baseUrl: `http://127.0.0.1:${port}/v1`,
  model: "mock-model",
  apiKey: "queue-test-secret",
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});
function holdRequest() {
  let release!: () => void;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen!: (input: Record<string, unknown>) => void;
  const arrived = new Promise<Record<string, unknown>>((resolve) => {
    seen = resolve;
  });
  observed = seen;
  return {
    arrived,
    release: () => {
      gate = null;
      observed = null;
      release();
    },
  };
}
async function due(id: string) {
  await db.prepare("UPDATE ai_jobs SET nextRunAt=0 WHERE nodeId=?").run(id);
}

test("重复点击只产生一个任务，限流退避后成功，并传入项目上下文", async () => {
  const p = await createProject("访谈产品", "帮记者准备采访", "#8b5cf6");
  const n = await newNode({ content: "整理嘉宾背景", projectId: p.id });
  const task = await enqueueAnalysis(n.id, "产品");
  assert.equal((await enqueueAnalysis(n.id, "反向"))?.id, task?.id);
  status = 429;
  await runNextJob();
  assert.equal((await getTask(n.id))?.status, "retrying");
  assert.equal((await getTask(n.id))?.attempts, 1);
  assert.equal(await runNextJob(), false);
  assert.equal((await getNode(n.id))?.aiState, "pending");
  status = 200;
  await due(n.id);
  let context: Record<string, unknown> = {};
  observed = (input) => {
    context = input;
  };
  await runNextJob();
  observed = null;
  assert.equal((await getTask(n.id))?.status, "done");
  assert.equal((await getTask(n.id))?.attempts, 2);
  assert.equal((context.project as { name: string }).name, "访谈产品");
  assert.equal(context.mode, "产品");
});
test("临时错误最多尝试三次；认证错误不自动重试", async () => {
  status = 503;
  const n = await newNode({ content: "重试上限" });
  await enqueueAnalysis(n.id);
  for (let i = 0; i < 3; i++) {
    await due(n.id);
    await runNextJob();
  }
  assert.equal((await getTask(n.id))?.status, "failed");
  assert.equal((await getTask(n.id))?.attempts, 3);
  assert.equal(await runNextJob(), false);
  status = 401;
  const bad = await newNode({ content: "错误的密钥" });
  await enqueueAnalysis(bad.id);
  await runNextJob();
  assert.equal((await getTask(bad.id))?.status, "failed");
  assert.equal((await getTask(bad.id))?.attempts, 1);
  assert.match((await getNode(bad.id))!.aiError!, /API Key/);
  status = 200;
});
test("旧请求成功返回时，不能覆盖新标题对应的任务或新结果", async () => {
  const n = await newNode({ title: "旧标题", content: "相同正文" });
  await enqueueAnalysis(n.id);
  const hold = holdRequest();
  const old = runNextJob();
  await hold.arrived;
  await patchNode(n.id, { title: "新标题" });
  const latest = await enqueueAnalysis(n.id, "创意", true);
  hold.release();
  await old;
  assert.equal((await getTask(n.id))?.id, latest?.id);
  assert.equal((await getTask(n.id))?.status, "queued");
  assert.equal((await getNode(n.id))?.analysis, null);
  await runNextJob();
  assert.equal((await getNode(n.id))?.analysis?.summary, "新标题");
});
test("用户只勾选行动或收藏时，正在生成的结果仍能保存", async () => {
  const n = await newNode({ content: "不相关的编辑" });
  await enqueueAnalysis(n.id);
  const hold = holdRequest();
  const pending = runNextJob();
  await hold.arrived;
  await patchNode(n.id, { favorite: true });
  hold.release();
  await pending;
  assert.equal((await getTask(n.id))?.status, "done");
  assert.equal((await getNode(n.id))?.favorite, true);
});
test("取消和删除都使晚到的结果失效", async () => {
  for (const remove of [false, true]) {
    const n = await newNode({ content: "处理中取消" });
    await enqueueAnalysis(n.id);
    const hold = holdRequest();
    const pending = runNextJob();
    await hold.arrived;
    if (remove) await deleteNode(n.id);
    else await cancelTask(n.id);
    hold.release();
    await pending;
    if (remove) {
      assert.equal(await getNode(n.id), null);
      assert.equal(await getTask(n.id), null);
    } else {
      assert.equal((await getTask(n.id))?.status, "cancelled");
      assert.equal((await getNode(n.id))?.analysis, null);
      assert.equal((await getNode(n.id))?.aiState, "idle");
    }
  }
});
test("项目删除保留记录和父子关系，项目修改后的旧分析自动重排", async () => {
  const p = await createProject("旧目标", "原描述", "#8b5cf6");
  const n = await newNode({ content: "项目计划", projectId: p.id });
  const child = await newNode({
    content: "子计划",
    parentId: n.id,
    projectId: p.id,
  });
  await enqueueAnalysis(n.id);
  const hold = holdRequest();
  const pending = runNextJob();
  await hold.arrived;
  await updateProject(p.id, {
    name: "新目标",
    description: "新描述",
    color: "#14b8a6",
    status: "进行中",
  });
  hold.release();
  await pending;
  assert.equal((await getTask(n.id))?.status, "queued");
  await runNextJob();
  assert.equal((await getTask(n.id))?.status, "done");
  assert.equal(await deleteProject(p.id), 2);
  assert.equal(await getProject(p.id), null);
  assert.equal((await getNode(n.id))?.projectId, null);
  assert.equal((await getNode(child.id))?.projectId, null);
  assert.equal((await getNode(child.id))?.parentId, n.id);
  const sql = await db
    .prepare("SELECT projectId FROM nodes WHERE id=?")
    .get(n.id);
  assert.equal(sql?.projectId, null);
});
test("租约过期后由新进程恢复，未过期的任务不会被抢占", async () => {
  const n = await newNode({ content: "重启恢复验收" });
  await enqueueAnalysis(n.id);
  const claimed = (await claimNextJob())!;
  assert.equal(await claimNextJob(), null);
  await db.prepare("UPDATE ai_jobs SET leaseUntil=0 WHERE nodeId=?").run(n.id);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "const {runNextJob}=await import('./src/lib/jobs.ts');await runNextJob();",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dir },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, errors);
  assert.equal((await getTask(n.id))?.status, "done");
  assert.equal((await getTask(n.id))?.attempts, claimed.attempts + 1);
  assert.ok((await getNode(n.id))?.analysis);
});
test("旧版本遗留 pending 状态被恢复一次，已失败的任务不会自动重放", async () => {
  const n = await newNode({ content: "旧任务", aiState: "pending" });
  await recoverLegacyTasks();
  const task = await getTask(n.id);
  assert.equal(task?.status, "queued");
  await recoverLegacyTasks();
  assert.equal((await getTask(n.id))?.id, task?.id);
  await cancelTask(n.id);
});
test("连接测试不修改配置，拒绝将原密钥发送到不同地址，拒绝非 JSON 输出", async () => {
  const old = await credentials();
  const result = await testConnection(old);
  assert.equal(result.ok, true);
  assert.deepEqual(await credentials(), old);
  await assert.rejects(
    async () =>
      await resolveSettings({
        baseUrl: "https://elsewhere.example/v1",
        model: "x",
      }),
    /重新填写/,
  );
  malformed = true;
  await assert.rejects(() => testConnection(old), /有效的 JSON/);
  malformed = false;
  const hold = holdRequest();
  const timed = chatJson(
    old,
    [
      { role: "system", content: "JSON" },
      { role: "user", content: "test" },
    ],
    50,
  );
  await hold.arrived;
  await assert.rejects(timed, /超时/);
  hold.release();
});
