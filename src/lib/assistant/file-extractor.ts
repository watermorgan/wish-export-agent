/**
 * PDF text extraction via pdftotext -layout.
 * Main chain for feedback translation; vision layer augments, does not replace.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

/**
 * Extract text from a buffer (e.g. UploadedFile) when file is in memory.
 * Writes to temp path then calls extractPdfText; caller responsible for temp file cleanup.
 */
export async function extractPdfTextFromBuffer(
  buffer: Buffer,
  tempPath: string
): Promise<ExtractedPdfResult> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(tempPath, buffer);
  try {
    return await extractPdfText(tempPath);
  } finally {
    const { unlink } = await import('node:fs/promises');
    await unlink(tempPath).catch(() => {});
  }
}
