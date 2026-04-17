import { NextResponse } from 'next/server';
import path from 'node:path';

import { normalizeIncomingFeedback } from '@/lib/feedback/normalize';
import { createFeedbackCase } from '@/lib/feedback/store';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '请求体过大（最大 1 MB）。' }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: '请求体过大（最大 1 MB）。' }, { status: 413 });
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }

  try {
    const normalized = normalizeIncomingFeedback(body);
    const created = await createFeedbackCase(
      path.join(process.cwd(), 'data', 'feedback-cases'),
      normalized
    );

    return NextResponse.json(
      { id: created.id, path: `data/feedback-cases/${created.id}.json` },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '反馈写入失败。' },
      { status: 400 }
    );
  }
}
