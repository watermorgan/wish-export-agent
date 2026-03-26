import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function resolvedExportRoot() {
  return path.resolve(process.cwd(), process.env.ASSISTANT_EXPORT_DIR ?? '.tmp/exports');
}

function resolveArtifactTarget(relPath: string): { ok: true; target: string } | { ok: false } {
  if (!relPath) return { ok: false };
  if (relPath.includes('\0')) return { ok: false };

  const trimmed = relPath.trim();
  if (!trimmed) return { ok: false };

  if (path.isAbsolute(trimmed)) return { ok: false };

  // Normalize to eliminate tricky separators and then reject any parent traversal.
  const normalized = path.normalize(trimmed);
  if (normalized.split(path.sep).includes('..')) return { ok: false };
  if (normalized.startsWith('..')) return { ok: false };

  const exportRoot = resolvedExportRoot();
  const target = path.resolve(process.cwd(), normalized);
  const relativeToRoot = path.relative(exportRoot, target);

  if (relativeToRoot === '' || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return { ok: false };
  }

  return { ok: true, target };
}

function contentTypeFor(filePath: string) {
  if (filePath.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
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

  const resolved = resolveArtifactTarget(relPath);
  if (!resolved.ok) {
    return NextResponse.json({ error: '非法路径。' }, { status: 400 });
  }

  try {
    const content = await readFile(resolved.target);
    const fileName = path.basename(resolved.target);
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(resolved.target),
        'Content-Disposition': contentDispositionFor(resolved.target, fileName),
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return NextResponse.json({ error: '文件不存在或不可读取。' }, { status: 404 });
  }
}

