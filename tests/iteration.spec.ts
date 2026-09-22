import { test, expect } from "@playwright/test";

test("项目创建、修改和归档；删除项目后记录及父子关系保留", async ({
  page,
  request,
}) => {
  const name = "项目管理验收 " + Date.now();
  let projectId = "";
  let nodeId = "";
  let childId = "";
  try {
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "新建项目", exact: true })
      .last()
      .click();
    await page.getByLabel("项目名称").fill(name);
    await page.getByLabel("项目描述").fill("验证项目生命周期");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(page).toHaveURL(/\/project\/[a-f0-9-]+$/);
    projectId = page.url().split("/").pop()!;
    const node = await (
      await request.post("/api/nodes", {
        data: { content: "项目内的原始记录", projectId },
      })
    ).json();
    nodeId = node.id;
    const child = await (
      await request.post("/api/nodes", {
        data: { content: "保留关联的子节点", projectId, parentId: nodeId },
      })
    ).json();
    childId = child.id;
    await page.reload();
    await page.getByRole("button", { name: "编辑项目", exact: true }).click();
    await page.getByLabel("项目名称").fill(name + " 已更新");
    await page.getByLabel("项目状态").selectOption("归档");
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(page.locator(".page-heading h1")).toHaveText(name + " 已更新");
    await expect(page.locator(".project-state")).toHaveText("归档");
    await page.getByRole("button", { name: "编辑项目", exact: true }).click();
    await page.getByRole("button", { name: "删除项目…", exact: true }).click();
    await expect(page.getByText(/条记录将保留并移回收件箱/)).toBeVisible();
    await page
      .getByRole("button", { name: "确认删除项目", exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects$/);
    const detail = await (await request.get("/api/nodes/" + childId)).json();
    expect(detail.node.projectId).toBeNull();
    expect(detail.node.parentId).toBe(nodeId);
    await page.goto("/inbox");
    await expect(
      page.locator(".note-card h3").filter({ hasText: "项目内的原始记录" }),
    ).toBeVisible();
  } finally {
    if (childId) await request.delete("/api/nodes/" + childId);
    if (nodeId) await request.delete("/api/nodes/" + nodeId);
    if (projectId) await request.delete("/api/projects/" + projectId);
  }
});

test("测试连接不保存密钥；保存后 AI 自动分析并能保存子节点", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  await page
    .getByLabel("API 地址", { exact: true })
    .fill("http://127.0.0.1:3104/v1");
  await page.getByLabel("模型名称").fill("test-model");
  await page.getByLabel("API Key", { exact: true }).fill("test-only-secret");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator(".connection-result.success")).toContainText(
    "连接成功",
  );
  expect(
    (await (await request.get("/api/workspace")).json()).settings.configured,
  ).toBe(false);
  await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
  await expect(page.locator(".connection-status")).toContainText("已配置");
  const title = "自动分析验收 " + Date.now();
  let id = "";
  let childId = "";
  try {
    await page.goto("/home");
    await page.getByLabel("记录一个想法").fill(title);
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    await page
      .locator(".note-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .locator(".note-main")
      .click();
    await expect(page).toHaveURL(/\/node\/[a-f0-9-]+$/);
    id = page.url().split("/").pop()!;
    await expect(page.locator(".expansion")).toHaveCount(3, { timeout: 20000 });
    await page
      .getByRole("button", { name: "保存为新节点", exact: true })
      .first()
      .click();
    await expect(page.locator(".child-node")).toHaveCount(1);
    await page.locator(".action-item input").first().check();
    await expect(page.locator(".action-item input").first()).toBeEnabled();
    await page.reload();
    await expect(page.locator(".action-item input").first()).toBeChecked();
    const detail = await (await request.get("/api/nodes/" + id)).json();
    childId = detail.children[0].id;
    expect(detail.task.status).toBe("done");
  } finally {
    if (childId) await request.delete("/api/nodes/" + childId);
    if (id) await request.delete("/api/nodes/" + id);
  }
});

test("连接失败显示明确原因；处理中取消后不写入晚到结果", async ({
  page,
  request,
}) => {
  await request.put("/api/settings", {
    data: {
      baseUrl: "http://127.0.0.1:3104/v1",
      model: "test-model",
      apiKey: "test-only-secret",
    },
  });
  await page.goto("/settings");
  await page.getByLabel("模型名称").fill("invalid-model");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.locator(".connection-result.failure")).toContainText(
    "API Key 无效",
  );
  await page.getByLabel("模型名称").fill("slow-model");
  await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("AI 设置已保存");
  const node = await (
    await request.post("/api/nodes", { data: { content: "取消任务验收" } })
  ).json();
  try {
    await page.goto("/node/" + node.id);
    await expect(
      page.getByRole("button", { name: "取消任务", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消任务", exact: true }).click();
    await expect(page.locator(".task-progress")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "开始发散", exact: true }),
    ).toBeEnabled();
    const detail = await (await request.get("/api/nodes/" + node.id)).json();
    expect(detail.task.status).toBe("cancelled");
    expect(detail.node.analysis).toBeNull();
  } finally {
    await request.delete("/api/nodes/" + node.id);
    await request.put("/api/settings", {
      data: { baseUrl: "http://127.0.0.1:3104/v1", model: "test-model" },
    });
  }
});
