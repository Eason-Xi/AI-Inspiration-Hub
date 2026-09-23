import { db, getNode, patchNode, transaction, dialect } from "./db";
import { publicSettings } from "./settings";
import { analysisFingerprint, generateAnalysis } from "./ai";
import { ProviderError } from "./provider";
import { linkMetadata } from "./links";
import type { AiTask } from "./types";

type Job = AiTask & { leaseUntil: number | null; leaseToken: string | null };
export const JOB_LEASE_MS = 180000;
const active = ["queued", "running", "retrying"];
export async function getTask(nodeId: string): Promise<AiTask | null> {
  return (
    ((await db
      .prepare(
        "SELECT id,nodeId,mode,status,attempts,maxAttempts,nextRunAt,error FROM ai_jobs WHERE nodeId=?",
      )
      .get(nodeId)) as AiTask | undefined) || null
  );
}
export async function enqueueAnalysis(
  nodeId: string,
  mode = "默认",
  replace = false,
): Promise<AiTask | null> {
  return await transaction(async () => {
    const node = await getNode(nodeId);
    if (!node) return null;
    const previous = await getTask(nodeId);
    if (previous && active.includes(previous.status) && !replace)
      return previous;
    if (!(await publicSettings()).configured && !node.url) {
      if (previous) await cancelTask(nodeId);
      await patchNode(nodeId, { aiState: "idle", aiError: null });
      return null;
    }
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO ai_jobs (id,nodeId,mode,status,attempts,maxAttempts,nextRunAt,createdAt,updatedAt)
      VALUES (?,?,?,'queued',0,3,?,?,?) ON CONFLICT(nodeId) DO UPDATE SET
      id=excluded.id,mode=excluded.mode,status='queued',attempts=0,nextRunAt=excluded.nextRunAt,
      leaseUntil=NULL,leaseToken=NULL,error=NULL,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt`,
      )
      .run(crypto.randomUUID(), nodeId, mode, now, now, now);
    await patchNode(nodeId, { aiState: "pending", aiError: null });
    return await getTask(nodeId);
  });
}
export async function cancelTask(nodeId: string) {
  return await transaction(async () => {
    const result = await db
      .prepare(
        "UPDATE ai_jobs SET status='cancelled',leaseUntil=NULL,leaseToken=NULL,error=NULL,updatedAt=? WHERE nodeId=? AND status IN ('queued','running','retrying')",
      )
      .run(Date.now(), nodeId);
    const node = await getNode(nodeId);
    if (result.changes && node)
      await patchNode(nodeId, {
        aiState: node.analysis ? "done" : "idle",
        aiError: null,
      });
    return await getTask(nodeId);
  });
}
export async function recoverLegacyTasks() {
  // Adopt interrupted v0.1 jobs once. Existing terminal jobs are never re-run automatically.
  const rows = (await db
    .prepare(
      `SELECT id FROM nodes WHERE ${dialect("json_extract(payload,'$.aiState')", "payload::jsonb->>'aiState'")}='pending' AND NOT EXISTS(SELECT 1 FROM ai_jobs WHERE nodeId=nodes.id)`,
    )
    .all()) as { id: string }[];
  for (const row of rows) await enqueueAnalysis(row.id);
}
export async function claimNextJob(now = Date.now()): Promise<Job | null> {
  return await transaction(async () => {
    const expired = (await db
      .prepare(
        "SELECT nodeId,attempts,maxAttempts FROM ai_jobs WHERE status='running' AND leaseUntil<=?",
      )
      .all(now)) as { nodeId: string; attempts: number; maxAttempts: number }[];
    for (const job of expired) {
      const failed = job.attempts >= job.maxAttempts;
      const error = failed
        ? "任务多次中断，请手动重试"
        : "上次运行中断，正在恢复任务";
      await db
        .prepare(
          "UPDATE ai_jobs SET status=?,nextRunAt=?,leaseUntil=NULL,leaseToken=NULL,error=?,updatedAt=? WHERE nodeId=?",
        )
        .run(failed ? "failed" : "retrying", now, error, now, job.nodeId);
      await patchNode(job.nodeId, {
        aiState: failed ? "error" : "pending",
        aiError: failed ? error : null,
      });
    }
    const job = (await db
      .prepare(
        "SELECT * FROM ai_jobs WHERE status IN ('queued','retrying') AND nextRunAt<=? AND attempts<maxAttempts ORDER BY nextRunAt,createdAt LIMIT 1",
      )
      .get(now)) as Job | undefined;
    if (!job) return null;
    const leaseToken = crypto.randomUUID();
    await db
      .prepare(
        "UPDATE ai_jobs SET status='running',attempts=attempts+1,leaseToken=?,leaseUntil=?,updatedAt=? WHERE id=?",
      )
      .run(leaseToken, now + JOB_LEASE_MS, now, job.id);
    await patchNode(job.nodeId, { aiState: "pending", aiError: null });
    return {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      leaseToken,
      leaseUntil: now + JOB_LEASE_MS,
    };
  });
}
async function ownsLease(job: Job) {
  return !!(await db
    .prepare(
      "SELECT id FROM ai_jobs WHERE id=? AND leaseToken=? AND status='running' AND leaseUntil>?",
    )
    .get(job.id, job.leaseToken, Date.now()));
}
async function finish(
  job: Job,
  status: string,
  error: string | null = null,
  nextRunAt = Date.now(),
) {
  await db
    .prepare(
      "UPDATE ai_jobs SET status=?,error=?,nextRunAt=?,leaseToken=NULL,leaseUntil=NULL,updatedAt=? WHERE id=? AND leaseToken=?",
    )
    .run(status, error, nextRunAt, Date.now(), job.id, job.leaseToken);
}
export async function runNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  let fingerprint = "";
  const heartbeat = setInterval(async () => {
    try {
      await db
        .prepare(
          "UPDATE ai_jobs SET leaseUntil=? WHERE id=? AND leaseToken=? AND status='running'",
        )
        .run(Date.now() + JOB_LEASE_MS, job.id, job.leaseToken);
    } catch {
      /* Another worker can recover an expired lease. */
    }
  }, 30000);
  heartbeat.unref();
  try {
    let node = await getNode(job.nodeId);
    if (!node) return true;
    if (node.url && !node.linkTitle) {
      try {
        const metadata = await linkMetadata(node.url);
        const source = node;
        await transaction(async () => {
          if (!(await ownsLease(job))) return;
          const latest = await getNode(source.id);
          if (!latest || latest.url !== source.url) return;
          await patchNode(latest.id, {
            ...metadata,
            ...(latest.type === "link" &&
            (latest.title === new URL(source.url!).hostname ||
              latest.title === source.url!.slice(0, 72))
              ? { title: metadata.linkTitle.slice(0, 160) }
              : {}),
          });
        });
      } catch {
        /* A protected or offline link should not block idea analysis. */
      }
    }
    if (!(await ownsLease(job))) return true;
    node = await getNode(job.nodeId);
    if (!node) return true;
    fingerprint = await analysisFingerprint(node);
    const analysis = (await publicSettings()).configured
      ? await generateAnalysis(node, job.mode)
      : null;
    await transaction(async () => {
      if (!(await ownsLease(job))) return;
      const latest = await getNode(job.nodeId);
      if (!latest) return;
      if ((await analysisFingerprint(latest)) !== fingerprint) {
        await enqueueAnalysis(job.nodeId, job.mode, true);
        return;
      }
      if (analysis)
        await patchNode(job.nodeId, {
          analysis,
          tags: [...new Set([...latest.tags, ...analysis.tags])].slice(0, 20),
          completedActions: [],
          aiState: "done",
          aiError: null,
        });
      else
        await patchNode(job.nodeId, {
          aiState: latest.analysis ? "done" : "idle",
          aiError: null,
        });
      await finish(job, "done");
    });
  } catch (error) {
    await transaction(async () => {
      if (!(await ownsLease(job))) return;
      const latest = await getNode(job.nodeId);
      if (!latest) return;
      if (fingerprint && (await analysisFingerprint(latest)) !== fingerprint) {
        await enqueueAnalysis(job.nodeId, job.mode, true);
        return;
      }
      const message =
        error instanceof ProviderError
          ? error.message
          : "分析暂时失败，请稍后重试";
      const retry =
        error instanceof ProviderError &&
        error.retryable &&
        job.attempts < job.maxAttempts;
      await finish(
        job,
        retry ? "retrying" : "failed",
        message,
        Date.now() + (retry ? 5000 * 4 ** (job.attempts - 1) : 0),
      );
      await patchNode(job.nodeId, {
        aiState: retry ? "pending" : "error",
        aiError: retry ? null : message,
      });
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
