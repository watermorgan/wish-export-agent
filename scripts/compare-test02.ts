import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PipelineResult } from '../src/lib/assistant/translation-pipeline';
import {
  buildComparisonMarkdown,
  buildSampleComparison,
  buildSummaryMarkdown,
  buildRunDirectories,
  loadManifest,
  nowRunId,
  normalizeReferenceBundle,
  resolveManifestPath,
  writeJson,
  writeMarkdown,
  type DatasetManifest
} from './lib/test02-harness';

type ComparisonSummaryRow = {
  sampleId: string;
  sourcePdf: string | null;
  referenceCount: number;
  status: 'ok' | 'missing_source' | 'failed';
  comparisonReady: boolean;
  totalSegments?: number;
  translatedSegmentCount?: number;
  translationCoveragePct?: number;
  outputStrategy?: string;
  documentMainType?: string;
  error?: string;
};

function derivePipelineFailureReason(pipeline: PipelineResult) {
  const errorKind = pipeline.diagnostics.bModelLastErrorKind;
  if (errorKind && errorKind !== 'none') {
    return `model_translation_failed:${errorKind}`;
  }

  return pipeline.error ?? null;
}

async function main() {
  const manifestPath = resolveManifestPath(process.argv[2] ?? 'data/test02/manifest.json');
  const runId = process.argv[3] ?? nowRunId();
  const dirs = buildRunDirectories(runId);
  const manifest = (await loadManifest(manifestPath)) as DatasetManifest;

  const summaries: ComparisonSummaryRow[] = [];

  for (const sample of manifest.samples) {
    const sampleDir = path.join(dirs.samplesDir, sample.sample_id);
    const pipelineResultPath = path.join(sampleDir, 'pipeline-result.json');
    const sourcePdf = sample.source.find((item) => item.role === 'source_pdf')?.path ?? null;

    if (!existsSync(pipelineResultPath)) {
      summaries.push({
        sampleId: sample.sample_id,
        sourcePdf,
        referenceCount: sample.references?.length ?? 0,
        status: 'failed',
        comparisonReady: false,
        error: 'pipeline-result.json missing'
      });
      continue;
    }

    try {
      const pipeline = JSON.parse(await readFile(pipelineResultPath, 'utf8')) as PipelineResult;
      const referenceBundle = await normalizeReferenceBundle(sample);
      const comparison = buildSampleComparison(sample, pipeline, referenceBundle);

      await writeJson(path.join(sampleDir, 'reference-normalized.json'), referenceBundle);
      await writeJson(path.join(sampleDir, 'comparison.json'), comparison);
      await writeMarkdown(path.join(sampleDir, 'comparison.md'), buildComparisonMarkdown(comparison));

      summaries.push({
        sampleId: sample.sample_id,
        sourcePdf,
        referenceCount: sample.references?.length ?? 0,
        status: pipeline.success && !derivePipelineFailureReason(pipeline) ? 'ok' : 'failed',
        comparisonReady: true,
        totalSegments: pipeline.segments.length,
        translatedSegmentCount: pipeline.diagnostics.translatedSegmentCount,
        translationCoveragePct: pipeline.diagnostics.translationCoveragePct,
        outputStrategy: pipeline.outputStrategy,
        documentMainType: pipeline.documentMainType,
        error: derivePipelineFailureReason(pipeline) ?? undefined
      });
    } catch (error) {
      summaries.push({
        sampleId: sample.sample_id,
        sourcePdf,
        referenceCount: sample.references?.length ?? 0,
        status: 'failed',
        comparisonReady: false,
        error: error instanceof Error ? error.message : 'comparison build failed'
      });
    }
  }

  const payload = {
    runId,
    manifestPath: path.relative(process.cwd(), manifestPath),
    generatedAt: new Date().toISOString(),
    summaries
  };

  await writeJson(path.join(dirs.reportsDir, 'comparison-summary.json'), payload);
  await writeMarkdown(
    path.join(dirs.reportsDir, 'comparison-summary.md'),
    buildSummaryMarkdown(runId, path.relative(process.cwd(), manifestPath), summaries)
  );

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
