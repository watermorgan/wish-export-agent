import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type RunPdfTranslationPipeline = typeof import('../src/lib/assistant/translation-pipeline').runPdfTranslationPipeline;
let runPdfTranslationPipeline: RunPdfTranslationPipeline;

const DEFAULT_SAMPLES = [
  'data/test/Cici Rain Jacket - sketch.pdf',
  'data/test/Macade TP Cici Rain Jacket W.pdf'
];

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  ({ runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline'));

  const samplePaths = process.argv.slice(2);
  const targets = samplePaths.length > 0 ? samplePaths : DEFAULT_SAMPLES;
  const attemptLimit = Number(process.env.BUSINESS_REVIEW_ATTEMPTS ?? '2');
  const attemptDelayMs = Number(process.env.BUSINESS_REVIEW_ATTEMPT_DELAY_MS ?? '1500');

  for (const target of targets) {
    const resolved = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
    if (!existsSync(resolved)) {
      console.log(`SKIP ${target} (missing)`);
      continue;
    }

    let bestResult:
      | Awaited<ReturnType<RunPdfTranslationPipeline>>
      | null = null;

    for (let attempt = 0; attempt < Math.max(1, attemptLimit); attempt++) {
      const current = await runPdfTranslationPipeline({
        filePath: resolved,
        fileName: path.basename(resolved),
        maxSegmentsForTranslation: Number(process.env.BUSINESS_REVIEW_MAX_SEGMENTS ?? '12')
      });

      if (
        !bestResult ||
        (current.success &&
          (!bestResult.success ||
            current.diagnostics.translatedSegmentCount >
              bestResult.diagnostics.translatedSegmentCount))
      ) {
        bestResult = current;
      }

      if (current.success && current.diagnostics.isBusinessPreviewReady) {
        bestResult = current;
        break;
      }

      if (attempt < attemptLimit - 1) {
        await delay(attemptDelayMs);
      }
    }

    const result = bestResult;
    if (!result) {
      console.log(JSON.stringify({ file: resolved, success: false, error: 'no result' }, null, 2));
      continue;
    }

    if (!result.success) {
      console.log(JSON.stringify({ file: resolved, success: false, error: result.error }, null, 2));
      continue;
    }

    console.log(
      JSON.stringify(
        {
          file: resolved,
          documentMainType: result.documentMainType,
          outputStrategy: result.outputStrategy,
          translatedSegmentCount: result.diagnostics.translatedSegmentCount,
          totalSegments: result.segments.length,
          translationCoveragePct: result.diagnostics.translationCoveragePct,
          businessPreviewReady: result.diagnostics.isBusinessPreviewReady,
          previewSuppressedReason: result.diagnostics.previewSuppressedReason ?? null,
          artifacts: {
            annotatedPreview:
              result.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
            bilingualXlsx:
              result.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
            tableStylePdf:
              result.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
          }
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
