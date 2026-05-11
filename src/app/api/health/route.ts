import { NextResponse } from 'next/server';
import { hasDatabaseConfig } from '@/lib/assistant/db';
import {
  getTranslationModelName,
  isTranslationModelConfigured
} from '@/lib/assistant/qwen-client';

function isEnabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function hasDatabaseEnv() {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.DATABASE_JDBC_URL?.trim() ||
      process.env.JDBC_DATABASE_URL?.trim()
  );
}

function isDatabaseAvailable(databaseConfigured: boolean) {
  if (!databaseConfigured) {
    return false;
  }

  try {
    return hasDatabaseConfig();
  } catch {
    return false;
  }
}

export function GET() {
  const databaseConfigured = hasDatabaseEnv();
  const databaseRequired = isEnabled(process.env.TASK_STORE_REQUIRE_DATABASE);
  const databaseAvailable = isDatabaseAvailable(databaseConfigured);
  const taskStoreMode = databaseConfigured
    ? databaseAvailable
      ? 'database-or-fallback'
      : 'database-unavailable-fallback'
    : 'fallback-only';
  const taskStorePersistence = databaseAvailable ? 'database-primary' : 'local-file';
  const taskStoreCheck =
    databaseRequired && !databaseAvailable
      ? 'error'
      : databaseConfigured && !databaseAvailable
        ? 'warning'
        : 'ok';
  const translationModelConfigured = isTranslationModelConfigured();
  const degradedReasons = [
    databaseRequired && !databaseAvailable ? 'task-store-database-required' : '',
    !databaseRequired && databaseConfigured && !databaseAvailable
      ? 'task-store-database-unavailable'
      : '',
    translationModelConfigured ? '' : 'translation-model-not-configured'
  ].filter(Boolean);
  const readinessStatus = degradedReasons.length > 0 ? 'degraded' : 'ok';

  return NextResponse.json({
    status: readinessStatus,
    service: 'wish-export-agent',
    mode: 'skeleton',
    generatedAt: new Date().toISOString(),
    pid: process.pid,
    port: Number(process.env.PORT ?? '3000'),
    taskStoreMode,
    taskStorePersistence,
    readiness: {
      status: readinessStatus,
      degradedReasons,
      checks: {
        taskStore: taskStoreCheck,
        taskStoreRequiresDatabase: databaseRequired,
        taskStorePersistence,
        translationModelConfigured: translationModelConfigured ? 'ok' : 'error',
        translationModel: getTranslationModelName(),
        modelConnectivity: 'not_checked',
        modelConnectivityUrl: '/api/model-health'
      }
    }
  });
}
