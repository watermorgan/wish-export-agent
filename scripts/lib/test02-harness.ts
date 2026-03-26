import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { extractPdfText } from '../../src/lib/assistant/file-extractor';
import type { PipelineResult } from '../../src/lib/assistant/translation-pipeline';

export type SampleEntry = {
  sample_id: string;
  source: Array<{ role: string; path: string }>;
  references?: Array<{ role: string; path: string }>;
};

export type DatasetManifest = {
  dataset_date: string;
  dataset_name?: string;
  notes?: string;
  samples: SampleEntry[];
};

export type RunDirectories = {
  runId: string;
  runRoot: string;
  exportsDir: string;
  samplesDir: string;
  reportsDir: string;
  uiDir: string;
};

export type ReferenceItem = {
  sourceRole: string;
  sourcePath: string;
  index: number;
  text: string;
  pageNumber?: number;
  lineNumber?: number;
  sheetName?: string;
  rowNumber?: number;
  columnNumber?: number;
  locationLabel: string;
};

export type NormalizedReferenceDocument = {
  role: string;
  path: string;
  kind: 'pdf' | 'xlsx';
  pageCount?: number;
  sheetNames?: string[];
  itemCount: number;
  items: ReferenceItem[];
};

export type NormalizedReferenceBundle = {
  sampleId: string;
  generatedAt: string;
  documents: NormalizedReferenceDocument[];
  totalReferenceItems: number;
};

export type AiComparisonItem = {
  index: number;
  source: 'segments' | 'annotated_preview' | 'bilingual_table_bundle';
  pageNumber?: number;
  regionId?: string;
  textEn: string;
  textZh: string;
  locationLabel: string;
};

export type SideBySideComparisonRow = {
  index: number;
  ai?: AiComparisonItem;
  reference?: ReferenceItem;
};

export type SampleComparison = {
  sampleId: string;
  sourcePdf: string | null;
  references: Array<{ role: string; path: string }>;
  aiArtifacts: {
    annotatedPreview: string | null;
    bilingualXlsx: string | null;
    tableStylePdf: string | null;
  };
  aiStats: {
    totalSegments: number;
    translatedSegmentCount: number;
    translationCoveragePct: number;
    outputStrategy: string;
    documentMainType: string;
    hasAnnotatedPreview: boolean;
    hasBilingualTableBundle: boolean;
  };
  referenceStats: {
    documentCount: number;
    totalReferenceItems: number;
  };
  sideBySideRows: SideBySideComparisonRow[];
  reviewHints: string[];
  generatedAt: string;
};

type SummaryRow = {
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

const MARKDOWN_COMPARE_ROW_LIMIT = 80;

export function nowRunId() {
  const d = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join('') + '-' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
}

export function resolveManifestPath(manifestArg = 'data/test02/manifest.json') {
  return path.isAbsolute(manifestArg)
    ? manifestArg
    : path.resolve(process.cwd(), manifestArg);
}

export function buildRunDirectories(runId: string): RunDirectories {
  const runRoot = path.resolve(process.cwd(), 'data', 'test02', 'runs', runId);
  return {
    runId,
    runRoot,
    exportsDir: path.join(runRoot, 'exports'),
    samplesDir: path.join(runRoot, 'samples'),
    reportsDir: path.join(runRoot, 'reports'),
    uiDir: path.join(runRoot, 'ui')
  };
}

export async function ensureRunDirectories(runId: string) {
  const dirs = buildRunDirectories(runId);
  await mkdir(dirs.exportsDir, { recursive: true });
  await mkdir(dirs.samplesDir, { recursive: true });
  await mkdir(dirs.reportsDir, { recursive: true });
  await mkdir(dirs.uiDir, { recursive: true });
  return dirs;
}

export async function loadManifest(manifestPath: string) {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as DatasetManifest;
}

export function resolveRepoPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function toRepoRelative(value: string) {
  return path.relative(process.cwd(), value);
}

async function normalizeReferencePdf(role: string, sourcePath: string) {
  const extracted = await extractPdfText(sourcePath);
  const items: ReferenceItem[] = [];

  extracted.pages.forEach((page) => {
    page.lines
      .map((line, lineIndex) => ({
        lineIndex,
        text: line.trim()
      }))
      .filter((item) => item.text.length > 0)
      .forEach((item) => {
        items.push({
          sourceRole: role,
          sourcePath: toRepoRelative(sourcePath),
          index: items.length + 1,
          text: item.text,
          pageNumber: page.pageNumber,
          lineNumber: item.lineIndex + 1,
          locationLabel: `P${page.pageNumber}L${item.lineIndex + 1}`
        });
      });
  });

  return {
    role,
    path: toRepoRelative(sourcePath),
    kind: 'pdf' as const,
    pageCount: extracted.pages.length,
    itemCount: items.length,
    items
  };
}

async function normalizeReferenceXlsx(role: string, sourcePath: string) {
  const workbook = XLSX.readFile(sourcePath, { cellText: true, cellDates: false });
  const items: ReferenceItem[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet['!ref'];
    if (!ref) {
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let column = range.s.c; column <= range.e.c; column++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = sheet[cellAddress];
        const text = cell?.w?.toString().trim() ?? cell?.v?.toString().trim() ?? '';
        if (!text) {
          continue;
        }

        items.push({
          sourceRole: role,
          sourcePath: toRepoRelative(sourcePath),
          index: items.length + 1,
          text,
          sheetName,
          rowNumber: row + 1,
          columnNumber: column + 1,
          locationLabel: `${sheetName}!R${row + 1}C${column + 1}`
        });
      }
    }
  }

  return {
    role,
    path: toRepoRelative(sourcePath),
    kind: 'xlsx' as const,
    sheetNames: workbook.SheetNames,
    itemCount: items.length,
    items
  };
}

export async function normalizeReferenceBundle(sample: SampleEntry) {
  const documents: NormalizedReferenceDocument[] = [];
  for (const reference of sample.references ?? []) {
    const resolved = resolveRepoPath(reference.path);
    if (!existsSync(resolved)) {
      continue;
    }

    if (reference.role === 'reference_pdf') {
      documents.push(await normalizeReferencePdf(reference.role, resolved));
      continue;
    }

    if (reference.role === 'reference_xlsx') {
      documents.push(await normalizeReferenceXlsx(reference.role, resolved));
    }
  }

  return {
    sampleId: sample.sample_id,
    generatedAt: new Date().toISOString(),
    documents,
    totalReferenceItems: documents.reduce((sum, document) => sum + document.itemCount, 0)
  } satisfies NormalizedReferenceBundle;
}

export function normalizeAiComparisonItems(pipeline: PipelineResult) {
  if (pipeline.outputs.bilingualTableBundle?.rows?.length) {
    return pipeline.outputs.bilingualTableBundle.rows.map((row, index) => ({
      index: index + 1,
      source: 'bilingual_table_bundle' as const,
      pageNumber: row.pageNumber,
      regionId: row.regionId,
      textEn: row.en ?? '',
      textZh: row.zh?.trim() ?? '',
      locationLabel: `P${row.pageNumber ?? '?'} · ${row.regionId ?? 'region'}`
    }));
  }

  if (pipeline.outputs.annotatedPdf?.items?.length) {
    return pipeline.outputs.annotatedPdf.items.map((item, index) => ({
      index: index + 1,
      source: 'annotated_preview' as const,
      pageNumber: item.pageNumber,
      regionId: item.regionId,
      textEn: item.en ?? '',
      textZh: item.zh?.trim() ?? '',
      locationLabel: `P${item.pageNumber ?? '?'} · ${item.regionId ?? 'region'}`
    }));
  }

  return pipeline.segments.map((segment, index) => ({
    index: index + 1,
    source: 'segments' as const,
    pageNumber: segment.pageNumber,
    regionId: segment.regionId,
    textEn: segment.text ?? '',
    textZh: segment.zh?.trim() ?? '',
    locationLabel: `P${segment.pageNumber ?? '?'} · ${segment.regionId ?? 'region'}`
  }));
}

function buildReviewHints(
  pipeline: PipelineResult,
  referenceBundle: NormalizedReferenceBundle
) {
  const hints = [
    '先看 AI 中文是否覆盖关键页，再看术语是否与人工参考件一致。',
    '优先检查价格、交期、认证、付款、物流等高风险内容是否进入待确认。'
  ];

  if (referenceBundle.totalReferenceItems === 0) {
    hints.push('当前样本没有人工参考件，只能人工查看 AI 结果是否可用。');
  }

  if (!pipeline.diagnostics.isBusinessPreviewReady) {
    hints.push('当前覆盖率低于业务预览阈值，请不要把产物当成完整翻译稿。');
  }

  if (!pipeline.outputs.annotatedPdf?.downloadable && !pipeline.outputs.bilingualTableBundle?.downloadable) {
    hints.push('当前没有可直接打开的预览/Excel 产物，需先检查 pipeline 输出。');
  }

  return hints;
}

export function buildSampleComparison(
  sample: SampleEntry,
  pipeline: PipelineResult,
  referenceBundle: NormalizedReferenceBundle
) {
  const aiItems = normalizeAiComparisonItems(pipeline);
  const referenceItems = referenceBundle.documents.flatMap((document) => document.items);
  const rowCount = Math.max(aiItems.length, referenceItems.length);
  const sideBySideRows: SideBySideComparisonRow[] = [];

  for (let index = 0; index < rowCount; index++) {
    sideBySideRows.push({
      index: index + 1,
      ai: aiItems[index],
      reference: referenceItems[index]
    });
  }

  return {
    sampleId: sample.sample_id,
    sourcePdf: sample.source.find((item) => item.role === 'source_pdf')?.path ?? null,
    references: sample.references ?? [],
    aiArtifacts: {
      annotatedPreview: pipeline.outputs.annotatedPdf?.downloadable?.relativePath ?? null,
      bilingualXlsx: pipeline.outputs.bilingualTableBundle?.downloadable?.relativePath ?? null,
      tableStylePdf: pipeline.outputs.bilingualTableBundle?.downloadableTableStylePdf?.relativePath ?? null
    },
    aiStats: {
      totalSegments: pipeline.segments.length,
      translatedSegmentCount: pipeline.diagnostics.translatedSegmentCount,
      translationCoveragePct: pipeline.diagnostics.translationCoveragePct,
      outputStrategy: pipeline.outputStrategy,
      documentMainType: pipeline.documentMainType,
      hasAnnotatedPreview: Boolean(pipeline.outputs.annotatedPdf?.downloadable?.relativePath),
      hasBilingualTableBundle: Boolean(pipeline.outputs.bilingualTableBundle?.downloadable?.relativePath)
    },
    referenceStats: {
      documentCount: referenceBundle.documents.length,
      totalReferenceItems: referenceBundle.totalReferenceItems
    },
    sideBySideRows,
    reviewHints: buildReviewHints(pipeline, referenceBundle),
    generatedAt: new Date().toISOString()
  } satisfies SampleComparison;
}

export function buildComparisonMarkdown(comparison: SampleComparison) {
  const lines: string[] = [];
  lines.push(`# ${comparison.sampleId} AI vs 人工参考对比`);
  lines.push('');
  lines.push(`- Source PDF: \`${comparison.sourcePdf ?? '-'}\``);
  lines.push(
    `- AI Coverage: ${comparison.aiStats.translatedSegmentCount}/${comparison.aiStats.totalSegments} (${comparison.aiStats.translationCoveragePct}%)`
  );
  lines.push(`- Output Strategy: ${comparison.aiStats.outputStrategy}`);
  lines.push(`- Document Type: ${comparison.aiStats.documentMainType}`);
  lines.push(`- Reference Documents: ${comparison.referenceStats.documentCount}`);
  lines.push(`- Reference Items: ${comparison.referenceStats.totalReferenceItems}`);
  lines.push('');
  lines.push('## 产物路径');
  lines.push('');
  lines.push(`- Annotated Preview: \`${comparison.aiArtifacts.annotatedPreview ?? '-'}\``);
  lines.push(`- Bilingual XLSX: \`${comparison.aiArtifacts.bilingualXlsx ?? '-'}\``);
  lines.push(`- Table-style PDF: \`${comparison.aiArtifacts.tableStylePdf ?? '-'}\``);
  lines.push('');
  lines.push('## 人工复核提示');
  lines.push('');
  for (const hint of comparison.reviewHints) {
    lines.push(`- ${hint}`);
  }
  lines.push('');
  lines.push('## Side-by-side');
  lines.push('');
  lines.push('| # | AI 位置 | AI 英文 | AI 中文 | 参考位置 | 参考文本 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  for (const row of comparison.sideBySideRows.slice(0, MARKDOWN_COMPARE_ROW_LIMIT)) {
    lines.push(
      `| ${row.index} | ${escapeMarkdownTable(row.ai?.locationLabel ?? '-')} | ${escapeMarkdownTable(row.ai?.textEn ?? '-')} | ${escapeMarkdownTable(row.ai?.textZh ?? '-')} | ${escapeMarkdownTable(row.reference?.locationLabel ?? '-')} | ${escapeMarkdownTable(row.reference?.text ?? '-')} |`
    );
  }

  if (comparison.sideBySideRows.length > MARKDOWN_COMPARE_ROW_LIMIT) {
    lines.push('');
    lines.push(
      `> 仅展示前 ${MARKDOWN_COMPARE_ROW_LIMIT} 行对比；完整结果请查看 \`comparison.json\`。`
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function escapeMarkdownTable(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br/>').trim() || '-';
}

export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function writeMarkdown(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

export function buildSummaryMarkdown(runId: string, manifestPath: string, summaries: SummaryRow[]) {
  const lines: string[] = [];
  lines.push('# test02 Regression Run');
  lines.push('');
  lines.push(`- Run ID: \`${runId}\``);
  lines.push(`- Manifest: \`${manifestPath}\``);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '| Sample | Status | DocType | OutputStrategy | Coverage | PreviewReady | Comparison | References | Notes |'
  );
  lines.push('| --- | --- | --- | --- | ---: | --- | --- | ---: | --- |');

  for (const item of summaries) {
    const coverage =
      item.totalSegments && typeof item.translatedSegmentCount === 'number'
        ? `${item.translatedSegmentCount}/${item.totalSegments} (${item.translationCoveragePct ?? 0}%)`
        : '-';
    const notes =
      item.status === 'missing_source'
        ? `missing source: ${item.sourcePdf ?? '-'}`
        : item.status === 'failed'
          ? item.error ?? 'pipeline failed'
          : item.previewSuppressedReason ?? '';

    lines.push(
      `| ${item.sampleId} | ${item.status} | ${item.documentMainType ?? '-'} | ${item.outputStrategy ?? '-'} | ${coverage} | ${item.businessPreviewReady ? 'yes' : 'no'} | ${item.comparisonReady ? 'yes' : 'no'} | ${item.referenceCount} | ${notes} |`
    );
  }

  lines.push('');
  lines.push('## Directory Layout');
  lines.push('');
  lines.push('- `exports/`: 可直接打开的 HTML / PDF / XLSX 结果');
  lines.push('- `samples/<sample_id>/pipeline-result.json`: 每个样本的完整算法输出与中间结构');
  lines.push('- `samples/<sample_id>/reference-normalized.json`: 人工参考件标准化结果');
  lines.push('- `samples/<sample_id>/comparison.json`: AI vs 人工参考件对比结构');
  lines.push('- `samples/<sample_id>/comparison.md`: 便于人工查看的对比摘要');
  lines.push('- `reports/summary.json`: 本轮汇总结果');
  lines.push('- `reports/summary.md`: 便于人工查看的 Markdown 汇总');
  lines.push('');
  return `${lines.join('\n')}\n`;
}
