import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("草稿在刷新、页面切换和项目间独立保留，保存成功后清空", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", { data: { name: "草稿验收" } })
  ).json();
  let savedId = "";
  try {
    await page.goto("/inbox");
    await page.getByLabel("记录一个想法").fill("收件箱的未完成灵感");
    await page
      .locator(".composer-tools")
      .getByRole("button", { name: "链接", exact: true })
      .click();
    await page.getByLabel("链接地址").fill("https://example.com/draft");
    await page.getByLabel("上传图片").setInputFiles({
      name: "draft.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.getByText("图片已添加", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("记录一个想法")).toHaveValue(
      "收件箱的未完成灵感",
    );
    await expect(page.getByLabel("链接地址")).toHaveValue(
      "https://example.com/draft",
    );
    await expect(page.getByAltText("待保存图片")).toBeVisible();
    await page.goto(`/project/${project.id}`);
    await expect(page.getByLabel("记录一个想法")).toHaveValue("");
    await page.getByLabel("记录一个想法").fill("项目内的草稿");
    await page.goto("/settings");
    await page.goto(`/project/${project.id}`);
    await expect(page.getByLabel("记录一个想法")).toHaveValue("项目内的草稿");
    await page.route("**/api/nodes", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "模拟保存失败" }),
          })
        : route.continue(),
    );
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    await expect(page.getByText("模拟保存失败", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("记录一个想法")).toHaveValue("项目内的草稿");
    await page.unroute("**/api/nodes");
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/nodes") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    savedId = (await (await saved).json()).id;
    await expect(page.getByLabel("记录一个想法")).toHaveValue("");
    await page.reload();
    await expect(page.getByLabel("记录一个想法")).toHaveValue("");
    await page.goto("/inbox");
    await expect(page.getByLabel("记录一个想法")).toHaveValue(
      "收件箱的未完成灵感",
    );
  } finally {
    if (savedId) await request.delete(`/api/nodes/${savedId}`);
    await request.delete(`/api/projects/${project.id}`);
  }
});

test("浏览器存储不可用时提示，仍可继续输入", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page.goto("/inbox");
  await page.getByLabel("记录一个想法").fill("存储满时的内容");
  await expect(
    page.getByRole("status").filter({ hasText: "浏览器草稿保存失败" }),
  ).toBeVisible();
  await expect(page.getByLabel("记录一个想法")).toHaveValue("存储满时的内容");
});

test("完整备份下载、预览取消、合并导入和重复检测（含图片）", async ({
  page,
  request,
}) => {
  const id = randomUUID();
  const imageName = randomUUID() + ".png";
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const now = new Date().toISOString();
  const data = {
    format: "inspiration-hub",
    version: 2,
    exportedAt: now,
    projects: [],
    nodes: [
      {
        id,
        title: "从备份恢复的灵感",
        content: "含图片的恢复验收",
        type: "image",
        image: "/api/files/" + imageName,
        url: null,
        linkTitle: null,
        linkDescription: null,
        projectId: null,
        parentId: null,
        status: "未处理",
        tags: ["恢复"],
        favorite: true,
        createdAt: now,
        updatedAt: now,
        analysis: null,
        aiState: "pending",
        aiError: null,
        completedActions: [],
        sample: false,
      },
    ],
    images: [{ name: imageName, data: image }],
  };
  const file = {
    name: "full-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  };
  try {
    await page.goto("/settings");
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "完整备份（含图片）", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(
      /^inspiration-hub-full-.*\.json$/,
    );
    await page
      .getByLabel("选择完整备份文件", { exact: true })
      .setInputFiles(file);
    const preview = page.getByRole("region", { name: "恢复预览" });
    await expect(preview).toContainText("新增 1 条记录、0 个项目");
    expect((await request.get(`/api/nodes/${id}`)).status()).toBe(404);
    await preview.getByRole("button", { name: "取消", exact: true }).click();
    expect((await request.get(`/api/nodes/${id}`)).status()).toBe(404);
    await page
      .getByLabel("选择完整备份文件", { exact: true })
      .setInputFiles(file);
    await preview
      .getByRole("button", { name: "确认合并导入", exact: true })
      .click();
    await expect(page.getByText(/恢复完成：新增 1 条记录/)).toBeVisible();
    const detail = await (await request.get(`/api/nodes/${id}`)).json();
    expect(detail.node.aiState).toBe("idle");
    expect(detail.task).toBeNull();
    expect(await (await request.get(detail.node.image)).body()).toEqual(
      Buffer.from(image, "base64"),
    );
    await page
      .getByLabel("选择完整备份文件", { exact: true })
      .setInputFiles(file);
    await expect(preview).toContainText("跳过 1 条已有记录");
    await expect(
      preview.getByRole("button", { name: "确认合并导入", exact: true }),
    ).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/tmp/inspiration-backup-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await request.delete(`/api/nodes/${id}`);
  }
});
