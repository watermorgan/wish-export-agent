import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';

import { buildFeedbackSourceReferenceWithDiagnostics } from '@/lib/assistant/feedback-source';
import { extractPdfText } from '@/lib/assistant/file-extractor';
import { callQwenChat, isQwenConfigured } from '@/lib/assistant/qwen-client';
import {
  createQwenVisionProvider,
  extractWithVisionFallback,
  type ExtractedBlock
} from '@/lib/assistant/vision-extraction';

const DEBUG_PIPELINE = process.env.ASSISTANT_DEBUG_PIPELINE === '1';

function logPipelineDebug(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_PIPELINE) return;
  console.log(`[assistant:pipeline] ${event} ${JSON.stringify(payload)}`);
}

type PipelineInput = {
  filePath: string;
  fileName: string;
  maxSegmentsForTranslation?: number;
};

export type DocumentMainType = 'sketch_comment' | 'tp_bom_table_heavy' | 'mixed';
export type OutputStrategy = 'annotated_pdf' | 'bilingual_table_bundle';

export type PipelineResult = {
  fileName: string;
  success: boolean;
  documentMainType: DocumentMainType;
  outputStrategy: OutputStrategy;
  diagnostics: {
    earlyGatePages: number[];
    lowConfidencePages: number[];
    secondPassRequired: boolean;
    secondPassExecuted: boolean;
    aModelTriggered: boolean;
    aModelExecuted: boolean;
    bModelExecuted: boolean;
  };
  segments: Array<{
    id: string;
    text: string;
    zh?: string;
    pageNumber: number;
    regionId: string;
    extractionMeta: {
      sourceType: string;
      layoutConfidence: number;
      mergeConfidence: number;
      regionId?: string;
      bbox?: { x: number; y: number; w: number; h: number };
    };
  }>;
  outputs: {
    annotatedPdf?: {
      mode: 'inline_bilingual_preferred';
      downloadable?: {
        kind: 'annotated_html_preview';
        relativePath: string;
      };
      items: Array<{
        id: string;
        pageNumber: number;
        regionId: string;
        en: string;
        zh?: string;
        renderMode: 'inline' | 'footnote';
      }>;
      footnotes: Array<{ index: number; id: string; zh: string }>;
    };
    bilingualTableBundle?: {
      format: 'table_bundle_v1';
      downloadable?: {
        kind: 'bilingual_xlsx';
        relativePath: string;
      };
      rows: Array<{
        id: string;
        pageNumber: number;
        regionId: string;
        sourceType: string;
        layoutConfidence: number;
        mergeConfidence: number;
        en: string;
        zh?: string;
      }>;
    };
  };
  error?: string;
};

const EXPORT_ROOT = process.env.ASSISTANT_EXPORT_DIR ?? path.join('.tmp', 'exports');

function inferDocumentMainType(
  layoutCounts: Record<string, number>,
  avgSegmentsPerPage: number
): DocumentMainType {
  const table = layoutCounts.table ?? 0;
  const reference = layoutCounts.reference ?? 0;
  const mixed = layoutCounts.mixed ?? 0;
  const total = Math.max(1, table + reference + mixed);
  const tableRatio = table / total;

  if (tableRatio >= 0.45 || avgSegmentsPerPage >= 24) {
    return 'tp_bom_table_heavy';
  }
  if (reference >= table && avgSegmentsPerPage <= 14) {
    return 'sketch_comment';
  }
  return 'mixed';
}

function selectOutputStrategy(documentMainType: DocumentMainType): OutputStrategy {
  return documentMainType === 'tp_bom_table_heavy' ? 'bilingual_table_bundle' : 'annotated_pdf';
}

function buildBilingualTableBundle(segments: PipelineResult['segments']) {
  return {
    format: 'table_bundle_v1' as const,
    rows: segments.map((segment) => ({
      id: segment.id,
      pageNumber: segment.pageNumber,
      regionId: segment.regionId,
      sourceType: segment.extractionMeta.sourceType,
      layoutConfidence: segment.extractionMeta.layoutConfidence,
      mergeConfidence: segment.extractionMeta.mergeConfidence,
      en: segment.text,
      zh: segment.zh
    }))
  };
}

async function materializeBilingualXlsx(
  fileName: string,
  bundle: ReturnType<typeof buildBilingualTableBundle>
) {
  await mkdir(EXPORT_ROOT, { recursive: true });
  const safeBase = fileName.replace(/[^\w.-]+/g, '_');
  const fingerprint = createHash('sha1')
    .update(`${fileName}:${Date.now()}:${bundle.rows.length}`)
    .digest('hex')
    .slice(0, 10);
  const outputName = `${safeBase}.${fingerprint}.bilingual.xlsx`;
  const absolutePath = path.join(EXPORT_ROOT, outputName);
  const relativePath = path.relative(process.cwd(), absolutePath);
  const rows = bundle.rows.map((row, index) => ({
    RowNo: index + 1,
    SegmentId: row.id,
    PageNumber: row.pageNumber,
    RegionId: row.regionId,
    SourceType: row.sourceType,
    LayoutConfidence: row.layoutConfidence,
    MergeConfidence: row.mergeConfidence,
    English: row.en,
    Chinese: row.zh ?? ''
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bilingual');
  const binary = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  await writeFile(absolutePath, binary);
  return {
    kind: 'bilingual_xlsx' as const,
    relativePath
  };
}

async function materializeAnnotatedHtmlPreview(
  fileName: string,
  annotated: ReturnType<typeof buildAnnotatedPdfOutput>
) {
  await mkdir(EXPORT_ROOT, { recursive: true });
  const safeBase = fileName.replace(/[^\w.-]+/g, '_');
  const fingerprint = createHash('sha1')
    .update(`${fileName}:${Date.now()}:${annotated.items.length}`)
    .digest('hex')
    .slice(0, 10);
  const outputName = `${safeBase}.${fingerprint}.annotated-preview.html`;
  const absolutePath = path.join(EXPORT_ROOT, outputName);
  const relativePath = path.relative(process.cwd(), absolutePath);
  const footnoteMap = new Map(annotated.footnotes.map((it) => [it.id, it.index]));
  const rows = annotated.items
    .map((item) => {
      const footnoteIndex = footnoteMap.get(item.id);
      const pageRegion = `P${item.pageNumber} / ${item.regionId}`;
      const zh =
        item.renderMode === 'inline'
          ? `<div class="zh-inline">${escapeHtml(item.zh ?? '')}</div>`
          : footnoteIndex
            ? `<div class="zh-footnote-ref">见脚注 [${footnoteIndex}]</div>`
            : '<div class="zh-footnote-ref">待人工补译</div>';
      return `
      <article class="item">
        <div class="meta">${escapeHtml(pageRegion)}</div>
        <div class="en">${escapeHtml(item.en)}</div>
        ${zh}
      </article>`;
    })
    .join('\n');
  const footnotes = annotated.footnotes
    .map(
      (it) =>
        `<li><strong>[${it.index}]</strong> <span>${escapeHtml(it.zh)}</span></li>`
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Annotated Preview - ${escapeHtml(fileName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 24px; line-height: 1.6; color: #111827; background: #f8fafc; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    .sub { margin: 0 0 20px; color: #4b5563; font-size: 13px; }
    .item { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
    .meta { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .en { color: #111827; }
    .zh-inline { margin-top: 6px; color: #0f766e; background: #ecfeff; border-left: 3px solid #14b8a6; padding: 6px 10px; border-radius: 6px; }
    .zh-footnote-ref { margin-top: 6px; color: #92400e; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 6px 10px; border-radius: 6px; }
    .footnotes { margin-top: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; }
    .footnotes h2 { font-size: 15px; margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(fileName)} - 双语预览</h1>
  <p class="sub">模式：inline bilingual 优先；超长文本回退脚注。</p>
  ${rows || '<p>无可渲染条目。</p>'}
  <section class="footnotes">
    <h2>脚注</h2>
    <ol>${footnotes || '<li>无脚注</li>'}</ol>
  </section>
</body>
</html>`;
  await writeFile(absolutePath, html, 'utf8');
  return {
    kind: 'annotated_html_preview' as const,
    relativePath
  };
}

function escapeHtml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildAnnotatedPdfOutput(segments: PipelineResult['segments']) {
  const footnotes: Array<{ index: number; id: string; zh: string }> = [];
  const items = segments.map((segment) => {
    const zh = segment.zh;
    if (!zh) {
      return {
        id: segment.id,
        pageNumber: segment.pageNumber,
        regionId: segment.regionId,
        en: segment.text,
        zh: undefined,
        renderMode: 'footnote' as const
      };
    }
    // Inline bilingual first; fallback to footnote when text is long.
    if (segment.text.length + zh.length <= 220) {
      return {
        id: segment.id,
        pageNumber: segment.pageNumber,
        regionId: segment.regionId,
        en: segment.text,
        zh,
        renderMode: 'inline' as const
      };
    }
    footnotes.push({ index: footnotes.length + 1, id: segment.id, zh });
    return {
      id: segment.id,
      pageNumber: segment.pageNumber,
      regionId: segment.regionId,
      en: segment.text,
      zh,
      renderMode: 'footnote' as const
    };
  });
  return {
    mode: 'inline_bilingual_preferred' as const,
    items,
    footnotes
  };
}

async function translateSegmentsWithModelB(
  segments: PipelineResult['segments'],
  maxSegmentsForTranslation?: number
): Promise<Map<string, string>> {
  const translated = new Map<string, string>();
  if (!isQwenConfigured() || segments.length === 0) return translated;
  const scopedSegments =
    typeof maxSegmentsForTranslation === 'number' && maxSegmentsForTranslation > 0
      ? segments.slice(0, maxSegmentsForTranslation)
      : segments;

  const batchSize = 10;
  for (let i = 0; i < scopedSegments.length; i += batchSize) {
    const batch = scopedSegments.slice(i, i + batchSize);
    const prompt = [
      '你是服装工艺单翻译模型(B)。仅翻译结构化片段，不做结构识别，不做内容合并。',
      '输出 JSON：{"translations":[{"id":"...","zh":"..."}]}。',
      '请保留每个 id，不要新增或删除。',
      '',
      '片段：',
      JSON.stringify(
        batch.map((s) => ({
          id: s.id,
          text: s.text
        }))
      )
    ].join('\n');

    try {
      const result = await callQwenChat({
        messages: [
          { role: 'system', content: 'You are a precise segment translation model.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        maxTokens: 1400
      });
      const normalized = result.text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(normalized) as {
        translations?: Array<{ id?: string; zh?: string }>;
      };
      for (const item of parsed.translations ?? []) {
        if (item.id && item.zh) {
          translated.set(item.id, item.zh);
        }
      }
    } catch {
      // keep best-effort behavior; untranslated segments remain pending human review.
    }
  }
  return translated;
}

export async function runPdfTranslationPipeline(input: PipelineInput): Promise<PipelineResult> {
  const pipelineId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logPipelineDebug('pipeline.start', {
    pipelineId,
    fileName: input.fileName,
    hasMaxSegmentsLimit: typeof input.maxSegmentsForTranslation === 'number'
  });
  const extracted = await extractPdfText(input.filePath);
  if (!extracted.success) {
    logPipelineDebug('pipeline.extract_failed', {
      pipelineId,
      fileName: input.fileName,
      error: extracted.error ?? 'extract failed'
    });
    return {
      fileName: input.fileName,
      success: false,
      documentMainType: 'mixed',
      outputStrategy: 'annotated_pdf',
      diagnostics: {
        earlyGatePages: [],
        lowConfidencePages: [],
        secondPassRequired: false,
        secondPassExecuted: false,
        aModelTriggered: false,
        aModelExecuted: false,
        bModelExecuted: false
      },
      segments: [],
      outputs: {},
      error: extracted.error ?? 'extract failed'
    };
  }

  const built = buildFeedbackSourceReferenceWithDiagnostics(extracted, { name: input.fileName });
  const layoutCounts = built.reference.sections.reduce<Record<string, number>>((acc, section) => {
    acc[section.pageLayoutType] = (acc[section.pageLayoutType] ?? 0) + 1;
    return acc;
  }, {});
  const sectionCount = Math.max(1, built.reference.sections.length);
  const avgSegmentsPerPage =
    built.reference.sections.reduce((sum, section) => sum + section.segments.length, 0) / sectionCount;
  const documentMainType = inferDocumentMainType(layoutCounts, avgSegmentsPerPage);
  const outputStrategy = selectOutputStrategy(documentMainType);
  logPipelineDebug('pipeline.layout_classified', {
    pipelineId,
    fileName: input.fileName,
    documentMainType,
    outputStrategy,
    earlyGatePages: built.diagnostics.earlyGatePages,
    lowConfidencePages: built.diagnostics.lowConfidencePages
  });
  const lowConfidenceSegments = built.reference.sections
    .flatMap((section) => section.segments)
    .filter((segment) => built.diagnostics.lowConfidenceRegionIds.includes(segment.regionId));
  const textLayerBlocks: ExtractedBlock[] = lowConfidenceSegments.map((segment) => ({
    pageNumber: segment.pageNumber,
    regionId: segment.regionId,
    regionType: 'paragraph_block',
    text: segment.text,
    confidence: Math.min(
      segment.extractionMeta.layoutConfidence,
      segment.extractionMeta.mergeConfidence
    ),
    sourceType: 'text_layer'
  }));
  const aModelTriggered = textLayerBlocks.length > 0;
  let aModelExecuted = false;
  try {
    const aResult = await extractWithVisionFallback(
      {
        filePath: input.filePath,
        mimeType: 'application/pdf',
        textLayerBlocks
      },
      aModelTriggered ? createQwenVisionProvider() : undefined
    );
    aModelExecuted = aModelTriggered && !aResult.fallbackUsed;
    logPipelineDebug('pipeline.a_model_result', {
      pipelineId,
      fileName: input.fileName,
      aModelTriggered,
      aModelExecuted,
      fallbackUsed: aResult.fallbackUsed,
      provider: aResult.provider ?? 'none'
    });
  } catch {
    aModelExecuted = false;
    logPipelineDebug('pipeline.a_model_error', {
      pipelineId,
      fileName: input.fileName,
      aModelTriggered
    });
  }

  const segments: PipelineResult['segments'] = built.reference.sections.flatMap((section) =>
    section.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      pageNumber: segment.pageNumber,
      regionId: segment.regionId,
      extractionMeta: segment.extractionMeta
    }))
  );

  const translatedMap = await translateSegmentsWithModelB(
    segments,
    input.maxSegmentsForTranslation
  );
  for (const segment of segments) {
    const zh = translatedMap.get(segment.id);
    if (zh) segment.zh = zh;
  }
  logPipelineDebug('pipeline.b_model_result', {
    pipelineId,
    fileName: input.fileName,
    translatedCount: translatedMap.size,
    totalSegments: segments.length,
    limitedByMaxSegments: typeof input.maxSegmentsForTranslation === 'number'
  });
  const tableBundle = buildBilingualTableBundle(segments);
  const annotatedPdf = buildAnnotatedPdfOutput(segments);
  const outputs: PipelineResult['outputs'] =
    outputStrategy === 'bilingual_table_bundle'
      ? { bilingualTableBundle: tableBundle }
      : { annotatedPdf };
  if (outputs.bilingualTableBundle) {
    try {
      outputs.bilingualTableBundle.downloadable = await materializeBilingualXlsx(
        path.basename(input.fileName),
        tableBundle
      );
    } catch {
      // keep structure available even when file write fails
    }
  }
  if (outputs.annotatedPdf) {
    try {
      outputs.annotatedPdf.downloadable = await materializeAnnotatedHtmlPreview(
        path.basename(input.fileName),
        annotatedPdf
      );
    } catch {
      // keep structure available even when file write fails
    }
  }

  return {
    fileName: path.basename(input.fileName),
    success: true,
    documentMainType,
    outputStrategy,
    diagnostics: {
      earlyGatePages: built.diagnostics.earlyGatePages,
      lowConfidencePages: built.diagnostics.lowConfidencePages,
      secondPassRequired: built.diagnostics.secondPassRequired,
      secondPassExecuted: built.diagnostics.secondPassExecuted,
      aModelTriggered,
      aModelExecuted,
      bModelExecuted: translatedMap.size > 0
    },
    segments,
    outputs
  };
}
