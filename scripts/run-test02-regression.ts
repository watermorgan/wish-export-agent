import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

import {
  buildComparisonMarkdown,
  buildSummaryMarkdown,
  buildSampleComparison,
  ensureRunDirectories,
  loadManifest,
  normalizeReferenceBundle,
  nowRunId,
  resolveManifestPath,
  resolveRepoPath,
  toRepoRelative,
  writeJson,
  writeMarkdown,
  type EvaluationRunContext,
  type DatasetManifest,
  type SampleEntry
} from './lib/test02-harness';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type RunPdfTranslationPipeline = typeof import('../src/lib/assistant/translation-pipeline').runPdfTranslationPipeline;
let runPdfTranslationPipeline: RunPdfTranslationPipeline;

type SampleSummary = {
  sampleId: string;
  sourcePdf: string | null;
  referenceCount: number;
  status: 'ok' | 'missing_source' | 'failed';
  outputStrategy?: string;
  documentMainType?: string;
  translatedSegmentCount?: number;
  totalSegments?: number;
  translationCoveragePct?: number;
  businessPreviewReady?: boolean;
  previewSuppressedReason?: string | null;
  comparisonReady?: boolean;
  comparisonStatus?: 'pass' | 'warn' | 'fail' | 'no_reference';
  referenceRecallPct?: number;
  aiPrecisionPct?: number;
  maxSegmentsForTranslation?: number;
  budgetCapped?: boolean;
  artifacts?: {
    annotatedPreview?: string | null;
    bilingualXlsx?: string | null;
    tableStylePdf?: string | null;
  };
  error?: string;
};

function derivePipelineFailureReason(result: Awaited<ReturnType<RunPdfTranslationPipeline>>) {
  const errorKind = result.diagnostics.bModelLastErrorKind;
  if (errorKind && errorKind !== 'none') {
    return `model_translation_failed:${errorKind}`;
  }

  return result.error ?? null;
}

async function writeComparisonArtifacts(
  sample: SampleEntry,
  pipelineResultPath: string,
  options?: {
    maxSegmentsForTranslation?: number;
  }
) {
  const pipeline = JSON.parse(await readFile(pipelineResultPath, 'utf8')) as Awaited<
    ReturnType<RunPdfTranslationPipeline>
  >;
  const referenceBundle = await normalizeReferenceBundle(sample);
  const comparison = buildSampleComparison(sample, pipeline, referenceBundle, options);
  const sampleDir = path.dirname(pipelineResultPath);

  await writeJson(path.join(sampleDir, 'reference-normalized.json'), referenceBundle);
  await writeJson(path.join(sampleDir, 'comparison.json'), comparison);
  await writeMarkdown(path.join(sampleDir, 'comparison.md'), buildComparisonMarkdown(comparison));

  return comparison;
}

async function main() {
  const manifestPath = resolveManifestPath(process.argv[2] ?? 'data/test02/manifest.json');
  const runId = process.argv[3] ?? nowRunId();
  const dirs = await ensureRunDirectories(runId);

  const manifest = (await loadManifest(manifestPath)) as DatasetManifest;
  await writeJson(path.join(dirs.runRoot, 'manifest.snapshot.json'), manifest);
  const onlySamples = new Set(
    (process.env.TEST02_ONLY_SAMPLES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const skipExisting = process.env.TEST02_SKIP_EXISTING === '1';

  process.env.ASSISTANT_EXPORT_DIR = toRepoRelative(dirs.exportsDir);
  ({ runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline'));

  const maxSegmentsRaw = Number(process.env.TEST02_MAX_SEGMENTS ?? '0');
  const maxSegmentsForTranslation =
    Number.isFinite(maxSegmentsRaw) && maxSegmentsRaw > 0 ? maxSegmentsRaw : undefined;
  const generatedAt = new Date().toISOString();
  const context: EvaluationRunContext = {
    manifestPath: toRepoRelative(manifestPath),
    generatedAt,
    maxSegmentsForTranslation,
    skipExisting,
    onlySamples: [...onlySamples]
  };
  await writeJson(path.join(dirs.reportsDir, 'run-context.json'), context);

  const summaries: SampleSummary[] = [];

  for (const sample of manifest.samples) {
    const sourcePdf = sample.source.find((item) => item.role === 'source_pdf')?.path ?? null;
    const resolvedSource = sourcePdf ? resolveRepoPath(sourcePdf) : null;
    const sampleOutDir = path.join(dirs.samplesDir, sample.sample_id);
    await mkdir(sampleOutDir, { recursive: true });
    const pipelineResultPath = path.join(sampleOutDir, 'pipeline-result.json');

    if (onlySamples.size > 0 && !onlySamples.has(sample.sample_id)) {
      if (skipExisting && existsSync(pipelineResultPath)) {
        const result = JSON.parse(
          await readFile(pipelineResultPath, 'utf8')
        ) as Awaited<ReturnType<RunPdfTranslationPipeline>>;
        let comparisonReady = false;
        let comparisonStatus: SampleSummary['comparisonStatus'];
        let referenceRecallPct: number | undefined;
        let aiPrecisionPct: number | undefined;
        try {
          const comparison = await writeComparisonArtifacts(sample, pipelineResultPath, {
            maxSegmentsForTranslation
          });
          comparisonReady = true;
          comparisonStatus = comparison.metrics.status;
          referenceRecallPct = comparison.metrics.referenceRecallPct;
          aiPrecisionPct = comparison.metrics.aiPrecisionPct;
        } catch {
          comparisonReady = false;
        }

        summaries.push({
          sampleId: sample.sample_id,
          sourcePdf,
          referenceCount: sample.references?.length ?? 0,
          status: result.success && !derivePipelineFailureReason(result) ? 'ok' : 'failed',
          outputStrategy: result.outputStrategy,
          documentMainType: result.documentMainType,
          translatedSegmentCount: result.diagnostics.translatedSegmentCount,
          totalSegments: result.segments.length,
          translationCoveragePct: result.diagnostics.translationCoveragePct,
          businessPreviewReady: result.diagnostics.isBusinessPreviewReady,
          previewSuppressedReason: result.diagnostics.previewSuppressedReason ?? null,
          comparisonReady,
          comparisonStatus,
          referenceRecallPct,
          aiPrecisionPct,
          maxSegmentsForTranslation,
          budgetCapped:
            typeof maxSegmentsForTranslation === 'number' &&
            result.segments.length > maxSegmentsForTranslation,
          artifacts: {
            annotatedPreview: result.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
            bilingualXlsx: result.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
            tableStylePdf:
              result.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
          },
          error: derivePipelineFailureReason(result) ?? undefined
        });
      }
      continue;
    }

    if (!resolvedSource || !existsSync(resolvedSource)) {
      console.log(`[test02] ${sample.sample_id}: missing source`);
      summaries.push({
        sampleId: sample.sample_id,
        sourcePdf,
        referenceCount: sample.references?.length ?? 0,
        status: 'missing_source',
        error: 'source pdf missing'
      });
      continue;
    }

    try {
      console.log(
        `[test02] ${sample.sample_id}: pipeline start (${path.basename(resolvedSource)})`
      );
      const result =
        skipExisting && existsSync(pipelineResultPath)
          ? (JSON.parse(await readFile(pipelineResultPath, 'utf8')) as Awaited<
              ReturnType<RunPdfTranslationPipeline>
            >)
          : await runPdfTranslationPipeline({
              filePath: resolvedSource,
              fileName: path.basename(resolvedSource),
              maxSegmentsForTranslation
            });

      if (!(skipExisting && existsSync(pipelineResultPath))) {
        await writeJson(pipelineResultPath, result);
      }
      console.log(
        `[test02] ${sample.sample_id}: pipeline done success=${result.success} coverage=${result.diagnostics.translationCoveragePct}%`
      );

      if (sample.references?.length) {
        await writeJson(path.join(sampleOutDir, 'references.json'), sample.references);
      }

      let comparisonReady = false;
      try {
        const comparison = await writeComparisonArtifacts(sample, pipelineResultPath, {
          maxSegmentsForTranslation
        });
        comparisonReady = true;
        summaries.push({
          sampleId: sample.sample_id,
          sourcePdf,
          referenceCount: sample.references?.length ?? 0,
          status: result.success && !derivePipelineFailureReason(result) ? 'ok' : 'failed',
          outputStrategy: result.outputStrategy,
          documentMainType: result.documentMainType,
          translatedSegmentCount: result.diagnostics.translatedSegmentCount,
          totalSegments: result.segments.length,
          translationCoveragePct: result.diagnostics.translationCoveragePct,
          businessPreviewReady: result.diagnostics.isBusinessPreviewReady,
          previewSuppressedReason: result.diagnostics.previewSuppressedReason ?? null,
          comparisonReady,
          comparisonStatus: comparison.metrics.status,
          referenceRecallPct: comparison.metrics.referenceRecallPct,
          aiPrecisionPct: comparison.metrics.aiPrecisionPct,
          maxSegmentsForTranslation,
          budgetCapped:
            typeof maxSegmentsForTranslation === 'number' &&
            result.segments.length > maxSegmentsForTranslation,
          artifacts: {
            annotatedPreview: result.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
            bilingualXlsx: result.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
            tableStylePdf:
              result.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
          },
          error: derivePipelineFailureReason(result) ?? undefined
        });
      } catch (comparisonError) {
        comparisonReady = false;
        console.error(
          `[test02] comparison failed for ${sample.sample_id}:`,
          comparisonError instanceof Error ? comparisonError.message : comparisonError
        );
        console.log(`[test02] ${sample.sample_id}: comparison failed`);
        summaries.push({
          sampleId: sample.sample_id,
          sourcePdf,
          referenceCount: sample.references?.length ?? 0,
          status: result.success && !derivePipelineFailureReason(result) ? 'ok' : 'failed',
          outputStrategy: result.outputStrategy,
          documentMainType: result.documentMainType,
          translatedSegmentCount: result.diagnostics.translatedSegmentCount,
          totalSegments: result.segments.length,
          translationCoveragePct: result.diagnostics.translationCoveragePct,
          businessPreviewReady: result.diagnostics.isBusinessPreviewReady,
          previewSuppressedReason: result.diagnostics.previewSuppressedReason ?? null,
          comparisonReady,
          maxSegmentsForTranslation,
          budgetCapped:
            typeof maxSegmentsForTranslation === 'number' &&
            result.segments.length > maxSegmentsForTranslation,
          artifacts: {
            annotatedPreview: result.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
            bilingualXlsx: result.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
            tableStylePdf:
              result.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
          },
          error: derivePipelineFailureReason(result) ?? undefined
        });
      }
      if (comparisonReady) {
        console.log(`[test02] ${sample.sample_id}: comparison ready`);
      }
    } catch (error) {
      console.error(
        `[test02] ${sample.sample_id}: pipeline exception`,
        error instanceof Error ? error.message : error
      );
      summaries.push({
        sampleId: sample.sample_id,
        sourcePdf,
        referenceCount: sample.references?.length ?? 0,
        status: 'failed',
        comparisonReady: false,
        error: error instanceof Error ? error.message : 'unknown pipeline error'
      });
    }
  }

  const summaryJson = {
    runId,
    manifestPath: toRepoRelative(manifestPath),
    exportRoot: toRepoRelative(dirs.exportsDir),
    generatedAt,
    maxSegmentsForTranslation: maxSegmentsForTranslation ?? null,
    skipExisting,
    onlySamples: [...onlySamples],
    summaries
  };

  await writeJson(path.join(dirs.reportsDir, 'summary.json'), summaryJson);
  await writeMarkdown(
    path.join(dirs.reportsDir, 'summary.md'),
    buildSummaryMarkdown(runId, toRepoRelative(manifestPath), summaries, context)
  );
  await writeJson(path.join(path.dirname(dirs.runRoot), 'LATEST_RUN.json'), {
    runId,
    path: toRepoRelative(dirs.runRoot),
    generatedAt
  });

  console.log(JSON.stringify(summaryJson, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
