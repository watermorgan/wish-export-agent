import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getVisionMaxRenderSize } from '@/lib/assistant/vision-render-config';

const execFileAsync = promisify(execFile);

const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN ?? 'pdftoppm';

/**
 * Rasterize a single PDF page to PNG using poppler `pdftoppm -scale-to`.
 * `maxSide` defaults to `getVisionMaxRenderSize()` (respects local vs default env).
 */
export async function renderPdfPageToPng(
  pdfPath: string,
  pageOneBased: number,
  maxSide?: number
): Promise<Buffer> {
  const side = maxSide ?? getVisionMaxRenderSize();
  const dir = await mkdtemp(path.join(tmpdir(), 'export-agent-vis-'));
  const outPrefix = path.join(dir, 'page');
  try {
    await execFileAsync(
      PDFTOPPM_BIN,
      [
        '-png',
        '-singlefile',
        '-f',
        String(pageOneBased),
        '-l',
        String(pageOneBased),
        '-scale-to',
        String(side),
        pdfPath,
        outPrefix
      ],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return await readFile(`${outPrefix}.png`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
