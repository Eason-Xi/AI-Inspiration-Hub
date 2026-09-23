import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/lib/access";
import { assertStorageConfiguration } from "../src/lib/environment";
import { postgresParameters } from "../src/lib/sql";

test("本地请求使用 Host 校验来源，拒绝跨站与非本机访问", () => {
  const request = (origin: string, host = "127.0.0.1:3103") =>
    new Request("http://localhost:3103/api/nodes", {
      headers: { host, origin },
    });
  assert.equal(authorize(request("http://127.0.0.1:3103")), null);
  assert.equal(authorize(request("https://evil.example"))?.status, 403);
  assert.equal(authorize(request("invalid"))?.status, 403);
  assert.equal(
    authorize(request("https://remote.example", "remote.example"))?.status,
    403,
  );
});
test("Vercel 缺配置时关闭访问；正确密码才允许访问图片、备份和设置", () => {
  const before = { ...process.env };
  try {
    process.env.VERCEL = "1";
    delete process.env.APP_PASSWORD;
    assert.equal(
      authorize(new Request("https://app.example/home"))?.status,
      503,
    );
    assert.throws(assertStorageConfiguration, /STORAGE_BACKEND/);
    process.env.APP_PASSWORD = "test-password-with-32-characters!";
    for (const route of [
      "/home",
      "/api/settings",
      "/api/backup",
      "/api/files/a.png",
    ]) {
      assert.equal(
        authorize(new Request("https://app.example" + route))?.status,
        401,
      );
      const authorization: string =
        "Basic " +
        Buffer.from("owner:" + process.env.APP_PASSWORD).toString("base64");
      assert.equal(
        authorize(
          new Request("https://app.example" + route, {
            headers: { authorization },
          }),
        ),
        null,
      );
    }
  } finally {
    delete process.env.VERCEL;
    delete process.env.APP_PASSWORD;
    Object.assign(process.env, before);
  }
});
test("PostgreSQL 参数转换保留 SQL 字面量中的问号", () => {
  assert.equal(
    postgresParameters(
      "SELECT '?' AS text WHERE id=? AND title='it''s ?' AND status=?",
    ),
    "SELECT '?' AS text WHERE id=$1 AND title='it''s ?' AND status=$2",
  );
});
