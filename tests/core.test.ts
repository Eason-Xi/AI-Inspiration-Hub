import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
const temp = mkdtempSync(path.join(tmpdir(), "inspiration-test-"));
process.env.DATA_DIR = temp;
const store = await import("../src/lib/db");
const { analyzeNode } = await import("../src/lib/ai");
const { setSettings, publicSettings } = await import("../src/lib/settings");
const { nodeInput, analysisSchema } = await import("../src/lib/validation");
const { isPublicAddress } = await import("../src/lib/links");
after(() => {
  store.db.close();
  rmSync(temp, { recursive: true, force: true });
});
test("记录持久化，项目归属及删除父节点保留子节点", () => {
  const project = store.createProject("验收项目", "持久化测试", "#8b5cf6");
  const parent = store.newNode({
    content: "核心想法",
    projectId: project.id,
    tags: ["测试"],
  });
  const child = store.newNode({
    content: "具体行动",
    parentId: parent.id,
    projectId: project.id,
  });
  store.patchNode(parent.id, { favorite: true, status: "探索中" });
  assert.equal(store.getNode(parent.id)?.favorite, true);
  assert.equal(store.getNode(child.id)?.parentId, parent.id);
  store.deleteNode(parent.id);
  assert.equal(store.getNode(child.id)?.parentId, null);
  assert.equal(store.getNode(child.id)?.projectId, project.id);
});
test("拒绝空记录、危险链接、不完整 AI 输出与内网解析", () => {
  assert.equal(nodeInput.safeParse({ content: "  " }).success, false);
  assert.equal(
    nodeInput.safeParse({ content: "x", url: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(nodeInput.safeParse({ image: "/etc/passwd" }).success, false);
  assert.equal(
    nodeInput.safeParse({ url: "https://example.com" }).success,
    true,
  );
  assert.equal(
    analysisSchema.safeParse({
      summary: "摘要",
      tags: [],
      expansions: [],
      actions: [],
    }).success,
    false,
  );
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "::1",
    "100.64.0.1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});
test("AI 服务完整链路：摘要、发散、子节点、行动与失败状态", async () => {
  let fail = false;
  let received: any;
  const analysis = {
    summary: "测试摘要",
    tags: ["访谈", "产品"],
    category: "产品想法",
    expansions: [
      {
        title: "目标用户",
        content: "采访 3 位播客创作者，记录他们准备嘉宾资料的耗时。",
      },
      { title: "问题地图", content: "按背景、转折和反思组织问题。" },
      { title: "验证方案", content: "用一次真实访谈检验问题的有效性。" },
    ],
    actions: ["联系 3 位创作者", "准备访谈提纲"],
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.writeHead(fail ? 401 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        fail
          ? { error: "invalid" }
          : { choices: [{ message: { content: JSON.stringify(analysis) } }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    setSettings({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "test-model",
      apiKey: "test-only-key",
    });
    const node = store.newNode({ content: "想做一个访谈准备工具" });
    await analyzeNode(node.id, "产品");
    const result = store.getNode(node.id)!;
    assert.equal(result.aiState, "done");
    assert.equal(result.analysis?.expansions.length, 3);
    assert.ok(received.messages[1].content[0].text.includes("产品"));
    assert.ok(!JSON.stringify(publicSettings()).includes("test-only-key"));
    const child = store.newNode({
      ...result.analysis!.expansions[0],
      parentId: node.id,
    });
    assert.equal(store.getNode(child.id)?.parentId, node.id);
    store.patchNode(node.id, { completedActions: [0] });
    assert.deepEqual(store.getNode(node.id)?.completedActions, [0]);
    fail = true;
    await analyzeNode(node.id);
    assert.equal(store.getNode(node.id)?.aiState, "error");
    assert.match(store.getNode(node.id)!.aiError!, /API Key/);
    assert.equal(store.getNode(node.id)?.analysis?.expansions.length, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("仅链接记录使用域名标题，空标题不覆盖默认值", () => {
  const node = store.newNode({
    title: "",
    content: "",
    url: "https://example.com",
    type: "link",
  });
  assert.equal(node.title, "example.com");
});
