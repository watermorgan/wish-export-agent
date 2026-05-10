import { NextResponse } from 'next/server';
import {
  getTranslationModelName,
  isTranslationModelConfigured
} from '@/lib/assistant/qwen-client';

export function GET() {
  const taskStoreMode =
    process.env.DATABASE_URL || process.env.DATABASE_JDBC_URL || process.env.JDBC_DATABASE_URL
      ? 'database-or-fallback'
      : 'fallback-only';
  const translationModelConfigured = isTranslationModelConfigured();
  const degradedReasons = [
    taskStoreMode === 'fallback-only' ? 'task-store-fallback-only' : '',
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
    readiness: {
      status: readinessStatus,
      degradedReasons,
      checks: {
        taskStore: taskStoreMode === 'fallback-only' ? 'warning' : 'ok',
        translationModelConfigured: translationModelConfigured ? 'ok' : 'error',
        translationModel: getTranslationModelName(),
        modelConnectivity: 'not_checked',
        modelConnectivityUrl: '/api/model-health'
      }
    }
  });
}
