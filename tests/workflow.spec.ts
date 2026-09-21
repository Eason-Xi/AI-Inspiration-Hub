import { test, expect } from "@playwright/test";
test("文字记录 → 编辑归类 → 收藏 → 搜索 → 归档恢复 → 删除", async ({
  page,
  request,
}) => {
  const title = "浏览器验收 " + Date.now();
  let id = "";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/home");
    await page
      .getByLabel("记录一个想法")
      .fill(title + "\n帮助访谈者准备更好的问题。");
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    const card = page
      .locator(".note-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toBeVisible();
    await card.locator(".note-main").click();
    await expect(page.locator(".detail-paper h1")).toHaveText(title);
    id = page.url().split("/").pop()!;
    await page.getByRole("button", { name: "编辑记录", exact: true }).click();
    await page.getByLabel("标签（逗号分隔）").fill("浏览器验收，访谈");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.locator(".edit-form")).toHaveCount(0);
    await page.getByLabel("所属项目").selectOption({ label: "AI 访谈助手" });
    await expect(
      page.getByLabel("所属项目").locator("option:checked"),
    ).toHaveText("AI 访谈助手");
    await page.getByLabel("当前状态").selectOption("待行动");
    await expect(page.getByLabel("当前状态")).toHaveValue("待行动");
    await page.getByRole("button", { name: "收藏记录", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "取消收藏", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("当前状态")).toHaveValue("待行动");
    await expect(page.locator(".detail-tags")).toContainText("浏览器验收");
    await page.getByLabel("搜索所有记录").fill(title);
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator(".note-card")).toHaveCount(1);
    await expect(page.locator(".note-card h3")).toHaveText(title);
    await page.locator(".note-main").click();
    await page.getByRole("button", { name: "归档记录", exact: true }).click();
    await expect(page.getByLabel("当前状态")).toHaveValue("归档");
    await page.getByRole("button", { name: "恢复记录", exact: true }).click();
    await expect(page.getByLabel("当前状态")).toHaveValue("未处理");
    await page.getByRole("button", { name: "删除记录", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page).toHaveURL(/\/all/);
    expect((await request.get("/api/nodes/" + id)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    if (id) await request.delete("/api/nodes/" + id);
  }
});
test("图片与链接保存、手机布局与导航", async ({ page, request }) => {
  const title = "图片验收 " + Date.now();
  let id = "";
  try {
    await page.goto("/home");
    await page.getByLabel("记录一个想法").fill(title);
    await page.getByLabel("上传图片").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.getByText("图片已添加")).toBeVisible();
    await page
      .locator(".composer-tools")
      .getByRole("button", { name: "链接", exact: true })
      .click();
    await page.getByLabel("链接地址").fill("https://example.com");
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    const card = page
      .locator(".note-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.locator(".note-main").click();
    await expect(page.locator(".detail-image img")).toBeVisible();
    await expect(page).toHaveURL(/\/node\/[a-f0-9-]+$/);
    id = page.url().split("/").pop()!;
    await expect(page.locator(".detail-link")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    await page.reload();
    await expect(page.locator(".detail-image img")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    await expect(page.getByLabel("记录一个想法")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "打开导航" }).click();
    await expect(page.locator(".sidebar")).toHaveClass(/is-open/);
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "AI 模型连接" }),
    ).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -236, 0)");
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true, animations: "disabled" });
  } finally {
    if (id) await request.delete("/api/nodes/" + id);
  }
});
test("输入校验、跨站保护、密钥不泄露", async ({ request }) => {
  expect(
    (await request.post("/api/nodes", { data: { content: " " } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/nodes", {
        data: { content: "hello" },
        headers: { Origin: "https://example.org" },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get("/api/workspace?view=all")).status()).toBe(200);
  const data = await (await request.get("/api/workspace")).json();
  expect(data.settings.apiKey).toBeUndefined();
});
