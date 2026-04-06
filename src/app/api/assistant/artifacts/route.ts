import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const EXPORT_ROOT = path.resolve(process.cwd(), process.env.ASSISTANT_EXPORT_DIR ?? '.tmp/exports');

function contentTypeFor(filePath: string) {
  if (filePath.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  return 'application/octet-stream';
}

function contentDispositionFor(filePath: string, fileName: string) {
  const encoded = encodeURIComponent(fileName);
  if (filePath.endsWith('.html')) {
    return `inline; filename="${encoded}"`;
  }
  return `attachment; filename="${encoded}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const relPath = url.searchParams.get('path');
  if (!relPath) {
    return NextResponse.json({ error: '缺少 path 参数。' }, { status: 400 });
  }
  const target = path.resolve(process.cwd(), relPath);
  if (!target.startsWith(EXPORT_ROOT)) {
    return NextResponse.json({ error: '非法路径。' }, { status: 400 });
  }

  try {
    const content = await readFile(target);
    const fileName = path.basename(target);
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(target),
        'Content-Disposition': contentDispositionFor(target, fileName),
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.json({ error: '文件不存在或不可读取。' }, { status: 404 });
  }
}
