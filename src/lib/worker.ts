import { recoverLegacyTasks, runNextJob } from "./jobs";
import { db } from "./db";
type WorkerState = {
  timer?: ReturnType<typeof setInterval>;
  running?: Promise<void>;
};
const globalWorker = globalThis as unknown as { hubWorkerV2?: WorkerState };
const state = (globalWorker.hubWorkerV2 ??= {});
async function drain() {
  const deadline = Date.now() + 180_000;
  try {
    await recoverLegacyTasks();
    while (Date.now() < deadline) {
      if (await runNextJob()) continue;
      if (!process.env.VERCEL) break;
      const next = await db
        .prepare(
          "SELECT MIN(nextRunAt) AS due FROM ai_jobs WHERE status IN ('queued','retrying')",
        )
        .get();
      const delay = Number(next?.due) - Date.now();
      if (
        next?.due == null ||
        delay > 21_000 ||
        Date.now() + Math.max(0, delay) >= deadline
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, delay)));
    }
  } catch {
    console.error(
      "[AI queue] Worker failed; persisted jobs resume on the next request or scheduled invocation.",
    );
  }
}
export function startWorker() {
  if (
    process.env.VERCEL ||
    process.env.AI_WORKER_DISABLED === "1" ||
    state.timer
  )
    return;
  state.timer = setInterval(() => {
    void wakeWorker();
  }, 2000);
  state.timer.unref();
}
export async function wakeWorker() {
  if (process.env.AI_WORKER_DISABLED === "1") return;
  startWorker();
  // Return the work promise so Next after()/Vercel waitUntil keeps it alive.
  if (!state.running)
    state.running = drain().finally(() => {
      state.running = undefined;
    });
  await state.running;
}
