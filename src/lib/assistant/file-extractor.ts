import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UploadedFile } from '@/lib/assistant/types';

const execFileAsync = promisify(execFile);
const UPLOADS_DIR = join(process.cwd(), '.tmp', 'task-uploads');

function normalizeExtractedText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

function isTextLikeFile(file: File) {
  const extension = extname(file.name).toLowerCase();
  return (
    file.type.startsWith('text/') ||
    ['.txt', '.csv', '.md', '.json', '.eml'].includes(extension)
  );
}

async function runPdfToText(inputPath: string, outputPath: string) {
  await execFileAsync('pdftotext', ['-layout', inputPath, outputPath]);
  const extracted = await readFile(outputPath, 'utf8');
  return normalizeExtractedText(extracted);
}

async function extractPdfText(file: File) {
  const tempDir = await mkdtemp(join(tmpdir(), 'export-agent-pdf-'));
  const inputPath = join(tempDir, basename(file.name));
  const outputPath = join(tempDir, 'output.txt');

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);
    return await runPdfToText(inputPath, outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.\-]+/g, '-');
}

async function persistUploadedFile(file: File) {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const timestamp = Date.now();
  const unique = Math.random().toString(36).slice(2, 8);
  const fileName = `${timestamp}-${unique}-${sanitizeFileName(file.name)}`;
  const outputPath = join(UPLOADS_DIR, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, buffer);
  return outputPath;
}

export async function extractPdfTextFromPath(inputPath: string) {
  const tempDir = await mkdtemp(join(tmpdir(), 'export-agent-pdf-path-'));
  const outputPath = join(tempDir, 'output.txt');

  try {
    return await runPdfToText(inputPath, outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function enrichUploadedFile(file: File): Promise<UploadedFile> {
  const uploaded: UploadedFile = {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream'
  };

  try {
    uploaded.storagePath = await persistUploadedFile(file);

    if (file.type === 'application/pdf' || extname(file.name).toLowerCase() === '.pdf') {
      uploaded.contentText = await extractPdfText(file);
      return uploaded;
    }

    if (isTextLikeFile(file)) {
      uploaded.contentText = normalizeExtractedText(await file.text());
      return uploaded;
    }
  } catch (error) {
    console.warn(`Failed to extract file content for ${file.name}:`, error);
  }

  return uploaded;
}
