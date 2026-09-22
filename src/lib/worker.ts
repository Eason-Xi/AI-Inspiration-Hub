import { recoverLegacyTasks, runNextJob } from "./jobs";
type WorkerState = { timer?: ReturnType<typeof setInterval>; busy: boolean };
const globalWorker = globalThis as unknown as { hubWorker?: WorkerState };
const state =
  globalWorker.hubWorker ?? (globalWorker.hubWorker = { busy: false });
async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    for (let i = 0; i < 10; i++) {
      if (!(await runNextJob())) break;
    }
  } catch {
    console.error(
      "[AI queue] Worker tick failed; pending jobs remain in the database.",
    );
  } finally {
    state.busy = false;
  }
}
export function startWorker() {
  if (process.env.AI_WORKER_DISABLED === "1" || state.timer) return;
  recoverLegacyTasks();
  state.timer = setInterval(() => {
    void tick();
  }, 2000);
  state.timer.unref();
}
export function wakeWorker() {
  startWorker();
  if (process.env.AI_WORKER_DISABLED !== "1") void tick();
}
