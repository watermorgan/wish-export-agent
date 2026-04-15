import { NextResponse } from 'next/server';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

const VALID_CATEGORIES = [
  'translation_error',
  'term_correction',
  'layout_issue',
  'missing_content',
  'noise_content',
  'general_quality'
] as const;

type FeedbackCategory = (typeof VALID_CATEGORIES)[number];

function isValidCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value);
}

async function generateFeedbackId(dir: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let count = 1;
  if (existsSync(dir)) {
    const files = await readdir(dir);
    const todayFiles = files.filter((f) => f.startsWith(`fb-${today}-`));
    count = todayFiles.length + 1;
  }
  return `fb-${today}-${String(count).padStart(3, '0')}`;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }

  const category = body.category;
  if (!isValidCategory(category)) {
    return NextResponse.json(
      {
        error: `category 必填且必须是以下之一：${VALID_CATEGORIES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  const source = (body.source as Record<string, unknown>) ?? {};
  const fileName = source.fileName;
  if (!fileName || typeof fileName !== 'string') {
    return NextResponse.json({ error: 'source.fileName 必填。' }, { status: 400 });
  }

  const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
  await mkdir(feedbackDir, { recursive: true });

  const id = await generateFeedbackId(feedbackDir);
  const record = {
    id,
    category,
    priority: (body.priority as string) ?? 'medium',
    status: 'open',
    source: {
      ...source,
      fileName,
    },
    reporter: (body.reporter as string) ?? 'unknown',
    reportedAt: new Date().toISOString(),
    tags: Array.isArray(body.tags) ? body.tags : [],
    resolution: null,
  };

  const filePath = path.join(feedbackDir, `${id}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');

  return NextResponse.json(
    { id, path: `data/feedback-cases/${id}.json` },
    { status: 201 }
  );
}
