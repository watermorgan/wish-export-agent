import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'wish-export-agent',
    mode: 'skeleton',
    generatedAt: new Date().toISOString(),
    pid: process.pid,
    port: Number(process.env.PORT ?? '3000'),
    taskStoreMode:
      process.env.DATABASE_URL || process.env.DATABASE_JDBC_URL || process.env.JDBC_DATABASE_URL
        ? 'database-or-fallback'
        : 'fallback-only'
  });
}
