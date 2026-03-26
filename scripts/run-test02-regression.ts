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
  pipelineResultPath: string
) {
  const pipeline = JSON.parse(await readFile(pipelineResultPath, 'utf8')) as Awaited<
    ReturnType<RunPdfTranslationPipeline>
  >;
  const referenceBundle = await normalizeReferenceBundle(sample);
  const comparison = buildSampleComparison(sample, pipeline, referenceBundle);
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

  process.env.ASSISTANT_EXPORT_DIR = toRepoRelative(dirs.exportsDir);
  ({ runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline'));

  const maxSegmentsRaw = Number(process.env.TEST02_MAX_SEGMENTS ?? '0');
  const maxSegmentsForTranslation =
    Number.isFinite(maxSegmentsRaw) && maxSegmentsRaw > 0 ? maxSegmentsRaw : undefined;

  const summaries: SampleSummary[] = [];

  for (const sample of manifest.samples) {
    const sourcePdf = sample.source.find((item) => item.role === 'source_pdf')?.path ?? null;
    const resolvedSource = sourcePdf ? resolveRepoPath(sourcePdf) : null;
    const sampleOutDir = path.join(dirs.samplesDir, sample.sample_id);
    await mkdir(sampleOutDir, { recursive: true });

    if (!resolvedSource || !existsSync(resolvedSource)) {
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
      const result = await runPdfTranslationPipeline({
        filePath: resolvedSource,
        fileName: path.basename(resolvedSource),
        maxSegmentsForTranslation
      });

      const pipelineResultPath = path.join(sampleOutDir, 'pipeline-result.json');
      await writeJson(pipelineResultPath, result);

      if (sample.references?.length) {
        await writeJson(path.join(sampleOutDir, 'references.json'), sample.references);
      }

      let comparisonReady = false;
      try {
        await writeComparisonArtifacts(sample, pipelineResultPath);
        comparisonReady = true;
      } catch (comparisonError) {
        comparisonReady = false;
        console.error(
          `[test02] comparison failed for ${sample.sample_id}:`,
          comparisonError instanceof Error ? comparisonError.message : comparisonError
        );
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
        artifacts: {
          annotatedPreview: result.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
          bilingualXlsx: result.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
          tableStylePdf:
            result.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
        },
        error: derivePipelineFailureReason(result) ?? undefined
      });
    } catch (error) {
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
    generatedAt: new Date().toISOString(),
    summaries
  };

  await writeJson(path.join(dirs.reportsDir, 'summary.json'), summaryJson);
  await writeMarkdown(
    path.join(dirs.reportsDir, 'summary.md'),
    buildSummaryMarkdown(runId, toRepoRelative(manifestPath), summaries)
  );
  await writeJson(path.join(path.dirname(dirs.runRoot), 'LATEST_RUN.json'), {
    runId,
    path: toRepoRelative(dirs.runRoot),
    generatedAt: new Date().toISOString()
  });

  console.log(JSON.stringify(summaryJson, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
