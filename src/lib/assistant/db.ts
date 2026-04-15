import { Pool, type PoolClient, type PoolConfig } from 'pg';

let pool: Pool | null = null;
let schemaReady = false;
/** 保证全进程只跑一次迁移，避免并发请求在冷启动时并行 DDL 互相阻塞。 */
let schemaEnsureInFlight: Promise<void> | null = null;
let poolResetInFlight: Promise<void> | null = null;
let dbCooldownUntilMs = 0;

function isDbDebugEnabled() {
  return process.env.ASSISTANT_DEBUG_DB === '1';
}

function logDbDebug(message: string, meta?: Record<string, unknown>) {
  if (!isDbDebugEnabled()) {
    return;
  }

  if (meta) {
    console.log(`[assistant-db] ${message}`, meta);
    return;
  }

  console.log(`[assistant-db] ${message}`);
}

function isDbCoolingDown() {
  return Date.now() < dbCooldownUntilMs;
}

function markDbCooldown(reason: string, error?: unknown) {
  const cooldownMs = Math.max(1000, Number(process.env.PG_RECONNECT_COOLDOWN_MS ?? 120000));
  dbCooldownUntilMs = Date.now() + cooldownMs;
  logDbDebug('db cooldown activated', {
    reason,
    cooldownMs,
    error: error instanceof Error ? error.message : error ? String(error) : undefined
  });
}

const TASK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    role TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_type_label TEXT NOT NULL,
    question TEXT NOT NULL,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_template_id TEXT NULL,
    status TEXT NOT NULL,
    review_status TEXT NOT NULL,
    summary TEXT NOT NULL,
    pending_confirmation_count INTEGER NOT NULL DEFAULT 0,
    blocking_issue_count INTEGER NOT NULL DEFAULT 0,
    review_comment TEXT NULL,
    reviewed_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request JSONB NOT NULL,
    reply JSONB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    role TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_type_label TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'web',
    question TEXT NOT NULL,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_template_id TEXT NULL,
    status TEXT NOT NULL,
    review_status TEXT NOT NULL,
    summary TEXT NOT NULL,
    draft_direction TEXT NOT NULL DEFAULT '',
    next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
    pending_confirmation_count INTEGER NOT NULL DEFAULT 0,
    blocking_issue_count INTEGER NOT NULL DEFAULT 0,
    review_comment TEXT NULL,
    reviewed_by TEXT NULL,
    conversation_id TEXT NULL,
    user_id TEXT NULL,
    request_payload JSONB NOT NULL,
    reply_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_payload JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS task_execution_steps (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_id TEXT NOT NULL,
    name TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    PRIMARY KEY (task_id, step_index)
  );

  CREATE TABLE IF NOT EXISTS task_pending_confirmations (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    confirmation_index INTEGER NOT NULL,
    confirmation_id TEXT NOT NULL,
    label TEXT NOT NULL,
    reason TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (task_id, confirmation_index)
  );

  CREATE TABLE IF NOT EXISTS task_validation_issues (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    issue_index INTEGER NOT NULL,
    issue_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    PRIMARY KEY (task_id, issue_index)
  );

  CREATE TABLE IF NOT EXISTS task_artifacts (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    section_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (task_id, section_index)
  );

  CREATE TABLE IF NOT EXISTS task_audit_events (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    event_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, event_index)
  );

  CREATE TABLE IF NOT EXISTS task_reviews (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    comment TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_review_status ON tasks (review_status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id ON task_reviews (task_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_audit_events_task_id ON task_audit_events (task_id, created_at ASC);
`;

const TASK_MIGRATION_SQL = `
  INSERT INTO tasks (
    id, title, role, task_type, task_type_label, channel, question, files,
    selected_skill_ids, selected_template_id, status, review_status, summary,
    draft_direction, next_actions, risk_alerts, pending_confirmation_count,
    blocking_issue_count, review_comment, reviewed_by, conversation_id, user_id,
    request_payload, reply_payload, raw_payload, created_at, updated_at
  )
  SELECT
    tr.id,
    tr.title,
    tr.role,
    tr.task_type,
    tr.task_type_label,
    COALESCE(tr.request ->> 'channel', 'web'),
    tr.question,
    tr.files,
    tr.selected_skill_ids,
    tr.selected_template_id,
    tr.status,
    tr.review_status,
    tr.summary,
    COALESCE(tr.reply ->> 'draftDirection', ''),
    COALESCE(tr.reply -> 'nextActions', '[]'::jsonb),
    COALESCE(tr.reply -> 'riskAlerts', '[]'::jsonb),
    tr.pending_confirmation_count,
    tr.blocking_issue_count,
    tr.review_comment,
    tr.reviewed_by,
    tr.request ->> 'conversationId',
    tr.request ->> 'userId',
    tr.request,
    tr.reply,
    tr.request -> 'rawPayload',
    tr.created_at,
    tr.updated_at
  FROM task_runs tr
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO task_execution_steps (
    task_id, step_index, step_id, name, skill_id, status, summary
  )
  SELECT
    tr.id,
    step.ordinality - 1,
    step.item ->> 'id',
    step.item ->> 'name',
    step.item ->> 'skillId',
    step.item ->> 'status',
    step.item ->> 'summary'
  FROM task_runs tr
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tr.reply -> 'executionPlan', '[]'::jsonb)
  ) WITH ORDINALITY AS step(item, ordinality)
  ON CONFLICT (task_id, step_index) DO NOTHING;

  INSERT INTO task_pending_confirmations (
    task_id, confirmation_index, confirmation_id, label, reason, owner, status
  )
  SELECT
    tr.id,
    item.ordinality - 1,
    item.value ->> 'id',
    item.value ->> 'label',
    item.value ->> 'reason',
    item.value ->> 'owner',
    item.value ->> 'status'
  FROM task_runs tr
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tr.reply -> 'pendingConfirmations', '[]'::jsonb)
  ) WITH ORDINALITY AS item(value, ordinality)
  ON CONFLICT (task_id, confirmation_index) DO NOTHING;

  INSERT INTO task_validation_issues (
    task_id, issue_index, issue_id, severity, title, message
  )
  SELECT
    tr.id,
    item.ordinality - 1,
    item.value ->> 'id',
    item.value ->> 'severity',
    item.value ->> 'title',
    item.value ->> 'message'
  FROM task_runs tr
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tr.reply -> 'validationIssues', '[]'::jsonb)
  ) WITH ORDINALITY AS item(value, ordinality)
  ON CONFLICT (task_id, issue_index) DO NOTHING;

  INSERT INTO task_artifacts (
    task_id, section_index, title, kind, summary, fields
  )
  SELECT
    tr.id,
    item.ordinality - 1,
    item.value ->> 'title',
    item.value ->> 'kind',
    item.value ->> 'summary',
    COALESCE(item.value -> 'fields', '[]'::jsonb)
  FROM task_runs tr
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tr.reply -> 'artifacts', '[]'::jsonb)
  ) WITH ORDINALITY AS item(value, ordinality)
  ON CONFLICT (task_id, section_index) DO NOTHING;

  INSERT INTO task_audit_events (
    task_id, event_index, label, detail, created_at
  )
  SELECT
    tr.id,
    item.ordinality - 1,
    item.value ->> 'label',
    item.value ->> 'detail',
    tr.updated_at
  FROM task_runs tr
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tr.reply -> 'auditTrail', '[]'::jsonb)
  ) WITH ORDINALITY AS item(value, ordinality)
  ON CONFLICT (task_id, event_index) DO NOTHING;

  INSERT INTO task_reviews (task_id, decision, reviewer, comment, created_at)
  SELECT
    tr.id,
    tr.review_status,
    COALESCE(tr.reviewed_by, 'supervisor'),
    tr.review_comment,
    tr.updated_at
  FROM task_runs tr
  WHERE tr.review_status IN ('approved', 'returned')
    AND NOT EXISTS (
      SELECT 1
      FROM task_reviews reviews
      WHERE reviews.task_id = tr.id
        AND reviews.decision = tr.review_status
        AND reviews.created_at = tr.updated_at
    );
`;

function normalizeDatabaseUrl(value: string) {
  return value.replace(/^jdbc:/, '');
}

function getPoolConfig(): PoolConfig | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return {
      connectionString: normalizeDatabaseUrl(databaseUrl)
    };
  }

  const jdbcUrl =
    process.env.DATABASE_JDBC_URL?.trim() ??
    process.env.JDBC_DATABASE_URL?.trim();

  if (!jdbcUrl) {
    return null;
  }

  const normalizedUrl = new URL(normalizeDatabaseUrl(jdbcUrl));
  const database =
    process.env.PGDATABASE?.trim() ??
    process.env.DATABASE_NAME?.trim() ??
    'export_agent';

  return {
    host: normalizedUrl.hostname,
    port: normalizedUrl.port ? Number(normalizedUrl.port) : 5432,
    database,
    user:
      process.env.PGUSER?.trim() ??
      process.env.DATABASE_USERNAME?.trim() ??
      undefined,
    password:
      process.env.PGPASSWORD?.trim() ??
      process.env.DATABASE_PASSWORD?.trim() ??
      undefined
  };
}

export function hasDatabaseConfig() {
  return getPoolConfig() !== null && !isDbCoolingDown();
}

function getPool() {
  const config = getPoolConfig();

  if (!config) {
    throw new Error('未配置 PostgreSQL 连接信息。');
  }

  if (!pool) {
    const max = Number(process.env.PG_POOL_MAX ?? 20);
    const connectionTimeoutMillis = Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 15000);
    const idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000);
    const keepAliveInitialDelayMillis = Number(process.env.PG_KEEPALIVE_INITIAL_DELAY_MS ?? 10000);
    pool = new Pool({
      ...config,
      max: Number.isFinite(max) && max > 0 ? max : 20,
      idleTimeoutMillis:
        Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis >= 0 ? idleTimeoutMillis : 30000,
      connectionTimeoutMillis:
        Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
          ? connectionTimeoutMillis
          : 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis:
        Number.isFinite(keepAliveInitialDelayMillis) && keepAliveInitialDelayMillis >= 0
          ? keepAliveInitialDelayMillis
          : 10000
    });
    pool.on('error', (error) => {
      logDbDebug('pool client error', {
        error: error.message
      });
      // Let in-flight requests fail fast; next request path will re-create pool.
      void resetPool('pool-error', error);
    });
  }

  return pool;
}

function shouldResetPool(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = (error as { code?: string } | undefined)?.code?.toString().toUpperCase() ?? '';
  return (
    message.includes('connection terminated unexpectedly') ||
    message.includes('terminating connection') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection ended unexpectedly') ||
    message.includes('connection reset') ||
    message.includes('econnreset') ||
    code === '57P01' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE'
  );
}

async function resetPool(reason: string, error?: unknown) {
  if (poolResetInFlight) {
    await poolResetInFlight;
    return;
  }
  poolResetInFlight = (async () => {
    const existing = pool;
    pool = null;
    schemaReady = false;
    schemaEnsureInFlight = null;
    if (existing) {
      try {
        await existing.end();
      } catch {
        // ignore end errors during reset
      }
    }
    logDbDebug('pool reset', {
      reason,
      error: error instanceof Error ? error.message : error ? String(error) : undefined
    });
  })();
  try {
    await poolResetInFlight;
  } finally {
    poolResetInFlight = null;
  }
}

async function runTaskSchemaMigrationOnce() {
  const startedAt = Date.now();
  const currentPool = getPool();
  const client = await currentPool.connect();

  try {
    logDbDebug('schema migration start');
    await client.query('BEGIN');
    await client.query(TASK_SCHEMA_SQL);
    await client.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS reply_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await client.query(`
      UPDATE tasks
      SET reply_payload = '{}'::jsonb
      WHERE reply_payload IS NULL
    `);
    await client.query(TASK_MIGRATION_SQL);
    await client.query('COMMIT');
    logDbDebug('schema migration done', { elapsedMs: Date.now() - startedAt });
  } catch (error) {
    await client.query('ROLLBACK');
    logDbDebug('schema migration failed', {
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown error'
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureTaskSchema() {
  if (!hasDatabaseConfig() || schemaReady) {
    return;
  }

  if (!schemaEnsureInFlight) {
    schemaEnsureInFlight = (async () => {
      try {
        await runTaskSchemaMigrationOnce();
        schemaReady = true;
      } catch (error) {
        markDbCooldown('ensureTaskSchema', error);
        schemaEnsureInFlight = null;
        throw error;
      }
    })();
  }

  await schemaEnsureInFlight;
}

export async function queryDb<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<{ rows: T[] }> {
  const runQuery = async () => {
    await ensureTaskSchema();
    const currentPool = getPool();
    const result = await currentPool.query(text, values);
    return {
      rows: result.rows as T[]
    };
  };

  try {
    return await runQuery();
  } catch (error) {
    if (!shouldResetPool(error)) {
      markDbCooldown('queryDb-non-retryable', error);
      throw error;
    }
    await resetPool('queryDb', error);
    try {
      return await runQuery();
    } catch (retryError) {
      markDbCooldown('queryDb-retry-failed', retryError);
      throw retryError;
    }
  }
}

export async function withDbTransaction<T>(
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const runTxOnce = async () => {
    await ensureTaskSchema();
    const connectStartedAt = Date.now();
    const client = await getPool().connect();
    const lockTimeoutMs = Number(process.env.PG_LOCK_TIMEOUT_MS ?? 10000);
    const statementTimeoutMs = Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 60000);
    const txStartedAt = Date.now();

    try {
      logDbDebug('transaction client acquired', {
        connectElapsedMs: txStartedAt - connectStartedAt
      });
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${Math.max(1, lockTimeoutMs)}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${Math.max(1, statementTimeoutMs)}ms'`);
      const result = await run(client);
      await client.query('COMMIT');
      logDbDebug('transaction committed', { elapsedMs: Date.now() - txStartedAt });
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure on broken connections
      }
      logDbDebug('transaction rolled back', {
        elapsedMs: Date.now() - txStartedAt,
        error: error instanceof Error ? error.message : 'unknown error'
      });
      throw error;
    } finally {
      client.release();
    }
  };

  try {
    return await runTxOnce();
  } catch (error) {
    if (!shouldResetPool(error)) {
      markDbCooldown('withDbTransaction-non-retryable', error);
      throw error;
    }
    await resetPool('withDbTransaction', error);
    try {
      return await runTxOnce();
    } catch (retryError) {
      markDbCooldown('withDbTransaction-retry-failed', retryError);
      throw retryError;
    }
  }
}
