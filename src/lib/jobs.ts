import { db, getNode, patchNode, transaction } from "./db";
import { publicSettings } from "./settings";
import { analysisFingerprint, generateAnalysis } from "./ai";
import { ProviderError } from "./provider";
import { linkMetadata } from "./links";
import type { AiTask } from "./types";

type Job = AiTask & { leaseUntil: number | null; leaseToken: string | null };
export const JOB_LEASE_MS = 180000;
const active = ["queued", "running", "retrying"];
export function getTask(nodeId: string): AiTask | null {
  return (
    (db
      .prepare(
        "SELECT id,nodeId,mode,status,attempts,maxAttempts,nextRunAt,error FROM ai_jobs WHERE nodeId=?",
      )
      .get(nodeId) as AiTask | undefined) || null
  );
}
export function enqueueAnalysis(
  nodeId: string,
  mode = "默认",
  replace = false,
): AiTask | null {
  return transaction(() => {
    const node = getNode(nodeId);
    if (!node) return null;
    const previous = getTask(nodeId);
    if (previous && active.includes(previous.status) && !replace)
      return previous;
    if (!publicSettings().configured && !node.url) {
      if (previous) cancelTask(nodeId);
      patchNode(nodeId, { aiState: "idle", aiError: null });
      return null;
    }
    const now = Date.now();
    db.prepare(
      `INSERT INTO ai_jobs (id,nodeId,mode,status,attempts,maxAttempts,nextRunAt,createdAt,updatedAt)
      VALUES (?,?,?,'queued',0,3,?,?,?) ON CONFLICT(nodeId) DO UPDATE SET
      id=excluded.id,mode=excluded.mode,status='queued',attempts=0,nextRunAt=excluded.nextRunAt,
      leaseUntil=NULL,leaseToken=NULL,error=NULL,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt`,
    ).run(crypto.randomUUID(), nodeId, mode, now, now, now);
    patchNode(nodeId, { aiState: "pending", aiError: null });
    return getTask(nodeId);
  });
}
export function cancelTask(nodeId: string) {
  return transaction(() => {
    const result = db
      .prepare(
        "UPDATE ai_jobs SET status='cancelled',leaseUntil=NULL,leaseToken=NULL,error=NULL,updatedAt=? WHERE nodeId=? AND status IN ('queued','running','retrying')",
      )
      .run(Date.now(), nodeId);
    const node = getNode(nodeId);
    if (result.changes && node)
      patchNode(nodeId, {
        aiState: node.analysis ? "done" : "idle",
        aiError: null,
      });
    return getTask(nodeId);
  });
}
export function recoverLegacyTasks() {
  // Adopt interrupted v0.1 jobs once. Existing terminal jobs are never re-run automatically.
  const rows = db
    .prepare(
      "SELECT id FROM nodes WHERE json_extract(payload,'$.aiState')='pending' AND NOT EXISTS(SELECT 1 FROM ai_jobs WHERE nodeId=nodes.id)",
    )
    .all() as { id: string }[];
  for (const row of rows) enqueueAnalysis(row.id);
}
export function claimNextJob(now = Date.now()): Job | null {
  return transaction(() => {
    const expired = db
      .prepare(
        "SELECT nodeId,attempts,maxAttempts FROM ai_jobs WHERE status='running' AND leaseUntil<=?",
      )
      .all(now) as { nodeId: string; attempts: number; maxAttempts: number }[];
    for (const job of expired) {
      const failed = job.attempts >= job.maxAttempts;
      const error = failed
        ? "任务多次中断，请手动重试"
        : "上次运行中断，正在恢复任务";
      db.prepare(
        "UPDATE ai_jobs SET status=?,nextRunAt=?,leaseUntil=NULL,leaseToken=NULL,error=?,updatedAt=? WHERE nodeId=?",
      ).run(failed ? "failed" : "retrying", now, error, now, job.nodeId);
      patchNode(job.nodeId, {
        aiState: failed ? "error" : "pending",
        aiError: failed ? error : null,
      });
    }
    const job = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE status IN ('queued','retrying') AND nextRunAt<=? AND attempts<maxAttempts ORDER BY nextRunAt,createdAt LIMIT 1",
      )
      .get(now) as Job | undefined;
    if (!job) return null;
    const leaseToken = crypto.randomUUID();
    db.prepare(
      "UPDATE ai_jobs SET status='running',attempts=attempts+1,leaseToken=?,leaseUntil=?,updatedAt=? WHERE id=?",
    ).run(leaseToken, now + JOB_LEASE_MS, now, job.id);
    patchNode(job.nodeId, { aiState: "pending", aiError: null });
    return {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      leaseToken,
      leaseUntil: now + JOB_LEASE_MS,
    };
  });
}
function ownsLease(job: Job) {
  return !!db
    .prepare(
      "SELECT id FROM ai_jobs WHERE id=? AND leaseToken=? AND status='running' AND leaseUntil>?",
    )
    .get(job.id, job.leaseToken, Date.now());
}
function finish(
  job: Job,
  status: string,
  error: string | null = null,
  nextRunAt = Date.now(),
) {
  db.prepare(
    "UPDATE ai_jobs SET status=?,error=?,nextRunAt=?,leaseToken=NULL,leaseUntil=NULL,updatedAt=? WHERE id=? AND leaseToken=?",
  ).run(status, error, nextRunAt, Date.now(), job.id, job.leaseToken);
}
export async function runNextJob(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  let fingerprint = "";
  const heartbeat = setInterval(() => {
    try {
      db.prepare(
        "UPDATE ai_jobs SET leaseUntil=? WHERE id=? AND leaseToken=? AND status='running'",
      ).run(Date.now() + JOB_LEASE_MS, job.id, job.leaseToken);
    } catch {
      /* Another worker can recover an expired lease. */
    }
  }, 30000);
  heartbeat.unref();
  try {
    let node = getNode(job.nodeId);
    if (!node) return true;
    if (node.url && !node.linkTitle) {
      try {
        const metadata = await linkMetadata(node.url);
        if (!ownsLease(job)) return true;
        if (getNode(node.id)?.url === node.url)
          patchNode(node.id, {
            ...metadata,
            ...(node.type === "link" &&
            (node.title === new URL(node.url).hostname ||
              node.title === node.url.slice(0, 72))
              ? { title: metadata.linkTitle.slice(0, 160) }
              : {}),
          });
      } catch {
        /* A protected or offline link should not block idea analysis. */
      }
    }
    if (!ownsLease(job)) return true;
    node = getNode(job.nodeId);
    if (!node) return true;
    fingerprint = analysisFingerprint(node);
    const analysis = publicSettings().configured
      ? await generateAnalysis(node, job.mode)
      : null;
    transaction(() => {
      if (!ownsLease(job)) return;
      const latest = getNode(job.nodeId);
      if (!latest) return;
      if (analysisFingerprint(latest) !== fingerprint) {
        enqueueAnalysis(job.nodeId, job.mode, true);
        return;
      }
      if (analysis)
        patchNode(job.nodeId, {
          analysis,
          tags: [...new Set([...latest.tags, ...analysis.tags])].slice(0, 20),
          completedActions: [],
          aiState: "done",
          aiError: null,
        });
      else
        patchNode(job.nodeId, {
          aiState: latest.analysis ? "done" : "idle",
          aiError: null,
        });
      finish(job, "done");
    });
  } catch (error) {
    transaction(() => {
      if (!ownsLease(job)) return;
      const latest = getNode(job.nodeId);
      if (!latest) return;
      if (fingerprint && analysisFingerprint(latest) !== fingerprint) {
        enqueueAnalysis(job.nodeId, job.mode, true);
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
      finish(
        job,
        retry ? "retrying" : "failed",
        message,
        Date.now() + (retry ? 5000 * 4 ** (job.attempts - 1) : 0),
      );
      patchNode(job.nodeId, {
        aiState: retry ? "pending" : "error",
        aiError: retry ? null : message,
      });
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
