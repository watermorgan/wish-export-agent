import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type RunPdfTranslationPipeline = typeof import('../src/lib/assistant/translation-pipeline').runPdfTranslationPipeline;
let runPdfTranslationPipeline: RunPdfTranslationPipeline;

type SmokeSample = {
  sampleId: string;
  sourcePdf: string;
};

type SmokeRow = {
  sampleId: string;
  sourcePdf: string;
  success: boolean;
  documentMainType: string;
  outputStrategy: string;
  translatedSegmentCount: number;
  totalSegments: number;
  zhPopulationPct: number;
  translationCoveragePct: number;
  aModelExecuted: boolean;
  bModelExecuted: boolean;
  bModelBatchAttempts: number;
  bModelBatchJsonOk: number;
  bModelLastErrorKind: string;
  pass: boolean;
  notes: string;
};

type SmokeMode = 'fast' | 'full';

function defaultMaxSegmentsForMode(mode: SmokeMode) {
  return mode === 'full' ? 40 : 60;
}

function defaultSampleTimeoutMs(mode: SmokeMode) {
  return mode === 'full' ? 180_000 : 90_000;
}

function resolveRepoPath(input: string) {
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

async function loadDefaultSamples(mode: SmokeMode): Promise<SmokeSample[]> {
  const defaults: SmokeSample[] = [
    {
      sampleId: 'm422123',
      sourcePdf: resolveRepoPath('data/test02/M422123.pdf')
    }
  ];

  if (mode === 'fast') {
    return defaults;
  }

  const localManifestPath = resolveRepoPath('data/local/manifest.json');
  if (!existsSync(localManifestPath)) {
    return defaults;
  }

  const manifest = JSON.parse(await readFile(localManifestPath, 'utf8')) as {
    samples?: Array<{
      sample_id?: string;
      source?: Array<{ role?: string; path?: string }>;
    }>;
  };

  const extras =
    manifest.samples?.flatMap((sample) => {
      const sourcePdf = sample.source?.find((item) => item.role === 'source_pdf')?.path;
      if (!sample.sample_id || !sourcePdf) {
        return [];
      }
      return [
        {
          sampleId: sample.sample_id,
          sourcePdf: resolveRepoPath(sourcePdf)
        }
      ];
    }) ?? [];

  const deduped = new Map<string, SmokeSample>();
  for (const sample of [...defaults, ...extras]) {
    deduped.set(sample.sampleId, sample);
  }
  return [...deduped.values()];
}

function buildNotes(result: Awaited<ReturnType<RunPdfTranslationPipeline>>, zhPopulationPct: number) {
  const notes: string[] = [];
  notes.push(`coverage=${result.diagnostics.translationCoveragePct}%`);
  notes.push(`zh=${zhPopulationPct}%`);
  notes.push(`bJson=${result.diagnostics.bModelBatchJsonOk}/${result.diagnostics.bModelBatchAttempts}`);
  if (result.diagnostics.bModelLastErrorKind !== 'none') {
    notes.push(`lastError=${result.diagnostics.bModelLastErrorKind}`);
  }
  return notes.join(' · ');
}

function resolveSmokeMode() {
  const fromEnv = (process.env.SMOKE_MODE ?? 'fast').trim().toLowerCase();
  return fromEnv === 'full' ? ('full' as const) : ('fast' as const);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        reject(new Error(`timeout:${label}:${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

async function main() {
  ({ runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline'));

  const requested = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  const mode = resolveSmokeMode();
  const samples =
    requested.length > 0
      ? requested.map((value, index) => ({
          sampleId: path.basename(value, path.extname(value)) || `sample-${index + 1}`,
          sourcePdf: resolveRepoPath(value)
        }))
      : await loadDefaultSamples(mode);

  const minZhPopulationPct = Number(process.env.SMOKE_MIN_ZH_POPULATION_PCT ?? '15');
  const minTranslatedSegments = Number(process.env.SMOKE_MIN_TRANSLATED_SEGMENTS ?? '1');
  const maxSegmentsForTranslation = Number(
    process.env.SMOKE_MAX_SEGMENTS ?? String(defaultMaxSegmentsForMode(mode))
  );
  const sampleTimeoutMs = Number(
    process.env.SMOKE_SAMPLE_TIMEOUT_MS ?? String(defaultSampleTimeoutMs(mode))
  );

  const rows: SmokeRow[] = [];
  for (const sample of samples) {
    if (!existsSync(sample.sourcePdf)) {
      rows.push({
        sampleId: sample.sampleId,
        sourcePdf: sample.sourcePdf,
        success: false,
        documentMainType: 'unknown',
        outputStrategy: 'unknown',
        translatedSegmentCount: 0,
        totalSegments: 0,
        zhPopulationPct: 0,
        translationCoveragePct: 0,
        aModelExecuted: false,
        bModelExecuted: false,
        bModelBatchAttempts: 0,
        bModelBatchJsonOk: 0,
        bModelLastErrorKind: 'missing_source',
        pass: false,
        notes: 'source pdf missing'
      });
      continue;
    }

    console.log(`[smoke:pdf] ${sample.sampleId}: start mode=${mode}`);
    let result: Awaited<ReturnType<RunPdfTranslationPipeline>>;
    try {
      result = await withTimeout(
        runPdfTranslationPipeline({
          filePath: sample.sourcePdf,
          fileName: path.basename(sample.sourcePdf),
          maxSegmentsForTranslation
        }),
        sampleTimeoutMs,
        sample.sampleId
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        sampleId: sample.sampleId,
        sourcePdf: sample.sourcePdf,
        success: false,
        documentMainType: 'unknown',
        outputStrategy: 'unknown',
        translatedSegmentCount: 0,
        totalSegments: 0,
        zhPopulationPct: 0,
        translationCoveragePct: 0,
        aModelExecuted: false,
        bModelExecuted: false,
        bModelBatchAttempts: 0,
        bModelBatchJsonOk: 0,
        bModelLastErrorKind: /^timeout:/.test(message) ? 'timeout' : 'http',
        pass: false,
        notes: message
      });
      console.log(`[smoke:pdf] ${sample.sampleId}: failed ${message}`);
      continue;
    }
    const translatedSegmentCount = result.diagnostics.translatedSegmentCount;
    const totalSegments = result.segments.length;
    const zhPopulationPct = totalSegments
      ? Math.round((translatedSegmentCount / totalSegments) * 100)
      : 0;
    const pass =
      result.success &&
      result.diagnostics.bModelExecuted &&
      translatedSegmentCount >= minTranslatedSegments &&
      zhPopulationPct >= minZhPopulationPct &&
      result.diagnostics.bModelLastErrorKind !== 'parse';

    rows.push({
      sampleId: sample.sampleId,
      sourcePdf: sample.sourcePdf,
      success: result.success,
      documentMainType: result.documentMainType,
      outputStrategy: result.outputStrategy,
      translatedSegmentCount,
      totalSegments,
      zhPopulationPct,
      translationCoveragePct: result.diagnostics.translationCoveragePct,
      aModelExecuted: result.diagnostics.aModelExecuted,
      bModelExecuted: result.diagnostics.bModelExecuted,
      bModelBatchAttempts: result.diagnostics.bModelBatchAttempts,
      bModelBatchJsonOk: result.diagnostics.bModelBatchJsonOk,
      bModelLastErrorKind: result.diagnostics.bModelLastErrorKind,
      pass,
      notes: buildNotes(result, zhPopulationPct)
    });
    console.log(
      `[smoke:pdf] ${sample.sampleId}: done pass=${pass} coverage=${result.diagnostics.translationCoveragePct}%`
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    mode,
    minZhPopulationPct,
    minTranslatedSegments,
    maxSegmentsForTranslation,
    sampleTimeoutMs,
    pass: rows.every((row) => row.pass),
    rows
  };

  const outputPath = resolveRepoPath(
    `docs/project/pdf-pipeline-smoke-report.${mode}.json`
  );
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));

  if (!output.pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
