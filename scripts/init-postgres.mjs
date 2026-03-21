import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const DEFAULT_DATABASE = 'export_agent';

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
`;

function normalizeDatabaseUrl(value) {
  return value.replace(/^jdbc:/, '');
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(filename) {
  const filepath = path.resolve(process.cwd(), filename);

  if (!fs.existsSync(filepath)) {
    return;
  }

  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = stripWrappingQuotes(value);
  }
}

function readConnectionConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const parsed = new URL(normalizeDatabaseUrl(databaseUrl));
    const database =
      process.env.DATABASE_NAME?.trim() ||
      process.env.PGDATABASE?.trim() ||
      parsed.pathname.replace(/^\//, '') ||
      DEFAULT_DATABASE;

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      user: decodeURIComponent(parsed.username || process.env.PGUSER || ''),
      password: decodeURIComponent(parsed.password || process.env.PGPASSWORD || ''),
      database
    };
  }

  const jdbcUrl =
    process.env.DATABASE_JDBC_URL?.trim() ||
    process.env.JDBC_DATABASE_URL?.trim();

  if (!jdbcUrl) {
    throw new Error(
      '未提供 PostgreSQL 连接信息，请配置 DATABASE_URL 或 DATABASE_JDBC_URL。'
    );
  }

  const parsed = new URL(normalizeDatabaseUrl(jdbcUrl));
  const database =
    process.env.DATABASE_NAME?.trim() ||
    process.env.PGDATABASE?.trim() ||
    DEFAULT_DATABASE;

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user:
      process.env.DATABASE_USERNAME?.trim() ||
      process.env.PGUSER?.trim() ||
      '',
    password:
      process.env.DATABASE_PASSWORD?.trim() ||
      process.env.PGPASSWORD?.trim() ||
      '',
    database
  };
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function ensureDatabase(config) {
  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres'
  });

  await adminClient.connect();

  try {
    const result = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1',
      [config.database]
    );

    if (result.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(config.database)}`
      );
      console.log(`Created database: ${config.database}`);
    } else {
      console.log(`Database already exists: ${config.database}`);
    }
  } finally {
    await adminClient.end();
  }
}

async function ensureSchema(config) {
  const client = new Client(config);
  await client.connect();

  try {
    await client.query(TASK_SCHEMA_SQL);
    await client.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS reply_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_updated_at
      ON tasks (updated_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_review_status
      ON tasks (review_status, updated_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id
      ON task_reviews (task_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_audit_events_task_id
      ON task_audit_events (task_id, created_at ASC);
    `);
    console.log('Ensured tables: tasks, task_execution_steps, task_pending_confirmations, task_validation_issues, task_artifacts, task_audit_events, task_reviews');
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const config = readConnectionConfig();

  if (!config.user) {
    throw new Error('缺少数据库用户名，请配置 DATABASE_USERNAME 或 PGUSER。');
  }

  await ensureDatabase(config);
  await ensureSchema(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
