import { NextResponse } from 'next/server';
import path from 'node:path';
import { mkdir, open } from 'node:fs/promises';

const VALID_CATEGORIES = [
  'translation_error',
  'term_correction',
  'layout_issue',
  'missing_content',
  'noise_content',
  'general_quality'
] as const;

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

type FeedbackCategory = (typeof VALID_CATEGORIES)[number];

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function isValidCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value);
}

function isSafeFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[/\\]|\.\./.test(value)
  );
}

/**
 * Uses exclusive file creation (wx flag) to atomically reserve a unique ID,
 * preventing TOCTOU races under concurrent requests.
 */
async function reserveUniqueFeedbackFile(
  dir: string
): Promise<{ id: string; handle: Awaited<ReturnType<typeof open>> }> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let count = 1; count <= 9999; count++) {
    const id = `fb-${today}-${String(count).padStart(3, '0')}`;
    const filePath = path.join(dir, `${id}.json`);
    try {
      const handle = await open(filePath, 'wx');
      return { id, handle };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('Unable to reserve a unique feedback ID for today.');
}

export async function POST(request: Request) {
  // Body size guard
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

  // Validate category
  const category = body.category;
  if (!isValidCategory(category)) {
    return NextResponse.json(
      { error: `category 必填且必须是以下之一：${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate fileName (required + path-traversal guard)
  const source = typeof body.source === 'object' && body.source !== null
    ? (body.source as Record<string, unknown>)
    : {};
  const fileName = source.fileName;
  if (!isSafeFileName(fileName)) {
    return NextResponse.json(
      { error: 'source.fileName 必填，且不能包含路径分隔符或 ".."。' },
      { status: 400 }
    );
  }

  // Validate optional priority
  const priority =
    typeof body.priority === 'string' &&
    (VALID_PRIORITIES as readonly string[]).includes(body.priority)
      ? body.priority
      : 'medium';

  // Filter tags to strings only
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string')
    : [];

  const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
  await mkdir(feedbackDir, { recursive: true });

  // Atomically reserve a unique file slot
  const { id, handle } = await reserveUniqueFeedbackFile(feedbackDir);

  const record = {
    id,
    category,
    priority,
    status: 'open',
    source: { ...source, fileName },
    reporter: typeof body.reporter === 'string' ? body.reporter : 'unknown',
    reportedAt: new Date().toISOString(),
    tags,
    resolution: null,
  };

  await handle.writeFile(JSON.stringify(record, null, 2), 'utf-8');
  await handle.close();

  return NextResponse.json(
    { id, path: `data/feedback-cases/${id}.json` },
    { status: 201 }
  );
}
