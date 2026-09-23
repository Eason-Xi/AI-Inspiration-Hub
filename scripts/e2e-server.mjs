import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Browser tests never use the user's data directory or real model credentials.
const dataDir = mkdtempSync(path.join(tmpdir(), "inspiration-e2e-"));
const model = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    if (payload.model === "invalid-model") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    const probe = typeof payload.messages[1].content === "string";
    const input = probe ? {} : JSON.parse(payload.messages[1].content[0].text);
    const answer = probe
      ? { ok: true }
      : {
          summary: `关于「${input.title}」的探索`,
          tags: ["AI", "访谈"],
          category: "产品想法",
          expansions: [
            {
              title: "目标用户验证",
              content: "访问 3 位目标用户，记录他们准备访谈时最耗时的步骤。",
            },
            {
              title: "最小原型",
              content: "制作一页嘉宾资料和问题清单，请一位用户完成准备任务。",
            },
            {
              title: "验证收益",
              content: "比较原型与原流程的准备耗时，并收集使用反馈。",
            },
          ],
          actions: ["联系 3 位访谈者", "制作一页问题清单"],
        };
    if (!probe)
      await new Promise((resolve) =>
        setTimeout(resolve, payload.model === "slow-model" ? 5000 : 200),
      );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
    );
  } catch {
    res.writeHead(400);
    res.end("{}");
  }
});
await new Promise((resolve, reject) => {
  model.once("error", reject);
  model.listen(3104, "127.0.0.1", resolve);
});
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3103",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TEST_BUILD: "1",
      STORAGE_BACKEND: "local",
      APP_PASSWORD: "",
      VERCEL: "",
      DATA_DIR: dataDir,
      AI_API_KEY: "",
      AI_BASE_URL: "http://127.0.0.1:3104/v1",
      AI_MODEL: "test-model",
      AI_WORKER_DISABLED: "0",
    },
  },
);
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  child.kill("SIGTERM");
  model.close();
  setTimeout(() => child.kill("SIGKILL"), 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => {
  model.closeAllConnections();
  model.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(closing ? 0 : code || 0);
});
