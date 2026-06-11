import { randomUUID } from "crypto";
import { sqlite } from "./db";

export type SchedulerJobType =
  | "research"
  | "product_sync"
  | "auto_generate"
  | "photo_analysis"
  | "chunk_rebuild"
  | "benchmark"
  | "content_refresh";

export type SchedulerTriggerType = "scheduled" | "manual";

export interface SchedulerJobLease {
  ownerId: string;
  runId: string;
}

export const SCHEDULER_LOCK_TTL_MS = 30 * 60 * 1000;
const INSTANCE_ID = `${process.pid}-${randomUUID()}`;

function nowMs(): number {
  return Date.now();
}

type RawLockRow = {
  company_id: string;
  job_type: string;
  owner_id: string;
  expires_at: number;
};

function insertJobRun(input: {
  companyId: string;
  jobType: SchedulerJobType;
  triggerType: SchedulerTriggerType;
  status: "running" | "skipped";
  ownerId?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}): string {
  const runId = randomUUID();
  const now = nowMs();
  sqlite.prepare(`
    INSERT INTO company_job_runs (
      id, company_id, job_type, trigger_type, status, owner_id,
      started_at, completed_at, duration_ms, result, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    input.companyId,
    input.jobType,
    input.triggerType,
    input.status,
    input.ownerId || null,
    now,
    input.status === "running" ? null : now,
    input.status === "running" ? null : 0,
    input.result ? JSON.stringify(input.result) : null,
    input.error || null,
  );
  return runId;
}

function markRunningLeaseExpired(
  companyId: string,
  jobType: SchedulerJobType,
  ownerId: string,
  now: number,
  error = "Scheduler job lease expired before the worker completed.",
): void {
  sqlite.prepare(`
    UPDATE company_job_runs
    SET status = 'failed',
        completed_at = ?,
        duration_ms = ? - started_at,
        error = COALESCE(error, ?)
    WHERE company_id = ?
      AND job_type = ?
      AND owner_id = ?
      AND status = 'running'
  `).run(now, now, error, companyId, jobType, ownerId);
}

export function beginSchedulerJob(
  companyId: string,
  jobType: SchedulerJobType,
  triggerType: SchedulerTriggerType,
  ttlMs = SCHEDULER_LOCK_TTL_MS,
): SchedulerJobLease | null {
  const acquire = sqlite.transaction(() => {
    const ownerId = `${INSTANCE_ID}:${jobType}:${randomUUID()}`;
    const now = nowMs();
    const expires = now + ttlMs;
    const previous = sqlite.prepare(`
      SELECT company_id, job_type, owner_id, expires_at
      FROM company_job_locks
      WHERE company_id = ? AND job_type = ?
      LIMIT 1
    `).get(companyId, jobType) as RawLockRow | undefined;

    const result = sqlite.prepare(`
      INSERT INTO company_job_locks (
        id, company_id, job_type, owner_id, acquired_at, heartbeat_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, job_type) DO UPDATE SET
        owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at
      WHERE company_job_locks.expires_at <= ?
    `).run(randomUUID(), companyId, jobType, ownerId, now, now, expires, now);

    if (result.changes === 0) {
      insertJobRun({
        companyId,
        jobType,
        triggerType,
        status: "skipped",
        result: { skipped: true, reason: "locked" },
        error: "Another worker already holds this company/job lock.",
      });
      return null;
    }

    if (previous && previous.expires_at <= now && previous.owner_id !== ownerId) {
      markRunningLeaseExpired(
        companyId,
        jobType,
        previous.owner_id,
        now,
        `Scheduler job lease expired and was acquired by ${ownerId}.`,
      );
    }

    const runId = insertJobRun({
      companyId,
      jobType,
      triggerType,
      status: "running",
      ownerId,
    });

    return { ownerId, runId };
  });

  return acquire();
}

export function completeSchedulerJob(
  companyId: string,
  jobType: SchedulerJobType,
  lease: SchedulerJobLease,
  status: "completed" | "failed",
  result?: Record<string, unknown>,
  error?: string | null,
): boolean {
  const finish = sqlite.transaction(() => {
    const now = nowMs();
    if (status === "completed") {
      const activeLease = sqlite.prepare(`
        SELECT owner_id
        FROM company_job_locks
        WHERE company_id = ? AND job_type = ? AND owner_id = ?
        LIMIT 1
      `).get(companyId, jobType, lease.ownerId);

      if (!activeLease) {
        sqlite.prepare(`
          UPDATE company_job_runs
          SET status = 'failed',
              completed_at = ?,
              duration_ms = ? - started_at,
              error = COALESCE(error, ?)
          WHERE id = ? AND status = 'running'
        `).run(now, now, "Scheduler job lease was lost before completion.", lease.runId);
        return false;
      }
    }

    const update = sqlite.prepare(`
      UPDATE company_job_runs
      SET status = ?,
          completed_at = ?,
          duration_ms = ? - started_at,
          result = ?,
          error = ?
      WHERE id = ? AND status = 'running'
    `).run(
      status,
      now,
      now,
      result ? JSON.stringify(result) : null,
      error || null,
      lease.runId,
    );
    return update.changes > 0;
  });

  return finish();
}

export function releaseSchedulerJobLock(companyId: string, jobType: SchedulerJobType, lease: SchedulerJobLease): void {
  sqlite.prepare(`
    DELETE FROM company_job_locks
    WHERE company_id = ? AND job_type = ? AND owner_id = ?
  `).run(companyId, jobType, lease.ownerId);
}

export function renewSchedulerJobLease(
  companyId: string,
  jobType: SchedulerJobType,
  lease: SchedulerJobLease,
  ttlMs = SCHEDULER_LOCK_TTL_MS,
): boolean {
  const now = nowMs();
  const result = sqlite.prepare(`
    UPDATE company_job_locks
    SET heartbeat_at = ?,
        expires_at = ?
    WHERE company_id = ?
      AND job_type = ?
      AND owner_id = ?
  `).run(now, now + ttlMs, companyId, jobType, lease.ownerId);
  return result.changes > 0;
}

export function listSchedulerJobRuns(companyId: string, limit = 25): Array<Record<string, unknown>> {
  const rows = sqlite.prepare(`
    SELECT id, company_id, job_type, trigger_type, status, owner_id,
           started_at, completed_at, duration_ms, result, error
    FROM company_job_runs
    WHERE company_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(companyId, Math.min(Math.max(Math.floor(limit), 1), 100)) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    jobType: row.job_type,
    triggerType: row.trigger_type,
    status: row.status,
    ownerId: row.owner_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    result: typeof row.result === "string" && row.result ? JSON.parse(row.result) : null,
    error: row.error,
  }));
}

export function clearExpiredSchedulerLocks(companyId?: string, now = nowMs()): number {
  const cleanup = sqlite.transaction(() => {
    const rows = (companyId
      ? sqlite.prepare(`
          SELECT company_id, job_type, owner_id, expires_at
          FROM company_job_locks
          WHERE company_id = ? AND expires_at <= ?
        `).all(companyId, now)
      : sqlite.prepare(`
          SELECT company_id, job_type, owner_id, expires_at
          FROM company_job_locks
          WHERE expires_at <= ?
        `).all(now)) as RawLockRow[];

    for (const row of rows) {
      markRunningLeaseExpired(
        row.company_id,
        row.job_type as SchedulerJobType,
        row.owner_id,
        now,
      );
    }

    const result = companyId
      ? sqlite.prepare("DELETE FROM company_job_locks WHERE company_id = ? AND expires_at <= ?").run(companyId, now)
      : sqlite.prepare("DELETE FROM company_job_locks WHERE expires_at <= ?").run(now);
    return result.changes;
  });
  return cleanup();
}
