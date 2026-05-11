import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../health/route';

const ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_JDBC_URL',
  'JDBC_DATABASE_URL',
  'TASK_STORE_REQUIRE_DATABASE',
  'LOCAL_MODEL_API_URL',
  'LOCAL_OPENAI_API_URL',
  'B_MODEL_API_URL',
  'TRANSLATION_API_URL',
  'DASHSCOPE_API_URL',
  'MODELSCOPE_TRANSLATION_API_URL',
  'QWEN_TRANSLATION_BASE_URL',
  'MODELSCOPE_API_URL',
  'QWEN_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv.get(key);
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

function configureLocalTranslationModel() {
  process.env.LOCAL_MODEL_API_URL = 'http://127.0.0.1:11434/v1';
}

async function readHealth() {
  const response = GET();
  return response.json() as Promise<{
    status: string;
    taskStoreMode: string;
    taskStorePersistence: string;
    readiness: {
      degradedReasons: string[];
      checks: {
        taskStore: string;
        taskStoreRequiresDatabase: boolean;
        taskStorePersistence: string;
      };
    };
  }>;
}

test.afterEach(() => {
  resetEnv();
});

test('fallback-only task store is ready local-file mode when database is optional', async () => {
  resetEnv();
  process.env.DATABASE_URL = '';
  process.env.DATABASE_JDBC_URL = '';
  process.env.JDBC_DATABASE_URL = '';
  process.env.TASK_STORE_REQUIRE_DATABASE = '';
  configureLocalTranslationModel();

  const health = await readHealth();

  assert.equal(health.status, 'ok');
  assert.equal(health.taskStoreMode, 'fallback-only');
  assert.equal(health.taskStorePersistence, 'local-file');
  assert.equal(health.readiness.checks.taskStore, 'ok');
  assert.equal(health.readiness.checks.taskStoreRequiresDatabase, false);
  assert.equal(health.readiness.checks.taskStorePersistence, 'local-file');
  assert.ok(!health.readiness.degradedReasons.includes('task-store-fallback-only'));
});

test('fallback-only task store is degraded when database is explicitly required', async () => {
  resetEnv();
  process.env.DATABASE_URL = '';
  process.env.DATABASE_JDBC_URL = '';
  process.env.JDBC_DATABASE_URL = '';
  process.env.TASK_STORE_REQUIRE_DATABASE = '1';
  configureLocalTranslationModel();

  const health = await readHealth();

  assert.equal(health.status, 'degraded');
  assert.equal(health.taskStoreMode, 'fallback-only');
  assert.equal(health.readiness.checks.taskStore, 'error');
  assert.equal(health.readiness.checks.taskStoreRequiresDatabase, true);
  assert.ok(health.readiness.degradedReasons.includes('task-store-database-required'));
});
