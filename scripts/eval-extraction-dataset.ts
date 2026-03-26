import { readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  LOW_CONF_LAYOUT_THRESHOLD,
  LOW_CONF_MERGE_THRESHOLD,
  buildFeedbackSourceReferenceWithDiagnostics
} from '../src/lib/assistant/feedback-source';
import { extractPdfText } from '../src/lib/assistant/file-extractor';

type FileSummary = {
  file: string;
  pages: number;
  lines: number;
  sections: number;
  regions: number;
  segments: number;
  layoutCounts: Record<string, number>;
  avgSegmentsPerPage: number;
  avgRegionsPerPage: number;
  lowConfidenceSegments: number;
  earlyGatePages: number;
  lowConfidencePages: number;
  secondPassRequired: boolean;
  secondPassExecuted: boolean;
  sourceTypeCounts: Record<string, number>;
  hasTablePage: boolean;
  hasReferencePage: boolean;
};

type DatasetSummary = {
  dataset: string;
  files: FileSummary[];
};

async function listPdfFiles(dir: string) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    // 评测数据目录在不同分支/机器上可能缺失：这里跳过，保证脚本可跑通并产出报告。
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      console.warn(`[eval-extraction-dataset] skip dir (missing): ${dir}`);
      return [];
    }
    throw err;
  }
  const pdfs: string[] = [];

  for (const entry of entries.sort()) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (!info.isFile()) continue;
    if (!entry.toLowerCase().endsWith('.pdf')) continue;
    pdfs.push(full);
  }

  return pdfs;
}

async function summarizeFile(file: string): Promise<FileSummary> {
  const extracted = await extractPdfText(file);
  if (!extracted.success) {
    throw new Error(`Failed to extract ${file}: ${extracted.error}`);
  }

  const { reference: ref, diagnostics } = buildFeedbackSourceReferenceWithDiagnostics(extracted, {
    name: path.basename(file)
  });
  const layoutCounts = ref.sections.reduce<Record<string, number>>((acc, section) => {
    acc[section.pageLayoutType] = (acc[section.pageLayoutType] ?? 0) + 1;
    return acc;
  }, {});

  const lines = extracted.pages.reduce((sum, page) => sum + page.lines.length, 0);
  const segments = ref.sections.reduce((sum, section) => sum + section.segments.length, 0);
  const regionIds = new Set<string>();
  const sourceTypeCounts: Record<string, number> = {};
  let lowConfidenceSegments = 0;

  for (const section of ref.sections) {
    for (const segment of section.segments) {
      regionIds.add(segment.regionId);
      const sourceType = segment.extractionMeta.sourceType;
      sourceTypeCounts[sourceType] = (sourceTypeCounts[sourceType] ?? 0) + 1;
      if (
        segment.extractionMeta.layoutConfidence < LOW_CONF_LAYOUT_THRESHOLD ||
        segment.extractionMeta.mergeConfidence < LOW_CONF_MERGE_THRESHOLD
      ) {
        lowConfidenceSegments += 1;
      }
    }
  }

  const regions = regionIds.size;

  return {
    file,
    pages: extracted.pages.length,
    lines,
    sections: ref.sections.length,
    regions,
    segments,
    layoutCounts,
    avgSegmentsPerPage: Number((segments / Math.max(1, extracted.pages.length)).toFixed(2)),
    avgRegionsPerPage: Number((regions / Math.max(1, extracted.pages.length)).toFixed(2)),
    lowConfidenceSegments,
    earlyGatePages: diagnostics.earlyGatePages.length,
    lowConfidencePages: diagnostics.lowConfidencePages.length,
    secondPassRequired: diagnostics.secondPassRequired,
    secondPassExecuted: diagnostics.secondPassExecuted,
    sourceTypeCounts,
    hasTablePage: Boolean(layoutCounts.table),
    hasReferencePage: Boolean(layoutCounts.reference)
  };
}

function toMarkdown(datasets: DatasetSummary[], skippedDirs: string[]) {
  const lines: string[] = [];
  lines.push('# Extraction Dataset Evaluation');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');

  if (skippedDirs.length > 0) {
    lines.push('## Dataset Coverage Note');
    lines.push('');
    lines.push(`- 以下目录缺失，因此本次报告未覆盖主数据集样本：${skippedDirs.join(', ')}`);
    lines.push('');
  }

  for (const dataset of datasets) {
    lines.push(`## ${dataset.dataset}`);
    lines.push('');
    lines.push(
      '| File | Pages | Regions | Avg Region/Page | Segments | Avg Seg/Page | LowConf Seg | EarlyGate Pages | LowConf Pages | 2nd Pass Required | 2nd Pass Executed | SourceTypes | Layouts |'
    );
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |');
    for (const file of dataset.files) {
      const layoutText = Object.entries(file.layoutCounts)
        .map(([key, value]) => `${key}:${value}`)
        .join(', ');
      const sourceTypeText = Object.entries(file.sourceTypeCounts)
        .map(([key, value]) => `${key}:${value}`)
        .join(', ');
      lines.push(
        `| ${path.basename(file.file)} | ${file.pages} | ${file.regions} | ${file.avgRegionsPerPage} | ${file.segments} | ${file.avgSegmentsPerPage} | ${file.lowConfidenceSegments} | ${file.earlyGatePages} | ${file.lowConfidencePages} | ${file.secondPassRequired ? 'yes' : 'no'} | ${file.secondPassExecuted ? 'yes' : 'no'} | ${sourceTypeText} | ${layoutText} |`
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const datasetDirs = process.argv.slice(2);
  const dirs = datasetDirs.length > 0 ? datasetDirs : ['data/20260315', 'data/20260324'];
  const datasets: DatasetSummary[] = [];
  const skippedDirs: string[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      skippedDirs.push(dir);
      continue;
    }
    const files = await listPdfFiles(dir);
    const summaries: FileSummary[] = [];
    for (const file of files) {
      summaries.push(await summarizeFile(file));
    }
    datasets.push({ dataset: dir, files: summaries });
  }

  const markdown = toMarkdown(datasets, skippedDirs);
  const outputPath = path.join('docs', 'project', 'vision-extraction-dataset-eval.md');
  await writeFile(outputPath, markdown, 'utf8');
  console.log(markdown);
  console.log(`Saved report to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
