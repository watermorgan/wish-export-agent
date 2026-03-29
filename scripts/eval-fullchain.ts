import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Ensure offline eval scripts can access `.env.local` (Next.js does this automatically for app routes,
// but plain `node/tsx` scripts do not).
//
// Important: qwen-client reads env into module-level constants, so we must call dotenv.config()
// before importing translation-pipeline/qwen-client.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type RunPdfTranslationPipeline = typeof import('../src/lib/assistant/translation-pipeline').runPdfTranslationPipeline;
let runPdfTranslationPipeline: RunPdfTranslationPipeline;

type SampleEntry = {
  sample_id: string;
  source: Array<{ role: string; path: string }>;
  references?: Array<{ role: string; path: string }>;
};

type DatasetManifest = {
  dataset_date: string;
  samples: SampleEntry[];
};

type FullchainEvalRow = {
  sampleId: string;
  sourcePdf: string;
  referenceCount: number;
  segments: number;
  earlyGatePages: number;
  lowConfidencePages: number;
  secondPassRequired: boolean;
  documentMainType: string;
  outputStrategy: string;
  aAssistProbeTriggered: boolean;
  aAssistProbeCompleted: boolean;
  translationProbeCompleted: boolean;
  zhPopulationPct: number;
  bModelBatchAttempts: number;
  bModelBatchJsonOk: number;
  bModelLastErrorKind: string;
  scriptDerivedHumanReviewItems: number;
  notes: string;
};

function buildFullchainNotes(pipeline: {
  diagnostics: {
    aModelTriggered: boolean;
    aModelExecuted: boolean;
    bModelExecuted: boolean;
    bModelApiConfigured: boolean;
    bModelBatchAttempts: number;
    bModelBatchJsonOk: number;
    bModelLastErrorKind:
      | 'none'
      | 'not_configured'
      | 'timeout'
      | 'http'
      | 'rate_limited'
      | 'parse';
  };
}): string {
  const {
    aModelTriggered,
    aModelExecuted,
    bModelApiConfigured,
    bModelBatchAttempts,
    bModelBatchJsonOk,
    bModelLastErrorKind
  } = pipeline.diagnostics;

  const aNote = aModelTriggered
    ? aModelExecuted
      ? 'A:已触发并完成'
      : 'A:已触发但未完成(回退/失败)'
    : 'A:未触发';

  let bNote: string;
  if (!bModelApiConfigured) {
    bNote = 'B:未配置(未触发模型调用)';
  } else if (bModelBatchAttempts === 0) {
    bNote = 'B:未发起请求';
  } else if (bModelBatchJsonOk === 0) {
    bNote = `B:未成功解析(0/${bModelBatchAttempts})，最近错误=${bModelLastErrorKind}`;
  } else if (bModelBatchJsonOk === bModelBatchAttempts) {
    bNote = `B:批次解析全部成功(${bModelBatchJsonOk}/${bModelBatchAttempts})`;
  } else {
    bNote = `B:批次解析部分成功(${bModelBatchJsonOk}/${bModelBatchAttempts})，最近错误=${bModelLastErrorKind}`;
  }

  return `抽取与导出链路完成；${aNote}；${bNote}。`;
}

async function loadManifest(manifestPath: string): Promise<DatasetManifest> {
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw) as DatasetManifest;
}

async function evaluateSourcePdf(sourcePdfPath: string, sampleId: string, referenceCount: number) {
  const maxSegmentsForTranslation = Number(process.env.EVAL_FULLCHAIN_MAX_SEGMENTS ?? '60');
  const pipeline = await runPdfTranslationPipeline({
    filePath: sourcePdfPath,
    fileName: path.basename(sourcePdfPath),
    maxSegmentsForTranslation
  });
  if (!pipeline.success) {
    return {
      sampleId,
      sourcePdf: sourcePdfPath,
      referenceCount,
      segments: 0,
      earlyGatePages: 0,
      lowConfidencePages: 0,
      secondPassRequired: false,
      documentMainType: 'unknown',
      outputStrategy: 'unknown',
      aAssistProbeTriggered: false,
      aAssistProbeCompleted: false,
      translationProbeCompleted: false,
      zhPopulationPct: 0,
      bModelBatchAttempts: 0,
      bModelBatchJsonOk: 0,
      bModelLastErrorKind: 'none',
      scriptDerivedHumanReviewItems: 3,
      notes: pipeline.error ?? '抽取失败'
    } satisfies FullchainEvalRow;
  }
  const translatedCount = pipeline.segments.filter((item) => Boolean(item.zh)).length;
  const zhPopulationPct = pipeline.segments.length
    ? Math.round((translatedCount / pipeline.segments.length) * 100)
    : 0;
  const scriptDerivedHumanReviewItems =
    Number(pipeline.diagnostics.secondPassRequired) +
    Number(pipeline.diagnostics.earlyGatePages.length > 0) +
    Number(translatedCount < pipeline.segments.length) +
    Number(referenceCount === 0);

  return {
    sampleId,
    sourcePdf: sourcePdfPath,
    referenceCount,
    segments: pipeline.segments.length,
    earlyGatePages: pipeline.diagnostics.earlyGatePages.length,
    lowConfidencePages: pipeline.diagnostics.lowConfidencePages.length,
    secondPassRequired: pipeline.diagnostics.secondPassRequired,
    documentMainType: pipeline.documentMainType,
    outputStrategy: pipeline.outputStrategy,
    aAssistProbeTriggered: pipeline.diagnostics.aModelTriggered,
    aAssistProbeCompleted: pipeline.diagnostics.aModelExecuted,
    translationProbeCompleted: pipeline.diagnostics.bModelExecuted,
    zhPopulationPct,
    bModelBatchAttempts: pipeline.diagnostics.bModelBatchAttempts,
    bModelBatchJsonOk: pipeline.diagnostics.bModelBatchJsonOk,
    bModelLastErrorKind: pipeline.diagnostics.bModelLastErrorKind,
    scriptDerivedHumanReviewItems,
    notes: buildFullchainNotes(pipeline)
  } satisfies FullchainEvalRow;
}

function toMarkdown(rows: FullchainEvalRow[], missingManifests: string[]) {
  const lines: string[] = [];
  lines.push('# Offline Evaluation Harness Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');

  if (missingManifests.length > 0) {
    lines.push('## Dataset Coverage Note');
    lines.push('');
    lines.push(`- 以下 manifest 目录缺失，因此本次报告仅覆盖已存在的清单（例如 local 专项）：${missingManifests.join(', ')}`);
    lines.push('');
  }

  lines.push(
    '| Sample | Source PDF | DocType | OutputStrategy | Refs | Segments | EarlyGate | LowConfPages | 2ndPassReq | aAssistProbeTriggered | aAssistProbeCompleted | translationProbeCompleted | zhPopulationPct | bBatchJsonOk | bLastError | scriptDerivedHumanReviewItems | Notes |'
  );
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | --- | --- | ---: | --- |');

  for (const row of rows) {
    lines.push(
      `| ${row.sampleId} | ${path.basename(row.sourcePdf)} | ${row.documentMainType} | ${row.outputStrategy} | ${row.referenceCount} | ${row.segments} | ${row.earlyGatePages} | ${row.lowConfidencePages} | ${row.secondPassRequired ? 'yes' : 'no'} | ${row.aAssistProbeTriggered ? 'yes' : 'no'} | ${row.aAssistProbeCompleted ? 'yes' : 'no'} | ${row.translationProbeCompleted ? 'yes' : 'no'} | ${row.zhPopulationPct} | ${row.bModelBatchJsonOk}/${row.bModelBatchAttempts} | ${row.bModelLastErrorKind} | ${row.scriptDerivedHumanReviewItems} | ${row.notes} |`
    );
  }

  lines.push('');
  lines.push('## Metric notes');
  lines.push('');
  lines.push(
    '- `zhPopulationPct`：结构化 segment 中带非空译文字段的比例（百分比）；受 `EVAL_FULLCHAIN_MAX_SEGMENTS` 等批处理上限影响，不等于“全文人工作业完成度”。'
  );
  lines.push('');

  lines.push('## Human Review Checklist');
  lines.push('');
  lines.push('- 抽取完整性：关键说明、表格、标签是否都进入结构化结果。');
  lines.push('- 翻译可用性：术语准确、句义完整、可直接给业务使用。');
  lines.push('- 定位可追溯性：能定位回页码/区域并解释低置信原因。');
  lines.push('- 导出可用性：渲染与导出结果是否保持源段落映射。');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  ({ runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline'));

  const manifestPaths = process.argv.slice(2);
  const targets =
    manifestPaths.length > 0
      ? manifestPaths
      : [
          'data/20260315/manifest.json',
          'data/20260324/manifest.json',
          'data/local/manifest.json'
        ];

  const missingManifests: string[] = [];
  const rows: FullchainEvalRow[] = [];
  for (const manifestPath of targets) {
    if (!existsSync(manifestPath)) {
      console.warn(`[eval-fullchain] skip manifest (missing): ${manifestPath}`);
      missingManifests.push(manifestPath);
      continue;
    }
    const manifest = await loadManifest(manifestPath);
    for (const sample of manifest.samples) {
      const sourcePdf = sample.source.find((item) => item.role === 'source_pdf')?.path;
      if (!sourcePdf) continue;
      const resolvedSource = path.isAbsolute(sourcePdf)
        ? sourcePdf
        : path.resolve(process.cwd(), sourcePdf);
      if (!existsSync(resolvedSource)) {
        console.warn(
          `[eval-fullchain] skip sample ${sample.sample_id}: missing source ${resolvedSource}`
        );
        continue;
      }
      const referenceCount = sample.references?.length ?? 0;
      rows.push(await evaluateSourcePdf(resolvedSource, sample.sample_id, referenceCount));
    }
    void manifest.dataset_date;
  }

  const markdown = toMarkdown(rows, missingManifests);
  const outputPath = path.join('docs', 'project', 'fullchain-eval-report.md');
  await writeFile(outputPath, markdown, 'utf8');
  console.log(markdown);
  console.log(`Saved report to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
