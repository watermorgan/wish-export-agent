/**
 * PDF text extraction via pdftotext -layout.
 * Main chain for feedback translation; vision layer augments, does not replace.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);

export type ExtractedPage = {
  pageNumber: number;
  lines: string[];
  rawText: string;
};

export type ExtractedPdfResult = {
  fullText: string;
  pages: ExtractedPage[];
  success: boolean;
  error?: string;
};

const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN ?? 'pdftotext';

/**
 * Extract text from PDF using pdftotext -layout.
 * Splits by form-feed (\\f) for per-page text when available.
 */
export async function extractPdfText(path: string): Promise<ExtractedPdfResult> {
  try {
    const { stdout } = await execFileAsync(PDFTOTEXT_BIN, ['-layout', path, '-'], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    const fullText = stdout;

    const chunks = fullText.split(/\f/).filter((c) => c.trim().length > 0);

    const pages: ExtractedPage[] = chunks.map((raw, i) => {
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trimEnd());
      return {
        pageNumber: i + 1,
        lines,
        rawText: raw
      };
    });

    if (pages.length === 0 && fullText.trim().length > 0) {
      pages.push({
        pageNumber: 1,
        lines: fullText.split(/\r?\n/).map((l) => l.trimEnd()),
        rawText: fullText
      });
    }

    return {
      fullText,
      pages,
      success: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      fullText: '',
      pages: [],
      success: false,
      error: `pdftotext failed: ${message}`
    };
  }
}

export async function extractPdfTextFromPath(path: string) {
  const result = await extractPdfText(path);
  if (!result.success) {
    throw new Error(result.error ?? 'pdftotext failed');
  }

  return result.fullText;
}

/**
 * Extract text from a buffer (e.g. UploadedFile) when file is in memory.
 * Writes to temp path then calls extractPdfText; caller responsible for temp file cleanup.
 */
export async function extractPdfTextFromBuffer(
  buffer: Buffer,
  tempPath: string,
  options?: {
    cleanup?: boolean;
  }
): Promise<ExtractedPdfResult> {
  await mkdir(dirname(tempPath), { recursive: true });
  await writeFile(tempPath, buffer);
  try {
    return await extractPdfText(tempPath);
  } finally {
    if (options?.cleanup !== false) {
      const { unlink } = await import('node:fs/promises');
      await unlink(tempPath).catch(() => {});
    }
  }
}

export function buildExtractedPdfResultFromText(contentText: string): ExtractedPdfResult | null {
  const fullText = contentText.trim();

  if (!fullText) {
    return null;
  }

  const rawPages = fullText
    .split(/\f/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const pages = (rawPages.length > 0 ? rawPages : [fullText]).map((rawText, index) => ({
    pageNumber: index + 1,
    lines: rawText.split(/\r?\n/).map((line) => line.trimEnd()),
    rawText
  }));

  return {
    fullText,
    pages,
    success: true
  };
}

export async function enrichUploadedFile(file: File) {
  const uploaded = {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream'
  };

  try {
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      const tempPath = `${process.cwd()}/.tmp/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
      const result = await extractPdfTextFromBuffer(
        Buffer.from(await file.arrayBuffer()),
        tempPath,
        { cleanup: false }
      );
      return {
        ...uploaded,
        storagePath: tempPath,
        contentText: result.success ? result.fullText : undefined
      };
    }

    if (
      file.type.startsWith('text/') ||
      ['.txt', '.csv', '.md', '.json', '.eml'].some((ext) =>
        file.name.toLowerCase().endsWith(ext)
      )
    ) {
      return {
        ...uploaded,
        contentText: (await file.text()).replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
      };
    }

    if (
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.name.toLowerCase().endsWith('.xls')
    ) {
      const tempPath = `${process.cwd()}/.tmp/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await mkdir(dirname(tempPath), { recursive: true });
      await writeFile(tempPath, buffer);
      return {
        ...uploaded,
        storagePath: tempPath,
        contentText: `Excel file: ${file.name}`
      };
    }
  } catch (error) {
    console.warn(`Failed to extract file content for ${file.name}:`, error);
  }

  return uploaded;
}
