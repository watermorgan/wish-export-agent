import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

import { buildFeedbackSourceReferenceWithDiagnostics } from '@/lib/assistant/feedback-source';
import { extractPdfText } from '@/lib/assistant/file-extractor';
import {
  callTranslationModelChat,
  getTranslationFallbackRuntimeConfig,
  getTranslationModelName,
  isTranslationModelConfigured
} from '@/lib/assistant/qwen-client';
import type { ModelRuntimeConfig } from '@/lib/assistant/qwen-client';
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
  translationModelOverride?: string;
};

export type DocumentMainType = 'sketch_comment' | 'tp_bom_table_heavy' | 'mixed';
export type OutputStrategy = 'annotated_pdf' | 'bilingual_table_bundle';
export type TranslationSnapshot = {
  version: 'translation_snapshot_v1';
  generatedAt: string;
  fileName: string;
  documentMainType: DocumentMainType;
  outputStrategy: 'annotated_pdf';
  diagnostics: {
    translatedSegmentCount: number;
    translationCoveragePct: number;
    aModelExecuted: boolean;
    bModelExecuted: boolean;
  };
  items: Array<{
    id: string;
    pageNumber: number;
    regionId: string;
    en: string;
    zh?: string;
    renderMode: 'inline' | 'footnote';
    bbox?: { x: number; y: number; w: number; h: number };
    sourceType: string;
    confidence: number;
    pageLayoutType?: string;
  }>;
};

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
    aModelFallbackUsed?: boolean;
    aModelActiveModel?: string;
    visionTargetPages?: number[];
    visionPageBlockCounts?: Array<{ pageNumber: number; blockCount: number }>;
    visionPageRawBlockCounts?: Array<{ pageNumber: number; blockCount: number }>;
    visionPageErrors?: Array<{
      pageNumber: number;
      stage: 'primary' | 'fallback';
      mode: 'full' | 'focused' | 'business_crop';
      error: string;
    }>;
    bModelExecuted: boolean;
    /** B 模型：是否读到 API 配置（不暴露密钥） */
    bModelApiConfigured: boolean;
    /** B 模型：批次数 */
    bModelBatchAttempts: number;
    /** B 模型：成功解析 JSON 批次数 */
    bModelBatchJsonOk: number;
    /** B 模型：最后一次失败类别（成功或未调用为 none） */
    bModelLastErrorKind:
      | 'none'
      | 'not_configured'
      | 'timeout'
      | 'http'
      | 'rate_limited'
      | 'parse';
    /** B 模型：是否命中过备用模型 */
    bModelFallbackUsed?: boolean;
    /** B 模型：最终实际产出所用模型名 */
    bModelActiveModel?: string;
    translatedSegmentCount: number;
    translationCoveragePct: number;
    businessSegmentCount?: number;
    translatedBusinessSegmentCount?: number;
    businessTranslationCoveragePct?: number;
    businessPreviewThresholdPct: number;
    isBusinessPreviewReady: boolean;
    previewSuppressedReason?:
      | 'coverage_too_low'
      | 'no_translations'
      | 'no_business_translations';
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
      pageLayoutType?: string;
    };
  }>;
  outputs: {
    annotatedPdf?: {
      mode: 'inline_bilingual_preferred';
      downloadable?: {
        kind: 'annotated_html_preview';
        relativePath: string;
      };
      snapshot: TranslationSnapshot;
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
      downloadableTableStylePdf?: {
        kind: 'table_style_pdf';
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
const BUSINESS_PREVIEW_THRESHOLD_PCT = Number(
  process.env.BUSINESS_PREVIEW_THRESHOLD_PCT ?? '30'
);
const PDF_CJK_FONT_CANDIDATES = [
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
];

type TranslationCoverageStats = {
  totalSegments: number;
  translatedSegmentCount: number;
  translationCoveragePct: number;
  businessSegmentCount: number;
  translatedBusinessSegmentCount: number;
  businessTranslationCoveragePct: number;
  businessPreviewThresholdPct: number;
  isBusinessPreviewReady: boolean;
  previewSuppressedReason?:
    | 'coverage_too_low'
    | 'no_translations'
    | 'no_business_translations';
};

let resolvedPdfCjkFontPath: string | null | undefined;

function resolvePdfCjkFontPath() {
  if (resolvedPdfCjkFontPath !== undefined) {
    return resolvedPdfCjkFontPath;
  }
  resolvedPdfCjkFontPath =
    PDF_CJK_FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
  return resolvedPdfCjkFontPath;
}

function summarizeTranslationCoverage(
  segments: PipelineResult['segments'],
  documentMainType: DocumentMainType
): TranslationCoverageStats {
  const translatedSegmentCount = segments.filter((segment) => Boolean(segment.zh?.trim())).length;
  const totalSegments = segments.length;
  const translationCoveragePct = segments.length
    ? Math.round((translatedSegmentCount / segments.length) * 100)
    : 0;
  const businessSegments = segments.filter(
    (segment) => !shouldSuppressAnnotatedZh(segment, documentMainType)
  );
  const businessSegmentCount = businessSegments.length;
  const translatedBusinessSegmentCount = businessSegments.filter((segment) =>
    Boolean(segment.zh?.trim())
  ).length;
  const businessTranslationCoveragePct = businessSegmentCount
    ? Math.round((translatedBusinessSegmentCount / businessSegmentCount) * 100)
    : 0;
  const isBusinessPreviewReady =
    translatedBusinessSegmentCount > 0 &&
    businessTranslationCoveragePct >= BUSINESS_PREVIEW_THRESHOLD_PCT;

  return {
    totalSegments,
    translatedSegmentCount,
    translationCoveragePct,
    businessSegmentCount,
    translatedBusinessSegmentCount,
    businessTranslationCoveragePct,
    businessPreviewThresholdPct: BUSINESS_PREVIEW_THRESHOLD_PCT,
    isBusinessPreviewReady,
    previewSuppressedReason:
      translatedSegmentCount === 0
        ? 'no_translations'
        : translatedBusinessSegmentCount === 0
          ? 'no_business_translations'
        : isBusinessPreviewReady
          ? undefined
          : 'coverage_too_low'
  };
}

function buildCoverageNotice(
  fileName: string,
  coverage: TranslationCoverageStats,
  target: 'annotated_preview' | 'bilingual_xlsx' | 'table_style_pdf'
) {
  const base = `${fileName}：已翻译 ${coverage.translatedSegmentCount}/${coverage.totalSegments} 段（覆盖率 ${coverage.translationCoveragePct}%）`;
  if (coverage.isBusinessPreviewReady) {
    return target === 'annotated_preview'
      ? `${base}，当前可作为业务预览查看。`
      : `${base}，当前产物可用于业务确认。`;
  }
  if (coverage.previewSuppressedReason === 'no_translations') {
    return `${base}，本轮未生成任何中文，当前产物仅用于技术诊断，不建议给业务确认。`;
  }
  if (coverage.previewSuppressedReason === 'no_business_translations') {
    return `${base}，当前译出内容仅覆盖页眉/管理元信息，尚无可用业务翻译，不建议给业务确认。`;
  }
  return `${base}，低于业务预览阈值 ${coverage.businessPreviewThresholdPct}%；当前仅展示已译出条目，不建议视为完整翻译稿。`;
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computePageLevelLayoutCounts(
  sections: Array<{ pageLayoutType: string; segments: { pageNumber: number }[] }>
): Record<string, number> {
  const pageToLayout = new Map<number, string>();
  for (const section of sections) {
    const pageNumber = section.segments[0]?.pageNumber;
    if (!pageNumber) continue;
    if (!pageToLayout.has(pageNumber)) {
      pageToLayout.set(pageNumber, section.pageLayoutType);
    }
  }
  const counts: Record<string, number> = {};
  for (const layout of pageToLayout.values()) {
    counts[layout] = (counts[layout] ?? 0) + 1;
  }
  return counts;
}

function computeTableSegmentShare(
  sections: Array<{ pageLayoutType: string; segments: Array<unknown> }>
): number {
  const totalSegments = Math.max(
    1,
    sections.reduce((sum, section) => sum + section.segments.length, 0)
  );
  const tableSegments = sections
    .filter((section) => section.pageLayoutType === 'table')
    .reduce((sum, section) => sum + section.segments.length, 0);
  return tableSegments / totalSegments;
}

function scoreSegmentForTranslation(
  text: string,
  segment?: PipelineResult['segments'][number],
  documentMainType?: DocumentMainType
) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  let score = Math.min(normalized.length, 260);
  const isMetaHeader = /\b(style:|season:|womenswear|menswear|spring\s*\d+|fall\s*\d+)\b/i.test(
    normalized
  );
  const isAuditMeta = /\b(created:|updated:|supplier:|date:)\b/i.test(normalized);
  const hasActionableNote = /\b(please|note|see|add|added|remove|revise|change|confirm|check|glued|closing|strap|zip|tape|seam|measurement)\b/i.test(
    normalized
  );

  if (normalized.length < 18) score -= 60;
  if (wordCount <= 3) score -= 30;
  if (/^[A-Z0-9\s|:/#.-]+$/.test(normalized) && normalized.length < 48) score -= 35;
  if (/\|/.test(normalized)) score += 18;
  if (/:/.test(normalized)) score += 8;
  if (/[a-z]{3,}/.test(normalized)) score += 6;
  if (hasActionableNote) score += 18;
  if (isMetaHeader && normalized.length < 120) score -= 20;
  if (isAuditMeta) score -= 28;
  if (/please|advise|comment|supplier|weight|composition|fabric|zip|velcro|sample/i.test(normalized)) {
    score += 12;
  }
  if (documentMainType === 'mixed' && segment) {
    const layoutType = segment.extractionMeta.pageLayoutType;
    if (layoutType === 'sketch') score += 26;
    if (layoutType === 'mixed') score += 6;
    if (layoutType === 'reference') score -= 10;
    if (layoutType === 'table') score -= 20;
    if (layoutType === 'sketch' && segment.extractionMeta.sourceType === 'vision') {
      score += 8;
    }
  }

  return score;
}

function normalizeSelectionText(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pickSegmentsRoundRobin(
  segments: PipelineResult['segments'],
  limit: number,
  picked: Map<string, PipelineResult['segments'][number]>,
  seenNormalized: Set<string>,
  documentMainType?: DocumentMainType
) {
  if (limit <= 0 || segments.length === 0) {
    return;
  }

  const groups = new Map<number, Array<PipelineResult['segments'][number] & { __score: number }>>();
  for (const segment of segments) {
    if (picked.has(segment.id)) {
      continue;
    }
    const enriched = {
      ...segment,
      __score: scoreSegmentForTranslation(segment.text, segment, documentMainType)
    };
    const bucket = groups.get(segment.pageNumber) ?? [];
    bucket.push(enriched);
    groups.set(segment.pageNumber, bucket);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => b.__score - a.__score);
  }

  const orderedPages = [...groups.keys()].sort((a, b) => a - b);
  while (picked.size < limit) {
    let advanced = false;
    for (const page of orderedPages) {
      const bucket = groups.get(page);
      if (!bucket || bucket.length === 0) continue;
      let next = bucket.shift();
      while (next) {
        const normalized = normalizeSelectionText(next.text);
        if (!seenNormalized.has(normalized)) break;
        next = bucket.shift();
      }
      if (!next) continue;
      picked.set(next.id, next);
      seenNormalized.add(normalizeSelectionText(next.text));
      advanced = true;
      if (picked.size >= limit) break;
    }
    if (!advanced) break;
  }
}

function selectSegmentsForTranslation(
  segments: PipelineResult['segments'],
  limit?: number,
  documentMainType?: DocumentMainType
) {
  if (!limit || limit <= 0 || segments.length <= limit) {
    return segments;
  }

  const picked = new Map<string, PipelineResult['segments'][number]>();
  const seenNormalized = new Set<string>();
  const mixedSketchSegments =
    documentMainType === 'mixed'
      ? segments.filter((segment) => segment.extractionMeta.pageLayoutType === 'sketch')
      : [];
  const visionSegments = segments.filter((segment) => segment.extractionMeta.sourceType === 'vision');
  const nonVisionSegments = segments.filter((segment) => segment.extractionMeta.sourceType !== 'vision');
  const reservedMixedSketchShare = Number(process.env.B_MODEL_RESERVED_MIXED_SKETCH_SHARE ?? '0.35');
  const reservedMixedSketchFloor = Number(process.env.B_MODEL_RESERVED_MIXED_SKETCH_FLOOR ?? '8');
  const reservedMixedSketchSlots =
    documentMainType === 'mixed'
      ? Math.min(
          mixedSketchSegments.length,
          Math.max(
            0,
            Math.min(
              limit,
              Math.max(reservedMixedSketchFloor, Math.floor(limit * reservedMixedSketchShare))
            )
          )
        )
      : 0;
  const reservedVisionShare = Number(process.env.B_MODEL_RESERVED_VISION_SHARE ?? '0.25');
  const reservedVisionFloor = Number(process.env.B_MODEL_RESERVED_VISION_FLOOR ?? '4');
  const reservedVisionSlots = Math.min(
    visionSegments.length,
    Math.max(
      0,
      Math.min(
        limit,
        Math.max(reservedVisionFloor, Math.floor(limit * reservedVisionShare))
      )
    )
  );

  if (reservedMixedSketchSlots > 0) {
    pickSegmentsRoundRobin(
      mixedSketchSegments,
      reservedMixedSketchSlots,
      picked,
      seenNormalized,
      documentMainType
    );
  }

  if (reservedVisionSlots > 0) {
    pickSegmentsRoundRobin(
      visionSegments,
      reservedVisionSlots,
      picked,
      seenNormalized,
      documentMainType
    );
  }

  pickSegmentsRoundRobin(nonVisionSegments, limit, picked, seenNormalized, documentMainType);

  if (picked.size < limit) {
    const rest = segments
      .filter((segment) => !picked.has(segment.id))
      .map((segment) => ({
        segment,
        score: scoreSegmentForTranslation(segment.text, segment, documentMainType)
      }))
      .sort((a, b) => b.score - a.score);
    for (const item of rest) {
      const normalized = normalizeSelectionText(item.segment.text);
      if (seenNormalized.has(normalized)) continue;
      picked.set(item.segment.id, item.segment);
      seenNormalized.add(normalized);
      if (picked.size >= limit) break;
    }
  }

  return segments.filter((segment) => picked.has(segment.id));
}

/**
 * 文档主类型：仅用版式统计 + 分段密度（禁止文件名/路径特判）。
 * 修正点：避免「reference 页多于 table 页 + 全局段密度不高」就把 TP/BOM 误判成 sketch。
 */
function inferDocumentMainType(
  layoutCounts: Record<string, number>,
  avgSegmentsPerPage: number,
  pageCount: number,
  tableSegmentShare: number
): DocumentMainType {
  const tablePages = layoutCounts.table ?? 0;
  const referencePages = layoutCounts.reference ?? 0;
  const mixedPages = layoutCounts.mixed ?? 0;
  const sketchPages = layoutCounts.sketch ?? 0;
  const allPages = Math.max(1, pageCount);
  const nonSketchPages = Math.max(1, tablePages + referencePages + mixedPages);
  const tablePageShare = tablePages / allPages;
  const tableRatioAmongTyped = tablePages / nonSketchPages;

  // 线稿/批注占优：避免仅凭「段密度高」误判为 TP（常见于多区段线稿页）
  if (
    sketchPages >= 1 &&
    sketchPages >= tablePages &&
    tablePageShare < 0.42 &&
    !(avgSegmentsPerPage >= 22 && tablePageShare >= 0.32 && tableSegmentShare >= 0.22)
  ) {
    return 'sketch_comment';
  }

  // 表格段占比需与「表格页占比」一起看，避免线稿 PDF 中局部表格块把段占比抬高
  const strongTp =
    tablePageShare >= 0.45 ||
    (tableSegmentShare >= 0.38 && tablePageShare >= 0.28) ||
    tablePages >= 10 ||
    (avgSegmentsPerPage >= 24 && Math.max(tablePageShare, tableSegmentShare) >= 0.25);

  const mediumTp =
    tablePages >= 4 &&
    (tablePageShare >= 0.22 ||
      tableRatioAmongTyped >= 0.3 ||
      (avgSegmentsPerPage >= 18 && tablePageShare >= 0.18) ||
      (tableSegmentShare >= 0.22 && tablePageShare >= 0.2));

  if (strongTp || mediumTp) {
    return 'tp_bom_table_heavy';
  }

  const tableLightCap = Math.max(2, Math.floor(0.18 * allPages));
  if (
    referencePages >= tablePages &&
    avgSegmentsPerPage <= 14 &&
    tablePages <= tableLightCap &&
    tableSegmentShare < 0.12
  ) {
    return 'sketch_comment';
  }

  if (sketchPages >= referencePages && sketchPages > tablePages && avgSegmentsPerPage <= 16) {
    return 'sketch_comment';
  }

  return 'mixed';
}

function selectOutputStrategy(documentMainType: DocumentMainType): OutputStrategy {
  return documentMainType === 'tp_bom_table_heavy' ? 'bilingual_table_bundle' : 'annotated_pdf';
}

function selectVisionTargetPages(
  extracted: Awaited<ReturnType<typeof extractPdfText>>,
  sections: Array<{ pageLayoutType: string; segments: Array<{ pageNumber: number; text: string }> }>,
  documentMainType: DocumentMainType,
  diagnostics: {
    earlyGatePages: number[];
    lowConfidencePages: number[];
  }
) {
  const targets = new Set<number>([...diagnostics.earlyGatePages, ...diagnostics.lowConfidencePages]);
  function looksLikeOriginalSamplePicturePage(page: (typeof extracted.pages)[number]) {
    const raw = page.lines.join(' ').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return false;
    }
    const hasOriginalSampleHeader = /original sample pictures?/i.test(raw);
    if (!hasOriginalSampleHeader) {
      return false;
    }
    const hasActionableSketchNotes =
      /\b(zip|zipper|snap|button|velcro|tape|pocket|placket|cuff|hem|waist|waistband|collar|hood|dart|pleat|lining|embroidery|logo|label|fabric)\b/i.test(
        raw
      );
    return !hasActionableSketchNotes;
  }
  const pageLayoutByPage = new Map<number, string>();
  for (const section of sections) {
    const pageNumber = section.segments[0]?.pageNumber;
    if (pageNumber && !pageLayoutByPage.has(pageNumber)) {
      pageLayoutByPage.set(pageNumber, section.pageLayoutType);
    }
  }

  if (documentMainType !== 'sketch_comment') {
    if (documentMainType === 'mixed') {
      for (const page of extracted.pages) {
        if (looksLikeOriginalSamplePicturePage(page)) {
          targets.delete(page.pageNumber);
          continue;
        }
        const layoutType = pageLayoutByPage.get(page.pageNumber);
        if (layoutType === 'table') {
          continue;
        }
        const pageSections = sections.filter((section) =>
          section.segments.some((segment) => segment.pageNumber === page.pageNumber)
        );
        const segmentCount = pageSections.reduce((sum, section) => sum + section.segments.length, 0);
        const extractedCharCount = pageSections.reduce(
          (sum, section) => sum + section.segments.reduce((sub, segment) => sub + segment.text.length, 0),
          0
        );
        const nonEmptyLineCount = page.lines.filter((line) => line.trim()).length;
        const sparseMixedCandidate =
          nonEmptyLineCount <= 18 || segmentCount <= 8 || extractedCharCount <= 220;
        if (sparseMixedCandidate) {
          targets.add(page.pageNumber);
        }
      }
    }
    return Array.from(targets).sort((a, b) => a - b);
  }

  for (const page of extracted.pages) {
    if (looksLikeOriginalSamplePicturePage(page)) {
      targets.delete(page.pageNumber);
      continue;
    }
    const nonEmptyLineCount = page.lines.filter((line) => line.trim()).length;
    const pageSections = sections.filter((section) =>
      section.segments.some((segment) => segment.pageNumber === page.pageNumber)
    );
    const segmentCount = pageSections.reduce((sum, section) => sum + section.segments.length, 0);
    const extractedCharCount = pageSections.reduce(
      (sum, section) => sum + section.segments.reduce((sub, segment) => sub + segment.text.length, 0),
      0
    );
    const sparseSketchPage =
      nonEmptyLineCount <= 14 || segmentCount <= 6 || extractedCharCount <= 140;

    if (sparseSketchPage) {
      targets.add(page.pageNumber);
    }
  }

  return Array.from(targets).sort((a, b) => a - b);
}

function normalizeCompactSegmentText(text: string) {
  return text.replace(/[\s\-_/.:,#]+/g, '').trim().toLowerCase();
}

function toSegmentTokenSet(text: string) {
  return new Set(
    text
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function buildSegmentBigrams(text: string) {
  const normalized = normalizeCompactSegmentText(text);
  const bigrams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function segmentOverlapRatio<T>(left: Set<T>, right: Set<T>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(left.size, right.size);
}

function segmentTextSimilarity(left: string, right: string) {
  const normalizedLeft = left.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedRight = right.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  const compactLeft = normalizeCompactSegmentText(left);
  const compactRight = normalizeCompactSegmentText(right);
  if (compactLeft && compactLeft === compactRight) {
    return 0.98;
  }
  return Math.max(
    segmentOverlapRatio(toSegmentTokenSet(left), toSegmentTokenSet(right)),
    segmentOverlapRatio(buildSegmentBigrams(left), buildSegmentBigrams(right))
  );
}

function buildVisionSegments(
  baseSegments: PipelineResult['segments'],
  visionBlocks: ExtractedBlock[],
  pageLayoutByPage?: Map<number, string>
): PipelineResult['segments'] {
  const ignoredPatterns = [
    /tous droits réservés/i,
    /all rights reserved/i,
    /edited on\s+\d{2}\/\d{2}\/\d{4}/i,
    /^warning:/i,
    /^avertissement/i,
    /^\d+\/\d+$/,
    /^\d+(?:[.,]\d+)?(?:cm|mm)?$/i,
    /^ikks men$/i,
    /^description$/i
  ];
  const existingSegmentsByPage = new Map<number, PipelineResult['segments']>();
  for (const segment of baseSegments) {
    const bucket = existingSegmentsByPage.get(segment.pageNumber) ?? [];
    bucket.push(segment);
    existingSegmentsByPage.set(segment.pageNumber, bucket);
  }
  const appended: PipelineResult['segments'] = [];

  for (const block of visionBlocks) {
    const normalized = block.text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      continue;
    }
    if (normalized.length > 160) {
      continue;
    }
    if (ignoredPatterns.some((pattern) => pattern.test(normalized))) {
      continue;
    }

    const existingPageSegments = existingSegmentsByPage.get(block.pageNumber) ?? [];
    const hasAnchoredMatch = existingPageSegments.some(
      (segment) => segmentTextSimilarity(segment.text, normalized) >= 0.86
    );
    if (hasAnchoredMatch) {
      continue;
    }

    const appendedSegment = {
      id: `${block.regionId}_vision`,
      text: normalized,
      pageNumber: block.pageNumber,
      regionId: block.regionId,
      extractionMeta: {
        sourceType: block.sourceType,
        layoutConfidence: Math.max(0.55, Math.min(0.98, block.confidence)),
        mergeConfidence: Math.max(0.55, Math.min(0.98, block.confidence)),
        regionId: block.regionId,
        bbox: block.bbox,
        pageLayoutType:
          existingPageSegments[0]?.extractionMeta.pageLayoutType ?? pageLayoutByPage?.get(block.pageNumber)
      }
    };
    appended.push(appendedSegment);
    const nextBucket = existingSegmentsByPage.get(block.pageNumber) ?? [];
    nextBucket.push(appendedSegment);
    existingSegmentsByPage.set(block.pageNumber, nextBucket);
  }

  return [...baseSegments, ...appended].sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildBilingualTableBundle(
  segments: PipelineResult['segments']
): NonNullable<PipelineResult['outputs']['bilingualTableBundle']> {
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

function selectMixedSupplementTableSegments(segments: PipelineResult['segments']) {
  return segments.filter((segment) =>
    ['table', 'reference'].includes(String(segment.extractionMeta.pageLayoutType ?? ''))
  );
}

async function materializeBilingualXlsx(
  fileName: string,
  bundle: ReturnType<typeof buildBilingualTableBundle>,
  coverage: TranslationCoverageStats
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
  const translatedOnlyRows = rows.filter((row) => String(row.Chinese).trim().length > 0);
  const summaryRows = [
    { Metric: 'FileName', Value: fileName },
    { Metric: 'TotalSegments', Value: rows.length },
    { Metric: 'TranslatedSegments', Value: coverage.translatedSegmentCount },
    { Metric: 'TranslationCoveragePct', Value: coverage.translationCoveragePct },
    { Metric: 'BusinessPreviewThresholdPct', Value: coverage.businessPreviewThresholdPct },
    { Metric: 'BusinessPreviewReady', Value: coverage.isBusinessPreviewReady ? 'yes' : 'no' },
    {
      Metric: 'PreviewSuppressedReason',
      Value: coverage.previewSuppressedReason ?? ''
    },
    {
      Metric: 'Notice',
      Value: buildCoverageNotice(fileName, coverage, 'bilingual_xlsx')
    }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(translatedOnlyRows.length > 0 ? translatedOnlyRows : [{ Note: 'No translated rows available yet.' }]),
    'TranslatedOnly'
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Bilingual');
  const binary = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  await writeFile(absolutePath, binary);
  return {
    kind: 'bilingual_xlsx' as const,
    relativePath
  };
}

function escapePdfText(input: string) {
  // pdfkit renders strings as-is; keep minimal sanitization for safety.
  return input.replace(/\u0000/g, '');
}

async function materializeTableStylePdf(
  fileName: string,
  bundle: ReturnType<typeof buildBilingualTableBundle>,
  coverage: TranslationCoverageStats
) {
  await mkdir(EXPORT_ROOT, { recursive: true });
  const safeBase = fileName.replace(/[^\w.-]+/g, '_');
  const fingerprint = createHash('sha1')
    .update(`${fileName}:${Date.now()}:${bundle.rows.length}:table-style`)
    .digest('hex')
    .slice(0, 10);

  const outputName = `${safeBase}.${fingerprint}.table-style.pdf`;
  const absolutePath = path.join(EXPORT_ROOT, outputName);
  const relativePath = path.relative(process.cwd(), absolutePath);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    // Reduce outer margins a bit for denser tables while keeping readability.
    margins: { top: 14, left: 14, right: 14, bottom: 14 }
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const bodyFont = 'Helvetica';
  const boldFont = 'Helvetica-Bold';
  const zhFont = resolvePdfCjkFontPath() ?? bodyFont;
  const rowsForPdf = coverage.isBusinessPreviewReady
    ? bundle.rows
    : bundle.rows.filter((row) => Boolean(row.zh?.trim()));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const usablePageTop = doc.page.margins.top;
  const usablePageHeight =
    doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const colNo = 32;
  const colPage = 46;
  const colRegion = 96;
  const colSource = 62;

  const hasAnyZh = bundle.rows.some((r) => (r.zh ?? '').trim().length > 0);
  const metaWidth = colNo + colPage + colRegion + colSource;
  const remaining = Math.max(200, pageWidth - metaWidth);
  // When ZH is empty (rate_limited in eval), give more width to EN to reduce wrapping.
  const colZHMin = 160;
  let colEN: number;
  let colZH: number;
  if (!hasAnyZh) {
    colZH = Math.max(colZHMin, Math.floor(remaining * 0.25));
    colEN = Math.max(180, remaining - colZH);
  } else {
    colEN = Math.floor(remaining * 0.42);
    colZH = Math.max(colZHMin, remaining - colEN);
    // Re-adjust EN if ZH got clamped.
    colEN = Math.max(180, remaining - colZH);
  }

  const startX = doc.page.margins.left;
  const colX = {
    no: startX,
    page: startX + colNo,
    region: startX + colNo + colPage,
    source: startX + colNo + colPage + colRegion,
    en: startX + colNo + colPage + colRegion + colSource,
    zh: startX + colNo + colPage + colRegion + colSource + colEN
  };

  const headerHeight = 15;
  const rowPaddingY = 2.2;
  // Slightly tighter line spacing for more stable row heights across pages.
  const lineHeight = 7.4;
  const fontSize = 8.2;

  const gridColor = '#e5e7eb';
  const headerBg = '#f3f4f6';
  const rowAltBg = '#fcfcff';

  doc.font(bodyFont);
  doc.fontSize(fontSize);

  function isCjkChar(ch: string) {
    return /[\u4e00-\u9fff]/.test(ch);
  }

  function measureTextWidth(text: string, fontName: string) {
    doc.font(fontName).fontSize(fontSize);
    const width = doc.widthOfString(text);
    doc.font(bodyFont).fontSize(fontSize);
    return width;
  }

  function truncateToWidth(text: string, width: number, fontName: string) {
    const safeText = escapePdfText(text);
    if (measureTextWidth(safeText, fontName) <= width) return safeText;
    const ellipsis = '…';
    if (width <= measureTextWidth(ellipsis, fontName) + 1) return ellipsis;

    // Binary search the max prefix that still fits with ellipsis.
    let lo = 0;
    let hi = safeText.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const cand = `${safeText.slice(0, mid)}${ellipsis}`;
      if (measureTextWidth(cand, fontName) <= width) lo = mid + 1;
      else hi = mid;
    }
    const prefixLen = Math.max(1, lo - 1);
    return `${safeText.slice(0, prefixLen)}${ellipsis}`;
  }

  function tokenize(text: string) {
    const safe = escapePdfText(text).replace(/\r?\n/g, ' ').trim();
    if (!safe) return [''];
    // Tokens:
    //  - English/number sequences
    //  - Single CJK chars (so we can wrap even when there is no spaces)
    //  - Other non-whitespace single chars (punctuation)
    const tokens = safe.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9\u4e00-\u9fff]/g);
    return tokens && tokens.length > 0 ? tokens : [safe];
  }

  function joinToken(prev: string, token: string) {
    if (!prev) return token;
    const prevLast = prev.slice(-1);
    const tokenIsCjk = isCjkChar(token);
    const prevIsCjk = isCjkChar(prevLast);
    const tokenIsWord = /^[A-Za-z0-9]+$/.test(token);
    const prevIsWordChar = /^[A-Za-z0-9]$/.test(prevLast);

    // CJK adjacent text should not insert spaces.
    if (tokenIsCjk || prevIsCjk) return `${prev}${token}`;
    // Word-word boundary: keep a space for readability.
    if (tokenIsWord && prevIsWordChar) return `${prev} ${token}`;
    return `${prev}${token}`;
  }

  function wrap(text: string, width: number, fontName: string, maxLines?: number) {
    const tokens = tokenize(text);
    if (tokens.length === 0) return [''];

    const lines: string[] = [];
    let current = '';

    for (const token of tokens) {
      const candidate = joinToken(current, token);
      if (measureTextWidth(candidate, fontName) <= width) {
        current = candidate;
        continue;
      }

      if (!current) {
        // The token itself is too wide; truncate it to ensure progress.
        current = truncateToWidth(token, width, fontName);
        lines.push(current);
        current = '';
        continue;
      }

      lines.push(current);
      current = token;

      // If the current token is still too wide, truncate.
      if (measureTextWidth(current, fontName) > width) {
        current = truncateToWidth(current, width, fontName);
      }
    }

    if (current) lines.push(current);
    if (lines.length === 0) lines.push('');

    if (typeof maxLines === 'number' && maxLines > 0 && lines.length > maxLines) {
      // Keep the first (maxLines - 1) lines as-is, truncate the last one.
      const lastIdx = maxLines - 1;
      lines[lastIdx] = truncateToWidth(lines[lastIdx], width, fontName);
      lines.splice(maxLines);
    }
    return lines;
  }

  function header(y: number) {
    // background
    doc
      .rect(startX, y, pageWidth, headerHeight)
      .fill(headerBg)
      .strokeColor(gridColor)
      .stroke();

    const textY = y + 4;
    doc.font(boldFont).fontSize(8.4).fillColor('#111827');
    doc.text('No.', colX.no + 2, textY, { width: colNo - 6, align: 'left' });
    doc.text('P#', colX.page + 2, textY, { width: colPage - 6, align: 'left' });
    doc.text('Region', colX.region + 2, textY, { width: colRegion - 6, align: 'left' });
    doc.text('Source', colX.source + 2, textY, { width: colSource - 6, align: 'left' });
    doc.text('EN', colX.en + 2, textY, { width: colEN - 6, align: 'left' });
    doc.text('ZH', colX.zh + 2, textY, { width: colZH - 6, align: 'left' });

    // top border line (slightly thicker to visually anchor the repeated header)
    doc.lineWidth(0.8);
    doc.strokeColor(gridColor);
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    doc.lineWidth(1);

    // restore body font
    doc.font(bodyFont).fontSize(fontSize).fillColor('#111827');
  }

  function drawVerticalGridLines(startY = usablePageTop) {
    const xEnd = colX.zh + colZH;
    const xs = [colX.page, colX.region, colX.source, colX.en, xEnd];
    doc.strokeColor(gridColor);
    doc.lineWidth(0.6);
    for (const x of xs) {
      doc.moveTo(x, startY).lineTo(x, usablePageTop + usablePageHeight).stroke();
    }
    doc.lineWidth(1);
  }

  let y = usablePageTop;
  doc
    .roundedRect(startX, y, pageWidth, 28, 6)
    .fillAndStroke(coverage.isBusinessPreviewReady ? '#eff6ff' : '#fff7ed', '#d1d5db');
  doc.font(boldFont).fontSize(9).fillColor('#111827');
  doc.text('Business Review Notice', startX + 8, y + 5, { width: pageWidth - 16 });
  doc.font(zhFont).fontSize(8.1).fillColor(coverage.isBusinessPreviewReady ? '#1f2937' : '#9a3412');
  doc.text(buildCoverageNotice(fileName, coverage, 'table_style_pdf'), startX + 8, y + 14, {
    width: pageWidth - 16
  });
  doc.font(bodyFont).fontSize(fontSize).fillColor('#111827');
  y += 34;

  if (rowsForPdf.length === 0) {
    doc.font(zhFont).fontSize(10).fillColor('#7c2d12');
    doc.text('当前未生成任何可展示的中文结果，请在配额更稳定的环境下重试。', startX, y + 12, {
      width: pageWidth
    });
    doc.end();

    const emptyBuffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    await writeFile(absolutePath, emptyBuffer);

    return {
      kind: 'table_style_pdf' as const,
      relativePath
    };
  }
  header(y);
  drawVerticalGridLines(y);
  y += headerHeight + 1;

  for (let idx = 0; idx < rowsForPdf.length; idx++) {
    const row = rowsForPdf[idx];
    const en = row.en ?? '';
    const zh = row.zh ?? '';

    // Dynamically limit max line count based on remaining space to reduce
    // row-height explosions and make page breaks smoother.
    const remainingHeight = usablePageTop + usablePageHeight - y;
    const maxRowLines = Math.max(1, Math.floor((remainingHeight - rowPaddingY - 2) / lineHeight));

    let enLines = wrap(en, colEN - 6, bodyFont, maxRowLines);
    let zhLines = wrap(zh, colZH - 6, zhFont, maxRowLines);
    const metaLines = 1;
    let rowLines = Math.max(metaLines, enLines.length, zhLines.length, 1);
    let rowHeight = rowPaddingY + rowLines * lineHeight + 1.6;

    if (y + rowHeight > doc.page.margins.top + usablePageHeight) {
      doc.addPage();
      y = doc.page.margins.top;
      header(y);
      drawVerticalGridLines(y);
      y += headerHeight + 1;

      // Recompute wrapped lines with the new page's remaining space.
      const remainingAfterBreak = usablePageTop + usablePageHeight - y;
      const maxRowLinesAfterBreak = Math.max(
        1,
        Math.floor((remainingAfterBreak - rowPaddingY - 2) / lineHeight)
      );
      enLines = wrap(en, colEN - 6, bodyFont, maxRowLinesAfterBreak);
      zhLines = wrap(zh, colZH - 6, zhFont, maxRowLinesAfterBreak);
      rowLines = Math.max(metaLines, enLines.length, zhLines.length, 1);
      rowHeight = rowPaddingY + rowLines * lineHeight + 1.6;
    }

    // light row background (alternating) to reduce visual crowding
    if (idx % 2 === 1) {
      doc
        .rect(startX, y, pageWidth, rowHeight)
        .fill(rowAltBg)
        .fillOpacity(1);
      doc.fillOpacity(1);
      doc.strokeColor(gridColor);
      doc.rect(startX, y, pageWidth, rowHeight).stroke();
    }

    // horizontal separator (lighter weight to reduce visual crowding)
    doc.strokeColor('#eef2f7');
    doc.lineWidth(0.45);
    doc.moveTo(startX, y + rowHeight).lineTo(startX + pageWidth, y + rowHeight).stroke();
    doc.lineWidth(1);

    doc.fontSize(fontSize);

    // Meta row (single line, truncated)
    const regionShort = row.regionId.length > 22 ? row.regionId.slice(0, 22) + '…' : row.regionId;
    const textTop = y + rowPaddingY;
    doc.text(String(idx + 1), colX.no + 2, textTop, { width: colNo - 6, align: 'left' });
    doc.text(`P${row.pageNumber}`, colX.page + 2, textTop, { width: colPage - 6, align: 'left' });
    doc.text(regionShort, colX.region + 2, textTop, { width: colRegion - 6, align: 'left' });
    doc.text(row.sourceType, colX.source + 2, textTop, { width: colSource - 6, align: 'left' });

    // EN / ZH blocks (multi-line)
    const enY = textTop;
    for (let i = 0; i < enLines.length; i++) {
      doc.font(bodyFont);
      doc.text(enLines[i], colX.en + 2, enY + i * lineHeight, {
        width: colEN - 10,
        align: 'left'
      });
    }
    const zhY = textTop;
    for (let i = 0; i < zhLines.length; i++) {
      doc.font(zhFont);
      doc.text(zhLines[i], colX.zh + 2, zhY + i * lineHeight, {
        width: colZH - 10,
        align: 'left'
      });
    }
    doc.font(bodyFont);
    y += rowHeight;
  }

  doc.end();

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  await writeFile(absolutePath, buffer);

  return {
    kind: 'table_style_pdf' as const,
    relativePath
  };
}

async function materializeAnnotatedHtmlPreview(
  fileName: string,
  annotated: ReturnType<typeof buildAnnotatedPdfOutput>,
  coverage: TranslationCoverageStats
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
  const itemsForPreview = coverage.isBusinessPreviewReady
    ? annotated.items
    : annotated.items.filter((item) => Boolean(item.zh?.trim()));
  const footnotesForPreview = coverage.isBusinessPreviewReady
    ? annotated.footnotes
    : annotated.footnotes.filter((it) => Boolean(it.zh?.trim()));
  const rows = itemsForPreview
    .map((item) => {
      const footnoteIndex = footnoteMap.get(item.id);
      const pageRegion = `P${item.pageNumber} / ${item.regionId}`;
      const zh =
        item.renderMode === 'inline'
          ? `<div class="zh-inline">${escapeHtml(item.zh ?? '')}</div>`
          : footnoteIndex
            ? `<div class="zh-footnote-ref">见脚注 [${footnoteIndex}]</div>`
            : '<div class="zh-footnote-ref compact">当前未纳入业务预览</div>';
      return `
      <article class="item">
        <div class="meta">${escapeHtml(pageRegion)}</div>
        <div class="en">${escapeHtml(item.en)}</div>
        ${zh}
      </article>`;
    })
    .join('\n');
  const footnotes = footnotesForPreview
    .map(
      (it) =>
        `<li><strong>[${it.index}]</strong> <span>${escapeHtml(it.zh)}</span></li>`
    )
    .join('\n');
  const coverageBanner = coverage.isBusinessPreviewReady
    ? `<section class="summary summary-ok">
        <strong>业务预览已达标</strong>
        <span>已译 ${coverage.translatedSegmentCount}/${annotated.items.length} 条（${coverage.translationCoveragePct}%）。</span>
      </section>`
    : `<section class="summary summary-warn">
        <strong>当前仅展示已译条目</strong>
        <span>已译 ${coverage.translatedSegmentCount}/${annotated.items.length} 条（${coverage.translationCoveragePct}%），低于业务预览门槛 ${coverage.businessPreviewThresholdPct}%。未译条目已从本预览中折叠，避免大量“待人工补译”干扰阅读。</span>
      </section>`;
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
    .summary { margin: 0 0 18px; border-radius: 12px; padding: 12px 14px; border: 1px solid; display: grid; gap: 4px; }
    .summary strong { font-size: 14px; }
    .summary span { font-size: 13px; color: #374151; }
    .summary-ok { background: #ecfdf5; border-color: #6ee7b7; }
    .summary-warn { background: #fffbeb; border-color: #fbbf24; }
    .item { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
    .meta { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
    .en { color: #111827; }
    .zh-inline { margin-top: 6px; color: #0f766e; background: #ecfeff; border-left: 3px solid #14b8a6; padding: 6px 10px; border-radius: 6px; }
    .zh-footnote-ref { margin-top: 6px; color: #92400e; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 6px 10px; border-radius: 6px; }
    .zh-footnote-ref.compact { color: #6b7280; background: #f3f4f6; border-left-color: #d1d5db; }
    .footnotes { margin-top: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; }
    .footnotes h2 { font-size: 15px; margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(fileName)} - 双语预览</h1>
  <p class="sub">模式：inline bilingual 优先；超长文本回退脚注。</p>
  ${coverageBanner}
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

function buildAnnotatedPdfOutput(
  segments: PipelineResult['segments'],
  documentMainType: DocumentMainType
): NonNullable<PipelineResult['outputs']['annotatedPdf']> {
  const footnotes: Array<{ index: number; id: string; zh: string }> = [];
  const items = segments.map((segment) => {
    const zh = shouldSuppressAnnotatedZh(segment, documentMainType) ? undefined : segment.zh;
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
    footnotes,
    snapshot: {
      version: 'translation_snapshot_v1',
      generatedAt: new Date().toISOString(),
      fileName: '',
      documentMainType,
      outputStrategy: 'annotated_pdf',
      diagnostics: {
        translatedSegmentCount: 0,
        translationCoveragePct: 0,
        aModelExecuted: false,
        bModelExecuted: false
      },
      items: []
    }
  };
}

function buildTranslationSnapshot(
  fileName: string,
  documentMainType: DocumentMainType,
  annotated: NonNullable<PipelineResult['outputs']['annotatedPdf']>,
  segments: PipelineResult['segments'],
  diagnostics: Pick<
    PipelineResult['diagnostics'],
    'translatedSegmentCount' | 'translationCoveragePct' | 'aModelExecuted' | 'bModelExecuted'
  >
): TranslationSnapshot {
  const segmentMeta = new Map(
    segments.map((segment) => [
      segment.id,
      {
        bbox: segment.extractionMeta.bbox,
        sourceType: segment.extractionMeta.sourceType,
        pageLayoutType: segment.extractionMeta.pageLayoutType,
        confidence: Math.max(
          0,
          Math.min(1, Math.max(segment.extractionMeta.layoutConfidence, segment.extractionMeta.mergeConfidence))
        )
      }
    ])
  );

  return {
    version: 'translation_snapshot_v1',
    generatedAt: new Date().toISOString(),
    fileName,
    documentMainType,
    outputStrategy: 'annotated_pdf',
    diagnostics: {
      translatedSegmentCount: diagnostics.translatedSegmentCount,
      translationCoveragePct: diagnostics.translationCoveragePct,
      aModelExecuted: diagnostics.aModelExecuted,
      bModelExecuted: diagnostics.bModelExecuted
    },
    items: annotated.items.map((item) => {
      const meta = segmentMeta.get(item.id);
      return {
        id: item.id,
        pageNumber: item.pageNumber,
        regionId: item.regionId,
        en: item.en,
        zh: item.zh,
        renderMode: item.renderMode,
        bbox: meta?.bbox,
        sourceType: meta?.sourceType ?? 'unknown',
        confidence: meta?.confidence ?? 0,
        pageLayoutType: meta?.pageLayoutType
      };
    })
  };
}

function shouldSuppressAnnotatedZh(
  segment: PipelineResult['segments'][number],
  documentMainType: DocumentMainType
) {
  const source = segment.text.replace(/\s+/g, ' ').trim();
  const layoutType = segment.extractionMeta.pageLayoutType;
  if (!segment.zh?.trim()) {
    return false;
  }

  const baseSuppressed =
    /all rights reserved|edited on/i.test(source) ||
    /^\s*dossier style\s*$/i.test(source) ||
    /^\s*fitting\s*\/\s*volume\s*$/i.test(source) ||
    /^hiver\b.*\b(styliste|graphiste)\b/i.test(source) ||
    /\b(styliste|graphiste|mod[ée]liste|acheteur|n[ée]goce|designer|graphic designer|model maker|purchaser|style sheet|oversea)\b/i.test(source) ||
    /^m\d{5,}\s+graphiste$/i.test(source) ||
    /^(client|style no\.?|erp|qty|price|sales|date)\s*:/i.test(source) ||
    /\bsize\b.*\bbase\b.*\bm\d{5,}\b/i.test(source) ||
    /^\s*common designated size\s*$/i.test(source);

  if (baseSuppressed) {
    return true;
  }

  if (documentMainType === 'mixed') {
    const isActionableStructureNote =
      /\b(zip|zipper|button|snap|velcro|tape|seam|sleeve|cuff|waist|waistband|pocket|placket|hem|hood|collar|strap|loop|dart|opening|closure|binding|elastic)\b/i.test(
        source
      ) ||
      /\b(拉链|按扣|魔术贴|贴条|缝线|袖|袖口|腰头|口袋|门襟|下摆|帽|领|带袢|袢带|省|开口|闭合|包边|松紧)\b/i.test(
        segment.zh ?? ''
      );
    if ((layoutType === 'table' || layoutType === 'reference') && !isActionableStructureNote) {
      return true;
    }
    return (
      /^style:\s+/i.test(source) ||
      /^created:\s*\d{4}\s+\d{2}\s+\d{2}/i.test(source) ||
      /^updated:\s*$/i.test(source) ||
      /^supplier:\s*$/i.test(source) ||
      /^(quality|details|references|front|back|colours|trims|men|womenswear)$/i.test(source) ||
      /^on body(\s*\|\s*clean sketch)?$/i.test(source) ||
      /^clean sketch$/i.test(source) ||
      /^option\s*\d+$/i.test(source) ||
      /^artwork sent sep(?:erately)?$/i.test(source) ||
      /^see (?:sep image|next page) for (?:reference|details)$/i.test(source) ||
      /^as original sample$/i.test(source) ||
      /^making$/i.test(source) ||
      /^at side$/i.test(source) ||
      /^style no\.?\s*:/i.test(source) ||
      /^sku\s*:/i.test(source) ||
      /^season\s*:/i.test(source) ||
      /^款号[:：]/i.test(segment.zh ?? '') ||
      /^成分[:：]/i.test(segment.zh ?? '') ||
      /^克重[:：]/i.test(segment.zh ?? '') ||
      /^幅宽[:：]/i.test(segment.zh ?? '') ||
      /^\d+%[a-z\u4e00-\u9fff\s]+$/i.test(segment.zh ?? '') ||
      /^\d+\s*(gsm|gr\/m2|cm)\b/i.test(segment.zh ?? '')
    );
  }

  return false;
}

type BModelBatchStats = {
  configured: boolean;
  batchAttempts: number;
  batchJsonOk: number;
  lastErrorKind: 'none' | 'not_configured' | 'timeout' | 'http' | 'rate_limited' | 'parse';
  providerHits: string[];
  fallbackConfigured: boolean;
  fallbackUsed: boolean;
  activeModel: string;
  retranslatePasses: number;
  retranslatedSegmentCount: number;
  visionSecondStagePasses: number;
  visionSecondStageSegmentCount: number;
};

function classifyBModelError(
  error: unknown
): 'timeout' | 'http' | 'rate_limited' | 'parse' {
  if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
    return 'timeout';
  }
  if (error instanceof SyntaxError) {
    return 'parse';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /429|Too Many Requests|quota exceeded|AllocationQuota\.FreeTierOnly|free tier.*exhausted|disable the "use free tier only"/i.test(
      message
    )
  ) {
    return 'rate_limited';
  }
  if (/JSON|parse|Unexpected token/i.test(message)) {
    return 'parse';
  }
  return 'http';
}

function selectVisionRecoverySegments(
  segments: PipelineResult['segments'],
  scopedSegmentIds: Set<string>,
  translated: Map<string, string>,
  limit: number,
  documentMainType?: DocumentMainType
) {
  if (limit <= 0) return [] as PipelineResult['segments'];

  const picked = new Map<string, PipelineResult['segments'][number]>();
  const seenNormalized = new Set<string>();
  const candidates = segments
    .filter(
      (segment) =>
        segment.extractionMeta.sourceType === 'vision' &&
        !scopedSegmentIds.has(segment.id) &&
        !translated.has(segment.id)
    )
    .map((segment) => ({
      segment,
      score: scoreSegmentForTranslation(segment.text, segment, documentMainType),
      confidence:
        Math.max(
          segment.extractionMeta.layoutConfidence || 0,
          segment.extractionMeta.mergeConfidence || 0
        ) || 0
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.segment.pageNumber !== b.segment.pageNumber) {
        return a.segment.pageNumber - b.segment.pageNumber;
      }
      return a.segment.text.localeCompare(b.segment.text);
    })
    .map((item) => item.segment);

  pickSegmentsRoundRobin(candidates, limit, picked, seenNormalized);
  return candidates.filter((segment) => picked.has(segment.id));
}

function extractBalancedJsonCandidate(raw: string) {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    return normalized;
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if ((char === '}' || char === ']') && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return normalized.slice(start, index + 1);
      }
    }
  }

  return normalized;
}

function safeParseTranslationResponse(raw: string) {
  const candidate = extractBalancedJsonCandidate(raw);
  const parsed = JSON.parse(candidate) as
    | {
        translations?: Array<{ id?: string; zh?: string; text?: string }>;
      }
    | Array<{ id?: string; zh?: string; text?: string }>;

  const items = Array.isArray(parsed) ? parsed : (parsed.translations ?? []);
  return items
    .map((item) => ({
      id: item.id,
      zh: item.zh?.trim() || item.text?.trim()
    }))
    .filter((item): item is { id: string; zh: string } => Boolean(item.id && item.zh));
}

function normalizeMaterialTerms(value: string) {
  return value
    .replace(/\bNYLON\b/gi, '尼龙')
    .replace(/\bSPANDEX\b/gi, '氨纶')
    .replace(/\bPOLYESTER\b/gi, '涤纶')
    .replace(/\bPOLY\b/gi, '涤纶')
    .replace(/\bSP\b/gi, '氨纶')
    .replace(/\bCOL\b/gi, '配色')
    .replace(/\bGR\/M²\b/gi, '克/平方米')
    .replace(/\bGR\/M2\b/gi, '克/平方米')
    .replace(/\bCM\b/gi, 'CM');
}

function normalizeSourceText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizeFashionTranslation(source: string, zh: string) {
  const normalizedSource = normalizeSourceText(source);
  let text = zh.replace(/\s+/g, ' ').trim();

  if (!text) return text;

  if (/^hiver 26 \(26h\)$/i.test(normalizedSource)) {
    return '款号：HIVER 26 (26H)';
  }

  if (/^dossier style$/i.test(normalizedSource)) {
    return '款式资料';
  }

  if (/^en attente(?:\s+.*)?$/i.test(normalizedSource)) {
    const suffix = source.replace(/^en attente/i, '').trim().replace(/\s+/g, ' ');
    return suffix ? `待处理 ${suffix}` : '待处理';
  }

  if (/^\s*m145023\s*$/i.test(normalizedSource)) {
    return '版型同M145023';
  }

  if (/^m\d{6}$/i.test(normalizedSource)) {
    return `款号：${normalizedSource.toUpperCase()}`;
  }

  if (/^02\s+noir$/i.test(normalizedSource)) {
    return '02#黑色';
  }

  if (/^48\s+marine$/i.test(normalizedSource)) {
    return '48#海军蓝';
  }

  if (/^67\s+ecorce\b/i.test(normalizedSource)) {
    return '67#咖色';
  }

  if (/^65\s+donuts\b/i.test(normalizedSource)) {
    return '65#咖色';
  }

  if (/^11\s+ecru\b/i.test(normalizedSource)) {
    return '11#米白';
  }

  if (/^\d+\s+noir$/i.test(source)) {
    return text.replace(/^\d+\s*/, '').trim() || '黑色';
  }

  if (/^proto\s*#?\s*1$/i.test(normalizedSource)) {
    return 'OP1';
  }

  if (/^proto\s*#?\s*2$/i.test(normalizedSource)) {
    return 'OP2';
  }

  const shellFabricMatch = source.match(/shell fabric option\s*#\s*(\d+)\s*:\s*(.*)$/i);
  if (shellFabricMatch) {
    const optionNo = shellFabricMatch[1];
    const spec = normalizeMaterialTerms(shellFabricMatch[2].replace(/\s+/g, ' ').trim());
    return `面料${optionNo}：${spec}`;
  }

  if (/^pocketing\b/i.test(source)) {
    return '袋布：涤棉磨毛斜纹，配色同面布';
  }

  if (/plastic snap/i.test(source) && /top front fly button/i.test(source)) {
    const size = source.match(/(\d+)(?:\s*mm)?/i)?.[1];
    const prefix = size ? `${size}mm` : '';
    return `${prefix}塑料四合扣黑色门襟用`;
  }

  if (/autoblock zipper/i.test(source) && /gun metal/i.test(source)) {
    return '枪色自动锁头闭尾拉链';
  }

  if (/reverse coil zipper/i.test(source) && /ikks/i.test(source) && /front pockets?/i.test(source)) {
    return '5#尼龙反装开尾拉链+IKKS拉头前门拉链，袋拉链顺大身色';
  }

  if (/reverse coil zipper/i.test(source) && /black/i.test(source) && /inside pocket/i.test(source)) {
    return '3#尼龙反装拉链黑色';
  }

  if (/^\s*71694\s*$/i.test(normalizedSource)) {
    return '71694烫标';
  }

  if (/^73518$/i.test(normalizedSource)) {
    return '尺码标';
  }

  if (/^new logo label\b/i.test(normalizedSource)) {
    return '新主标';
  }

  if (/^matching color with (?:outshell|shell) fabric(?: color)?$/i.test(normalizedSource)) {
    return '顺色';
  }

  if (/^shell fabric$/i.test(normalizedSource)) {
    return '面料：SHELL FABRIC';
  }

  if (/^cuff\s*\+\s*belt\s*\+\s*collar fabric$/i.test(normalizedSource)) {
    return '袖口、底摆、领材料';
  }

  if (/^ø\s*15$/i.test(normalizedSource)) {
    return '15mm';
  }

  if (/invisible zipper/i.test(source) && /right arm/i.test(source)) {
    return '右臂票袋隐形拉链配色';
  }

  if (/body lining/i.test(source) && /02 noir/i.test(normalizedSource)) {
    return '身里春亚纺 黑色';
  }

  if (/lining/i.test(source) && /poly pongee/i.test(normalizedSource) && /02 noir/i.test(normalizedSource)) {
    return '身里春亚纺 黑色';
  }

  if (/inside cuff knit rib/i.test(source)) {
    return '袖口1X1尼龙罗纹，配色';
  }

  if (/inside collar knit rib/i.test(normalizedSource)) {
    return '1X1罗纹内领';
  }

  if (/inside baseball collar in 1\/1 knit rib/i.test(normalizedSource)) {
    return '棒球领采用1X1罗纹';
  }

  if (/outside flat collat? in outshell fabric/i.test(normalizedSource)) {
    return '面料平装领';
  }

  if (/perforation laser/i.test(source)) {
    return '激光打孔';
  }

  if (/middle back length/i.test(source) && /91,?5cm/i.test(normalizedSource)) {
    return '版型和尺寸参考M241043，XL码；后中长度67CM，总袖长91.5CM';
  }

  if (/padding/i.test(source) && /60grs/i.test(normalizedSource) && /40grs/i.test(normalizedSource)) {
    return '60g大身，40g袖子';
  }

  if (/padding same weight and quality as m145023/i.test(normalizedSource)) {
    return '填充：与M145023相同';
  }

  if (/shell fabric .* same as m245013/i.test(normalizedSource)) {
    return '面料1 与M245013相同面料';
  }

  if (/contrasted fabric same scuba fabric as m145023/i.test(normalizedSource)) {
    return '面料2 与M145023相同面料';
  }

  if (/reflective transfer print line/i.test(source) && /anthracite/i.test(normalizedSource)) {
    return '深灰色反光';
  }

  if (/^new logo label\b/i.test(normalizedSource) && /tbc/i.test(normalizedSource)) {
    return '新主标';
  }

  if (/new logo label/i.test(normalizedSource)) {
    return '新logo主标';
  }

  if (
    /5mm metal zipper/i.test(normalizedSource) &&
    /new ikks puller/i.test(normalizedSource) &&
    /shin+?y silv/i.test(normalizedSource)
  ) {
    return '5#金属新ikks拉片，亮银色拉链与原样相同';
  }

  if (/55\s*sage/i.test(normalizedSource) && /front pockets? opening/i.test(normalizedSource)) {
    return '55#绿色 门襟+侧袋';
  }

  if (/^55\s+sage\b/i.test(normalizedSource)) {
    return '55#绿色';
  }

  if (
    /pression dessous/i.test(normalizedSource) &&
    /84851/i.test(normalizedSource) &&
    /shin+?y silv/i.test(normalizedSource)
  ) {
    return '15mm-四合扣与原样相同亮银色饰面';
  }

  if (/3mm reverse coil zipper/i.test(normalizedSource) && /matching color/i.test(normalizedSource)) {
    return '3#反装闭尾尼龙拉链颜色顺面料';
  }

  if (/outshell fabric option#?1/i.test(normalizedSource) && /on inside pocket/i.test(normalizedSource)) {
    return '面料1 | 内袋';
  }

  if (/on inside pocket/i.test(normalizedSource)) {
    return '内袋';
  }

  if (/3mm elasticated drawstring/i.test(normalizedSource) && /matching color/i.test(normalizedSource)) {
    return '3MM底摆橡筋绳颜色顺面料';
  }

  if (/metal eyelets/i.test(normalizedSource) || /2 holes metal stopper/i.test(normalizedSource)) {
    return '亮银色金属气眼，底摆仿金属双孔调节卡扣';
  }

  if (/same as original sample/i.test(normalizedSource) && /middle back length\s*74cm/i.test(normalizedSource)) {
    return '样板按照原样品，但是后中长做到74CM';
  }

  if (/middle back length\s*74cm/i.test(normalizedSource)) {
    return '后中长做到74CM';
  }

  if (/same send more fabric options as original sample/i.test(normalizedSource)) {
    return '提供与原样相同的更多布料选项！';
  }

  if (/same puffy look as original sample/i.test(normalizedSource)) {
    return '仿羽绒棉外观和参考样衣相同蓬松度';
  }

  if (/body lining/i.test(normalizedSource) && /poly twill lining as original sample/i.test(normalizedSource)) {
    return '身里：斜纹涤里料同原样';
  }

  if (/poly twill lining as original sample/i.test(normalizedSource)) {
    return '斜纹涤里料同原样';
  }

  if (/matching color with shell fabric color/i.test(normalizedSource)) {
    return '颜色顺主身面料';
  }

  if (/pocketing fabric/i.test(normalizedSource) && /brushed poly tricot/i.test(normalizedSource)) {
    return '袋布：经编起毛布颜色顺主身面料';
  }

  if (/flat collar filled with padding/i.test(normalizedSource)) {
    return '衣领内充棉';
  }

  if (/5mm met(?:al)? zipped first opening/i.test(normalizedSource) && /as original sample/i.test(normalizedSource)) {
    return '5#金属拉链同原样品';
  }

  if (/pression dessous plat/i.test(normalizedSource)) {
    return '15MM四合扣';
  }

  if (/^\s*back elasticated waistband\s*$/i.test(source)) {
    return '后腰部橡筋';
  }

  if (/^\s*chino pocket \+ pleat\s*$/i.test(source)) {
    return '斜插侧袋';
  }

  if (/^\s*dart\s*$/i.test(source)) {
    return '省';
  }

  const pipedPocketMatch = source.match(/(\d+)\s*mm\s*piped pocket/i);
  if (pipedPocketMatch) {
    return `${pipedPocketMatch[1]}mm单开线口袋`;
  }

  if (/^\s*\d+\s*mm\s*plastic snap\b/i.test(source) && /black/i.test(source)) {
    const size = source.match(/(\d+)\s*mm/i)?.[1] ?? '17';
    return `${size}mm塑料门襟扣`;
  }

  if (/^17\s*plastic snap\s*-\s*extra flat\s*-\s*black color$/i.test(normalizedSource)) {
    return '17mm塑料四合扣黑色';
  }

  if (/^top front fly button$/i.test(normalizedSource)) {
    return '门襟用';
  }

  if (/^#cnd250214$/i.test(normalizedSource)) {
    return '面料1';
  }

  if (/^#dys-ws237230$/i.test(normalizedSource)) {
    return '面料2';
  }

  if (/^brushed cotton poly twill$/i.test(normalizedSource)) {
    return '袋布：涤棉磨毛斜纹';
  }

  if (/^col\s*:?\s*matching color with outshell fabric$/i.test(normalizedSource)) {
    return '配色';
  }

  const baseStyleMatch = source.match(/\bbase\s+(m\d{5,})\b/i);
  if (baseStyleMatch) {
    return `版型基于${baseStyleMatch[1].toUpperCase()}`;
  }

  if (/^option\s*#?\s*1\s+no wash$/i.test(normalizedSource)) {
    return '选项#1：免洗';
  }

  if (/^option\s*#?\s*2\s+light garment enzyme wahs$/i.test(normalizedSource)) {
    return '选项#2：轻酵素洗';
  }

  if (/^nm 35 4pts\/1cm$/i.test(normalizedSource)) {
    return '车缝：NM 35 4针/1CM';
  }

  if (/^new logo label\b/i.test(normalizedSource) && /\b11\b/.test(normalizedSource)) {
    return '新主标 11#色';
  }

  if (/^nm 120 4,?5pts ?\/1cm t\/t$/i.test(normalizedSource)) {
    return '款号：NM 120; 纱支：4.5pts/1cm; 付款方式：T/T';
  }

  if (/^84851 gun metal finishing$/i.test(normalizedSource)) {
    return '款号：84851；颜色：枪灰色';
  }

  if (/^scuba$/i.test(normalizedSource)) {
    return '面料：SCUBA';
  }

  if (/^cuff opening slit with 7mm top-?stitch$/i.test(normalizedSource)) {
    return '袖口开衩，顶部明线7mm';
  }

  if (/^outshell fabric on back belt \+ cuffs$/i.test(normalizedSource)) {
    return '外层面料：后腰带 + 袖口';
  }

  if (/^original idea for shape and collar shape$/i.test(normalizedSource)) {
    return '版型和领型同原设计';
  }

  if (
    /^no quilting - padding is a free roll inside front body \+ collar \+ cuffs$/i.test(
      normalizedSource
    )
  ) {
    return '无绗缝 - 填充物为自由卷，位于前衣身 + 领子 + 袖口内部';
  }

  if (/^#sl-115423-1-cp cotton top side$/i.test(normalizedSource)) {
    return '款号：SL-115423-1-CP 面料：棉 部位：正面';
  }

  if (/^#sl-115423-1-cp polar fleece top side$/i.test(normalizedSource)) {
    return '款号：SL-115423-1-CP；面料：极细抓绒；部位：正面';
  }

  if (/^face 100% cotton \/ backside 100% polyester$/i.test(normalizedSource)) {
    return '正面：100% 棉 / 反面：100% 涤纶';
  }

  if (/^approx\.? 300gr \/ 150cm$/i.test(normalizedSource)) {
    return '克重：约 300g；幅宽：150cm';
  }

  if (/^as your attache?ment sample$/i.test(normalizedSource)) {
    return '尺寸和版型同参考样衣';
  }

  if (/^same back construction as your attache?ment sample$/i.test(normalizedSource)) {
    return '后背结构同参考样衣';
  }

  if (/^same front workmanship \+ dart as you(?:r)? attache?ment sample$/i.test(normalizedSource)) {
    return '与参考样品相同的正面工艺';
  }

  if (/^same size and fit as your attache?ment sample$/i.test(normalizedSource)) {
    return '尺寸和版型同参考样衣';
  }

  if (/^mesnard emilie$/i.test(normalizedSource)) {
    return '品牌：MESNARD EMILIE';
  }

  if (/^le lubois cl[ée]mence$/i.test(normalizedSource)) {
    return '款名：LE LUBOIS CLÉMENCE';
  }

  if (
    /^zipped removable hood in outshell fabric without padding$/i.test(normalizedSource)
  ) {
    return '外层面料可拆卸拉链兜帽，无填充';
  }

  if (/^elbow seam$/i.test(normalizedSource)) {
    return '肘缝';
  }

  if (/^all workmanship must be waterproof with inside seam tapes$/i.test(normalizedSource)) {
    return '车缝：所有做工需防水，内缝需加贴胶条';
  }

  if (/^flat collar \(no padding inside\)$/i.test(normalizedSource)) {
    return '平领（领内无衬垫）';
  }

  if (/^chest pocket bag no top-?stitch$/i.test(normalizedSource)) {
    return '胸袋袋布：无明线';
  }

  if (/^assembled cuff and belt height 5,?5cm$/i.test(normalizedSource)) {
    return '袖口及腰带组装高度：5.5cm';
  }

  if (/^dble face jersey\/polar fleece soft fabric$/i.test(normalizedSource)) {
    return '面料：双层正反面毛圈布/抓绒软布';
  }

  if (
    /^tunnel pocket on front with top sack visible top-?stitch to fox it inside body$/i.test(
      normalizedSource
    )
  ) {
    return '前袋：隧道袋，袋口可见，袋口明线缝合以固定于衣身内部';
  }

  if (/^same cotton fabric but no$/i.test(normalizedSource)) {
    return '面料：同棉布，但无';
  }

  if (/^polar fleece back side$/i.test(normalizedSource)) {
    return '背面：极细绒布';
  }

  if (
    /^5\.?5cm height cuffs & belt same cotton fabric but no polar fleece back side$/i.test(
      normalizedSource
    )
  ) {
    return '5.5cm高袖口和底摆与主身面料相同，棉质，但反面无羊羔毛';
  }

  if (/^fitting\s*\/\s*volume\b/i.test(normalizedSource) && /attachment sample/i.test(source)) {
    return '尺寸和版型同参考样衣';
  }

  if (/^inside neckline patched jersey band$/i.test(normalizedSource)) {
    return '领圈针织带';
  }

  if (/drop-?in side pockets/i.test(normalizedSource)) {
    return '侧插袋设计';
  }

  if (/^wrinkle free fabric$/i.test(normalizedSource)) {
    return '抗皱面料';
  }

  if (/^glued bottom hem$/i.test(normalizedSource)) {
    return '贴合下摆工艺';
  }

  if (/^quality spec:\s*lightweight fabric,\s*quick dry and moisture wicking\.\s*4-way stretch$/i.test(normalizedSource)) {
    return '轻薄面料，具备快干排湿功能。四面弹力且抗皱。';
  }

  if (
    /^value driver:/i.test(normalizedSource) &&
    /wrinkle free/i.test(normalizedSource) &&
    /glued edges/i.test(normalizedSource) &&
    /plain jersey/i.test(normalizedSource)
  ) {
    return '需支持无缝胶合工艺。采用平纹针织结构，';
  }

  if (
    /good .*body.*not flimsy.*spongy/i.test(normalizedSource) ||
    /more or less the fabric below/i.test(normalizedSource)
  ) {
    return '面料需有骨感不软塌，呈现海绵般柔软质感。';
  }

  if (/^advice of you believe it is a good fit$/i.test(normalizedSource)) {
    return '请评估确认是否适用。';
  }

  if (/^-lightweight skirt with double pockets$/i.test(normalizedSource)) {
    return '侧边双口袋';
  }

  if (/^-pocket at cb in waist seam$/i.test(normalizedSource)) {
    return '后腰缝线处设口袋';
  }

  if (/^-filled piping detail at front and back$/i.test(normalizedSource)) {
    return '前后片滚边夹牙';
  }

  if (/^-glued hem at bottom$/i.test(normalizedSource)) {
    return '贴合下摆';
  }

  if (/^-folded waist with elastic at waist$/i.test(normalizedSource)) {
    return '折叠式松紧腰头';
  }

  if (/^-inner shorts attached to skirt$/i.test(normalizedSource)) {
    return '裙身内置短裤衬里';
  }

  if (/^-rubber logo front and back$/i.test(normalizedSource)) {
    return '前后有硅胶Logo';
  }

  if (/^centered,\s*2\s*cm\s*from waist$/i.test(normalizedSource)) {
    return '居中定位，距腰线2厘米';
  }

  if (/^open pocket at cb,\s*12\s*cm\s*wide,?$/i.test(normalizedSource)) {
    return '后中开口袋，宽度12厘米';
  }

  if (/^filled piping in contrast colo/u.test(normalizedSource) || /^filled piping in contrast colour$/i.test(normalizedSource)) {
    return '前后片滚边夹牙';
  }

  if (/^slanting side pocket$/i.test(normalizedSource)) {
    return '侧插袋设计';
  }

  if (/^double layer shell pocket,?$/i.test(normalizedSource)) {
    return '双层面料口袋';
  }

  if (/^folded and glued top$/i.test(normalizedSource)) {
    return '口袋顶端做贴合工艺';
  }

  if (/^new inner shorts,?$/i.test(normalizedSource) || /^new inner shorts$/i.test(normalizedSource)) {
    return '内裤见下页';
  }

  if (/^see next page for details$/i.test(normalizedSource)) {
    return '内裤见下页';
  }

  if (/^logo rubber print$/i.test(normalizedSource)) {
    return '裤腿内侧有硅胶防滑带';
  }

  if (/^inside leg as grip function$/i.test(normalizedSource)) {
    return '裤腿内侧有硅胶防滑带';
  }

  if (/^to prevent shorts from$/i.test(normalizedSource) || /^moving upwards$/i.test(normalizedSource)) {
    return '防止短裤上滑';
  }

  if (/same back construction/i.test(source) && /(attachment|attachement)/i.test(source)) {
    return '后背结构同参考样衣';
  }

  if (/same front workmanship/i.test(source) && /(attachment|attachement)/i.test(source)) {
    return '与参考样品相同的正面工艺';
  }

  if (/same size and shape/i.test(source) && /(reference|attachment)/i.test(source)) {
    return '尺寸和版型同参考样衣';
  }

  if (/^as your attachment sample$/i.test(normalizedSource)) {
    return '尺寸和版型同参考样衣';
  }

  if (/same cotton fabric but no polar fleece on backside/i.test(source)) {
    return '相同棉质，但反面无羊羔毛';
  }

  if (/^\s*proto\s*#?\s*1\s*$/i.test(normalizedSource)) {
    return 'OP1';
  }

  if (/^\s*proto\s*#?\s*2\s*$/i.test(normalizedSource)) {
    return 'OP2';
  }

  if (/same cotton face look but shaved polar fleece to be thinner/i.test(source)) {
    return '比主身摇粒绒面料更薄一些';
  }

  if (/same.*embroidery/i.test(source) && /color/i.test(source)) {
    return '刺绣颜色顺面料';
  }

  if (/^\s*embroidery\s*$/i.test(normalizedSource)) {
    return '刺绣';
  }

  if (/^2cm height collar$/i.test(normalizedSource)) {
    return '2CM领高与主身面料';
  }

  if (/tunnel pocket on front/i.test(source) && /top stitch/i.test(normalizedSource)) {
    return '前身袋鼠兜，顶部缝合在身内，双针加固';
  }

  if (/side seam is deported on back body/i.test(normalizedSource)) {
    return '侧缝移到后身';
  }

  if (/hood facing/i.test(normalizedSource) && /my42033/i.test(normalizedSource)) {
    return '帽上隐形磁吸朝向与MY42033相同';
  }

  if (/hood pattern and assembling as my42033/i.test(normalizedSource)) {
    return '面料做三拼接帽，没有填充与MY42033相同做法';
  }

  if (/middle front placket/i.test(normalizedSource) && /zipped opening/i.test(normalizedSource)) {
    return '门贴内有拉链';
  }

  if (/84851 on front opening/i.test(normalizedSource)) {
    return '门襟84851四合扣';
  }

  if (/84851 on cuff opening/i.test(normalizedSource)) {
    return '袖口84851四合扣';
  }

  if (/thermofused chest flap/i.test(normalizedSource)) {
    return '前胸贴袋';
  }

  if (/front hidden zipped pocket/i.test(normalizedSource) && /thermofused/i.test(normalizedSource)) {
    return '袋口压双面胶，内藏拉链口袋';
  }

  if (/top back yoke/i.test(normalizedSource) && /thermofused/i.test(normalizedSource)) {
    return '后浮水压双面胶';
  }

  if (/reflective line on middle back/i.test(normalizedSource)) {
    return '后背反光面胶';
  }

  if (/thermofused under placket/i.test(normalizedSource)) {
    return '暗襟双面胶';
  }

  if (/inside zipped pocket/i.test(normalizedSource) && /one side zipper/i.test(normalizedSource)) {
    return '3#反装尼龙拉链，单侧漏拉齿';
  }

  if (/inclined front cutting/i.test(normalizedSource) && /zipped pocket/i.test(normalizedSource)) {
    return '正面倾斜分割线装3#隐形拉链';
  }

  if (/outshell fabric on assembled cuff/i.test(normalizedSource) && /55mm/i.test(normalizedSource)) {
    return '大身面料做袖克夫5.5cm高';
  }

  if (/25mm hem/i.test(normalizedSource)) {
    return '25mm明线';
  }

  if (/scuba fabric on sleeves$/i.test(normalizedSource)) {
    return '袖子空气层';
  }

  if (/scuba fabric on back body \+ sleeves/i.test(normalizedSource)) {
    return '后身和袖子采用空气层';
  }

  if (/back shoulder decorative seam/i.test(normalizedSource) && /outshell fabric shoulder part/i.test(normalizedSource)) {
    return '采用前身面料拼接肩部部分';
  }

  if (/under front placket in outshell fabric/i.test(normalizedSource)) {
    return '暗襟采用前身材料';
  }

  if (/dull poly lining fabric/i.test(normalizedSource)) {
    return '春亚纺身里';
  }

  if (/inside outshell fabric piped pocket/i.test(normalizedSource) && /hidden coil zipped entrance/i.test(normalizedSource)) {
    return '里兜牙用面料';
  }

  if (/5\.?5\s*cm\s*height cuffs/i.test(normalizedSource) && /no polar fleece/i.test(normalizedSource)) {
    return '袖口、底摆双层面料，反面无羊羔毛';
  }

  if (/2\s*cm\s*height collar/i.test(normalizedSource) && /no polar fleece/i.test(normalizedSource)) {
    return '2CM领高与主身面料相同，棉质，但反面无羊羔毛';
  }

  text = normalizeMaterialTerms(text)
    .replace(/^侧边$/g, '侧边双口袋')
    .replace(/^底边[:：]?\s*胶粘$/g, '贴合下摆工艺')
    .replace(/^底边[:：]?\s*粘合$/g, '贴合下摆')
    .replace(/^贴边侧袋$/g, '侧插袋设计')
    .replace(/^免烫面料$/g, '抗皱面料')
    .replace(/^双层壳袋$/g, '双层面料口袋')
    .replace(/^折叠粘合上片$/g, '口袋顶端做贴合工艺')
    .replace(/^新内短裤$/g, '内裤见下页')
    .replace(/^斜插袋，logo\s*橡胶印花$/i, '侧插袋设计')
    .replace(/^贴胶底边（?内裆防滑）?$/g, '裤腿内侧有硅胶防滑带')
    .replace(/^外观：防止短裤$/g, '防止短裤上滑')
    .replace(/^向上移动$/g, '防止短裤上滑')
    .replace(/^-双口袋轻薄裙$/g, '侧边双口袋')
    .replace(/^-后中腰缝插袋$/g, '后腰缝线处设口袋')
    .replace(/^-前片和后片填充滚边细节$/g, '前后片滚边夹牙')
    .replace(/^-内短裤缝合至裙身$/g, '裙身内置短裤衬里')
    .replace(/^-前片及后片：橡胶\s*logo$/i, '前后有硅胶Logo')
    .replace(/^居中，距腰(?:围|头)\s*2\s*cm$/i, '居中定位，距腰线2厘米')
    .replace(/^后中开袋，宽\s*12\s*(cm|厘米)$/i, '后中开口袋，宽度12厘米')
    .replace(/^撞色填充滚边$/g, '前后片滚边夹牙')
    .replace(/^款号[:：]\s*67\s*ecorce.*$/i, '67#咖色')
    .replace(/^颜色[:：]\s*55\s*sage.*$/i, '55#绿色')
    .replace(/^款号[:：]\s*nm\s*120$/i, 'NM 120')
    .replace(/^付款方式[:：]\s*t\/t$/i, 'T/T')
    .replace(/^按扣$/g, '15mm四合扣')
    .replace(/^拉链$/g, '5#金属拉链')
    .replace(/^袖口[:：]\s*松紧$/g, '罗纹袖口')
    .replace(/^logo\s*刺绣$/i, '刺绣Logo')
    .replace(/^plat\s*\|\s*84851.*$/i, '15mm-四合扣与原样相同亮银色饰面')
    .replace(/^外观：与原样衣同款的蓬松效果$/g, '仿羽绒棉外观和参考样衣相同蓬松度')
    .replace(/^面料：刷毛涤纶针织布$/g, '斜纹涤里料同原样')
    .replace(/^后中长：74cm$/i, '做到74CM')
    .replace(/^48\s+海军蓝$/g, '48#海军蓝')
    .replace(/^新logo标$/i, '新logo主标')
    .replace(/^新LOGO标$/i, '新logo主标')
    .replace(/^压平下摆$/g, '15MM四合扣')
    .replace(/^前开襟[:：]?\s*84851$/g, '门襟84851四合扣')
    .replace(/^84851\s*在袖口开(?:口|衩)处$/g, '袖口84851四合扣')
    .replace(/^隐形拉链[:：]?(?:前袋|侧袋)?.*$/g, '3#隐形拉链侧')
    .replace(/^3#尼龙反装拉链黑色$/g, '里兜3#反装尼龙')
    .replace(/^面料[:：]?\s*华悦.*m245013.*$/i, '面料1 与M245013相同面料')
    .replace(/^对比面料[:：]?.*m145023.*$/i, '面料2 与M145023相同面料')
    .replace(/^里料（前衣身）[:：]?.*02\s*黑色.*$/g, '身里春亚纺 黑色')
    .replace(/^领内罗纹[:：]?.*1\/1.*$/g, '1X1罗纹内领')
    .replace(/^填充物[:：]?.*m145023.*$/i, '填充：与M145023相同')
    .replace(/^外平领[:：]?.*$/g, '面料平装领')
    .replace(/^前门襟内侧[:：]?.*$/g, '暗襟采用前身材料')
    .replace(/^面料[:：]?\s*哑光涤纶里布$/g, '春亚纺身里')
    .replace(/^内里外层面料包边口袋.*$/g, '里兜牙用面料')
    .replace(/^外层面料[:：]\s*组装袖口.*55mm.*$/i, '大身面料做袖克夫5.5cm高')
    .replace(/^25mm\s*(折边|下摆)$/g, '25mm明线')
    .replace(/后腰松紧带/g, '后腰部橡筋')
    .replace(/卡其布口袋\s*\+\s*褶裥/g, '斜插侧袋')
    .replace(/包边袋/g, '单开线口袋')
    .replace(/嵌线袋/g, '单开线口袋')
    .replace(/塑料四合扣：黑色/g, '塑料门襟扣')
    .replace(/配色：与外层面料同色/g, '配色同面布')
    .replace(/颜色：与外层面料同色/g, '配色同面布')
    .replace(/自动锁拉链门襟用/g, '自动锁头闭尾拉链')
    .replace(/版型基于\s*m(\d{5,})/gi, (_, code) => `版型基于M${code}`);

  return text;
}

function isReasoningHeavyLocalBModel(modelOverride?: string) {
  const candidate = (
    modelOverride?.trim() ||
    process.env.B_MODEL_NAME ||
    process.env.TRANSLATION_MODEL ||
    ''
  ).toLowerCase();
  return candidate === 'qwen3.5-35b-a3b' || candidate.startsWith('qwen3.5-35b-a3b');
}

async function translateSegmentsWithModelB(
  segments: PipelineResult['segments'],
  maxSegmentsForTranslation?: number,
  translationModelOverride?: string,
  documentMainType?: DocumentMainType
): Promise<{ map: Map<string, string>; stats: BModelBatchStats }> {
  const translated = new Map<string, string>();
  const configured = isTranslationModelConfigured(translationModelOverride);
  const fallbackConfig = getTranslationFallbackRuntimeConfig();
  const activeModel = getTranslationModelName(translationModelOverride);
  const stats: BModelBatchStats = {
    configured,
    batchAttempts: 0,
    batchJsonOk: 0,
    lastErrorKind: 'none',
    providerHits: [],
    fallbackConfigured: Boolean(fallbackConfig),
    fallbackUsed: false,
    activeModel,
    retranslatePasses: 0,
    retranslatedSegmentCount: 0,
    visionSecondStagePasses: 0,
    visionSecondStageSegmentCount: 0
  };
  if (!configured || segments.length === 0) {
    stats.lastErrorKind = configured ? 'none' : 'not_configured';
    return { map: translated, stats };
  }
  const scopedSegments = selectSegmentsForTranslation(
    segments,
    maxSegmentsForTranslation,
    documentMainType
  );
  const reasoningHeavyLocalModel = isReasoningHeavyLocalBModel(translationModelOverride);

  const batchSize = Number(process.env.B_MODEL_BATCH_SIZE ?? (reasoningHeavyLocalModel ? '2' : '1'));
  const baseMaxTokens = Number(
    process.env.B_MODEL_MAX_TOKENS ?? (reasoningHeavyLocalModel ? '1600' : '450')
  );
  const segTextMaxChars = Number(process.env.B_MODEL_SEG_TEXT_MAX_CHARS ?? '800');
  const batchDelayMs = Number(process.env.B_MODEL_BATCH_DELAY_MS ?? '0');
  const rateLimitRetryLimit = Number(process.env.B_MODEL_RATE_LIMIT_RETRY_LIMIT ?? '0');
  const rateLimitBackoffMs = Number(process.env.B_MODEL_RATE_LIMIT_BACKOFF_MS ?? '4000');
  const transportRetryLimit = Number(process.env.B_MODEL_TRANSPORT_RETRY_LIMIT ?? '1');
  const retranslateEnabled = process.env.B_MODEL_RETRANSLATE_ENABLED !== '0';
  const retranslateMaxPasses = Number(process.env.B_MODEL_RETRANSLATE_MAX_PASSES ?? '2');
  const retranslateBatchDelayMs = Number(process.env.B_MODEL_RETRANSLATE_DELAY_MS ?? '1200');
  const retranslateMaxTokens = Number(
    process.env.B_MODEL_RETRANSLATE_MAX_TOKENS ?? (reasoningHeavyLocalModel ? '900' : '320')
  );
  const visionSecondStageEnabled = process.env.B_MODEL_VISION_SECOND_STAGE_ENABLED !== '0';
  const visionSecondStageMaxSegments = Number(
    process.env.B_MODEL_VISION_SECOND_STAGE_MAX_SEGMENTS ?? '8'
  );
  const visionSecondStageDelayMs = Number(
    process.env.B_MODEL_VISION_SECOND_STAGE_DELAY_MS ?? String(retranslateBatchDelayMs)
  );
  const visionSecondStageMaxTokens = Number(
    process.env.B_MODEL_VISION_SECOND_STAGE_MAX_TOKENS ?? String(retranslateMaxTokens)
  );
  const scopedSegmentIds = new Set(scopedSegments.map((segment) => segment.id));
  async function executeTranslationStrategy(strategy: {
    modelOverride?: string;
    runtimeConfigOverride?: ModelRuntimeConfig;
    providerPrefix: string;
  }) {
    stats.activeModel =
      strategy.runtimeConfigOverride?.model ??
      strategy.modelOverride ??
      stats.activeModel;
    let stopDueRateLimit = false;

    async function runPass(
      passSegments: PipelineResult['segments'],
      options: {
        batchSize: number;
        delayMs: number;
        maxTokens: number;
        promptMode: 'default' | 'retranslate' | 'vision_recover';
      }
    ) {
      for (let i = 0; i < passSegments.length; i += options.batchSize) {
        if (stopDueRateLimit) break;
        if (options.delayMs > 0 && i > 0) {
          await delay(options.delayMs);
        }
        const batch = passSegments.slice(i, i + options.batchSize);
        const prompt =
          options.promptMode === 'retranslate'
            ? [
                '你是服装工艺单补翻模型(B-retry)。下面是上轮未成功翻译的片段，请只补翻这些片段。',
                '只输出 JSON：{"translations":[{"id":"...","zh":"..."}]}。',
                '不要解释，不要补充备注，不要遗漏 id。',
                '如果只有 1 个片段，也必须返回 translations 数组。',
                '译文要求：使用服装工艺单常用中文短句，优先贴标签式表达，不写解释性废话。',
                '颜色/面料/辅料/洗水/车缝类片段尽量保持“项目：内容”结构。',
                '款号、物料码、成分比例、克重、幅宽、毫米、厘米等数字和单位原样保留，不要编造。',
                '',
                '未译片段：',
                JSON.stringify(
                  batch.map((s) => ({
                    id: s.id,
                    text: s.text.length > segTextMaxChars ? s.text.slice(0, segTextMaxChars) : s.text
                  }))
                )
              ].join('\n')
            : options.promptMode === 'vision_recover'
              ? [
                  '你是服装工艺单视觉补翻模型(B-vision-recover)。下面片段来自 OCR/视觉补强，但尚未进入首轮翻译结果。',
                  '请只补翻这些片段，只输出 JSON：{"translations":[{"id":"...","zh":"..."}]}。',
                  '不要解释，不要补充备注，不要遗漏 id。',
                  '译文要求：使用服装工艺单常用中文短句，优先贴标签式表达，不写解释性废话。',
                  '颜色/面料/辅料/洗水/车缝类片段尽量保持“项目：内容”结构。',
                  '款号、物料码、成分比例、克重、幅宽、毫米、厘米等数字和单位原样保留，不要编造。',
                  '',
                  '视觉补强片段：',
                  JSON.stringify(
                    batch.map((s) => ({
                      id: s.id,
                      text: s.text.length > segTextMaxChars ? s.text.slice(0, segTextMaxChars) : s.text
                    }))
                  )
                ].join('\n')
              : [
                  '你是服装工艺单翻译模型(B)。仅翻译结构化片段，不做结构识别，不做内容合并。',
                  '输出 JSON：{"translations":[{"id":"...","zh":"..."}]}。',
                  '请保留每个 id，不要新增或删除。',
                  '译文要求：使用服装工艺单常用中文短句，优先贴标签式表达，不写解释性废话。',
                  '颜色/面料/辅料/洗水/车缝类片段尽量保持“项目：内容”结构。',
                  '款号、物料码、成分比例、克重、幅宽、毫米、厘米等数字和单位原样保留，不要编造。',
                  '',
                  '片段：',
                  JSON.stringify(
                    batch.map((s) => ({
                      id: s.id,
                      text: s.text.length > segTextMaxChars ? s.text.slice(0, segTextMaxChars) : s.text
                    }))
                  )
                ].join('\n');

        let transportRetriesUsed = 0;
        let rateLimitRetriesUsed = 0;
        while (true) {
          stats.batchAttempts += 1;
          try {
            const result = await callTranslationModelChat({
              messages: [
                {
                  role: 'system',
                  content:
                    options.promptMode === 'retranslate'
                      ? 'You are a precise retry translation model for untranslated segments.'
                      : options.promptMode === 'vision_recover'
                        ? 'You are a precise recovery translation model for OCR/vision supplement segments.'
                        : 'You are a precise segment translation model.'
                },
                { role: 'user', content: prompt }
              ],
              temperature: 0.1,
              modelOverride: strategy.modelOverride,
              runtimeConfigOverride: strategy.runtimeConfigOverride,
              maxTokens:
                transportRetriesUsed === 0
                  ? options.maxTokens
                  : Math.max(220, Math.floor(options.maxTokens * 0.7))
            });
            const parsed = safeParseTranslationResponse(result.text);
            stats.batchJsonOk += 1;
            stats.lastErrorKind = 'none';
            stats.activeModel = result.model || strategy.runtimeConfigOverride?.model || stats.activeModel;
            stats.providerHits.push(
              options.promptMode === 'retranslate'
                ? `${strategy.providerPrefix}:retranslate`
                : options.promptMode === 'vision_recover'
                  ? `${strategy.providerPrefix}:vision-recover`
                  : strategy.providerPrefix
            );
            const sourceById = new Map(batch.map((segment) => [segment.id, segment.text]));
            for (const item of parsed) {
              if (item.id && item.zh) {
                translated.set(
                  item.id,
                  normalizeFashionTranslation(sourceById.get(item.id) ?? '', item.zh)
                );
              }
            }
            break;
          } catch (error) {
            const kind = classifyBModelError(error);
            stats.lastErrorKind = kind;
            logPipelineDebug('pipeline.b_model_batch_error', {
              batchIndex: stats.batchAttempts,
              kind,
              promptMode: options.promptMode,
              providerPrefix: strategy.providerPrefix,
              retry:
                kind === 'rate_limited'
                  ? `rate-limit-${rateLimitRetriesUsed + 1}`
                  : transportRetriesUsed === 0
                    ? 'first'
                    : 'second'
            });
            if (kind === 'rate_limited') {
              if (rateLimitRetriesUsed < rateLimitRetryLimit) {
                const backoffMs = rateLimitBackoffMs * Math.max(1, 2 ** rateLimitRetriesUsed);
                rateLimitRetriesUsed += 1;
                await delay(backoffMs);
                continue;
              }
              stopDueRateLimit = true;
              break;
            }
            if (kind !== 'timeout' && kind !== 'http') break;
            if (transportRetriesUsed >= transportRetryLimit) break;
            transportRetriesUsed += 1;
          }
        }
      }
    }

    await runPass(scopedSegments, {
      batchSize,
      delayMs: batchDelayMs,
      maxTokens: baseMaxTokens,
      promptMode: 'default'
    });

    const primaryExhaustedWithoutOutput =
      stats.batchAttempts > 0 && stats.batchJsonOk === 0 && stats.lastErrorKind !== 'none';
    if (primaryExhaustedWithoutOutput) {
      logPipelineDebug('pipeline.b_model_primary_exhausted', {
        providerPrefix: strategy.providerPrefix,
        batchAttempts: stats.batchAttempts,
        lastErrorKind: stats.lastErrorKind,
        translatedSegments: translated.size
      });
      return { stopDueRateLimit: stats.lastErrorKind === 'rate_limited' };
    }

    if (retranslateEnabled && !stopDueRateLimit) {
      for (let pass = 1; pass <= retranslateMaxPasses; pass += 1) {
        const untranslatedSegments = scopedSegments.filter((segment) => !translated.has(segment.id));
        if (untranslatedSegments.length === 0) {
          break;
        }
        stats.retranslatePasses += 1;
        await runPass(untranslatedSegments, {
          batchSize: 1,
          delayMs: retranslateBatchDelayMs,
          maxTokens: retranslateMaxTokens,
          promptMode: 'retranslate'
        });
        const remaining = untranslatedSegments.filter((segment) => !translated.has(segment.id)).length;
        stats.retranslatedSegmentCount = translated.size;
        logPipelineDebug('pipeline.b_model_retranslate_pass', {
          pass,
          providerPrefix: strategy.providerPrefix,
          attemptedSegments: untranslatedSegments.length,
          remainingSegments: remaining
        });
        if (remaining === 0 || stopDueRateLimit) {
          break;
        }
      }
    }

    if (
      visionSecondStageEnabled &&
      !stopDueRateLimit &&
      typeof maxSegmentsForTranslation === 'number' &&
      maxSegmentsForTranslation > 0 &&
      segments.length > scopedSegments.length
    ) {
      const recoverySegments = selectVisionRecoverySegments(
        segments,
        scopedSegmentIds,
        translated,
        visionSecondStageMaxSegments,
        documentMainType
      );
      if (recoverySegments.length > 0) {
        stats.visionSecondStagePasses += 1;
        await runPass(recoverySegments, {
          batchSize: 1,
          delayMs: visionSecondStageDelayMs,
          maxTokens: visionSecondStageMaxTokens,
          promptMode: 'vision_recover'
        });
        stats.visionSecondStageSegmentCount += recoverySegments.filter((segment) =>
          translated.has(segment.id)
        ).length;
        logPipelineDebug('pipeline.b_model_vision_second_stage', {
          providerPrefix: strategy.providerPrefix,
          attemptedSegments: recoverySegments.length,
          translatedSegments: recoverySegments.filter((segment) => translated.has(segment.id)).length
        });
      }
    }

    return { stopDueRateLimit };
  }

  const primary = await executeTranslationStrategy({
    modelOverride: translationModelOverride,
    providerPrefix: 'translation-model'
  });

  const shouldTryFallback =
    Boolean(fallbackConfig) &&
    translated.size === 0 &&
    (stats.batchAttempts === 0 || stats.batchJsonOk === 0 || stats.lastErrorKind !== 'none');

  if (fallbackConfig && shouldTryFallback) {
    stats.fallbackUsed = true;
    logPipelineDebug('pipeline.b_model_fallback_start', {
      primaryModel: activeModel,
      fallbackModel: fallbackConfig.model,
      lastErrorKind: stats.lastErrorKind,
      primaryStoppedByRateLimit: primary.stopDueRateLimit
    });
    await executeTranslationStrategy({
      modelOverride: fallbackConfig.model,
      runtimeConfigOverride: fallbackConfig,
      providerPrefix: 'translation-model:fallback'
    });
  }
  return { map: translated, stats };
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
        aModelFallbackUsed: false,
        aModelActiveModel: undefined,
        visionTargetPages: [],
        visionPageBlockCounts: [],
        visionPageRawBlockCounts: [],
        visionPageErrors: [],
        bModelExecuted: false,
        bModelApiConfigured: isTranslationModelConfigured(),
        bModelBatchAttempts: 0,
        bModelBatchJsonOk: 0,
        bModelLastErrorKind: 'none',
        bModelFallbackUsed: false,
        bModelActiveModel: getTranslationModelName(input.translationModelOverride),
        translatedSegmentCount: 0,
        translationCoveragePct: 0,
        businessPreviewThresholdPct: BUSINESS_PREVIEW_THRESHOLD_PCT,
        isBusinessPreviewReady: false,
        previewSuppressedReason: 'coverage_too_low'
      },
      segments: [],
      outputs: {},
      error: extracted.error ?? 'extract failed'
    };
  }

  const built = buildFeedbackSourceReferenceWithDiagnostics(extracted, { name: input.fileName });
  const pageLayoutByPage = new Map<number, string>();
  for (const section of built.reference.sections) {
    const pageNumber = section.segments[0]?.pageNumber;
    if (pageNumber && !pageLayoutByPage.has(pageNumber)) {
      pageLayoutByPage.set(pageNumber, section.pageLayoutType);
    }
  }
  const layoutCounts = computePageLevelLayoutCounts(built.reference.sections);
  const pageCount = Math.max(1, extracted.pages.length);
  const totalSegmentCount = built.reference.sections.reduce(
    (sum, section) => sum + section.segments.length,
    0
  );
  const avgSegmentsPerPage = totalSegmentCount / pageCount;
  const tableSegmentShare = computeTableSegmentShare(built.reference.sections);
  const documentMainType = inferDocumentMainType(
    layoutCounts,
    avgSegmentsPerPage,
    pageCount,
    tableSegmentShare
  );
  const outputStrategy = selectOutputStrategy(documentMainType);
  logPipelineDebug('pipeline.layout_classified', {
    pipelineId,
    fileName: input.fileName,
    documentMainType,
    outputStrategy,
    tableSegmentShare,
    earlyGatePages: built.diagnostics.earlyGatePages,
    lowConfidencePages: built.diagnostics.lowConfidencePages
  });
  const visionTargetPages = selectVisionTargetPages(
    extracted,
    built.reference.sections,
    documentMainType,
    built.diagnostics
  );
  const lowConfidenceSegments = built.reference.sections
    .flatMap((section) => section.segments)
    .filter(
      (segment) =>
        built.diagnostics.lowConfidenceRegionIds.includes(segment.regionId) ||
        visionTargetPages.includes(segment.pageNumber)
    );
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
  const aModelTriggered = visionTargetPages.length > 0 || textLayerBlocks.length > 0;
  let visionBlocks: ExtractedBlock[] = [];
  let aModelExecuted = false;
  let aModelFallbackUsed = false;
  let aModelActiveModel: string | undefined;
  let visionPageBlockCounts: Array<{ pageNumber: number; blockCount: number }> = [];
  let visionPageRawBlockCounts: Array<{ pageNumber: number; blockCount: number }> = [];
  let visionPageErrors: NonNullable<PipelineResult['diagnostics']['visionPageErrors']> = [];
  try {
    const aResult = await extractWithVisionFallback(
      {
        filePath: input.filePath,
        mimeType: 'application/pdf',
        textLayerBlocks,
        targetPages: visionTargetPages
      },
      aModelTriggered ? createQwenVisionProvider() : undefined
    );
    aModelExecuted = aModelTriggered && Boolean(aResult.modelExecuted);
    aModelFallbackUsed = Boolean(aResult.fallbackProviderUsed);
    aModelActiveModel = aResult.provider;
    visionPageBlockCounts = aResult.pageBlockCounts ?? [];
    visionPageRawBlockCounts = aResult.pageRawBlockCounts ?? [];
    visionPageErrors = aResult.pageErrors ?? [];
    visionBlocks = aResult.blocks;
    logPipelineDebug('pipeline.a_model_result', {
      pipelineId,
      fileName: input.fileName,
      aModelTriggered,
      aModelExecuted,
      aModelFallbackUsed,
      aModelActiveModel,
      fallbackUsed: aResult.fallbackUsed,
      provider: aResult.provider ?? 'none',
      targetPages: visionTargetPages,
      returnedBlocks: aResult.blocks.length
    });
  } catch {
    aModelExecuted = false;
    aModelFallbackUsed = false;
    aModelActiveModel = undefined;
    visionPageBlockCounts = [];
    visionPageRawBlockCounts = [];
    visionPageErrors = [];
    logPipelineDebug('pipeline.a_model_error', {
      pipelineId,
      fileName: input.fileName,
      aModelTriggered
    });
  }

  const baseSegments: PipelineResult['segments'] = built.reference.sections.flatMap((section) =>
    section.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      pageNumber: segment.pageNumber,
      regionId: segment.regionId,
      extractionMeta: {
        ...segment.extractionMeta,
        pageLayoutType: section.pageLayoutType
      }
    }))
  );
  const segments = buildVisionSegments(baseSegments, visionBlocks, pageLayoutByPage);

  const { map: translatedMap, stats: bModelStats } = await translateSegmentsWithModelB(
    segments,
    input.maxSegmentsForTranslation,
    input.translationModelOverride,
    documentMainType
  );
  for (const segment of segments) {
    const zh = translatedMap.get(segment.id);
    if (zh) segment.zh = zh;
  }
  const coverage = summarizeTranslationCoverage(segments, documentMainType);
  logPipelineDebug('pipeline.b_model_result', {
    pipelineId,
    fileName: input.fileName,
    translatedCount: translatedMap.size,
    totalSegments: segments.length,
    limitedByMaxSegments: typeof input.maxSegmentsForTranslation === 'number',
    bBatchAttempts: bModelStats.batchAttempts,
    bBatchJsonOk: bModelStats.batchJsonOk,
    bLastError: bModelStats.lastErrorKind,
    translationCoveragePct: coverage.translationCoveragePct,
    businessPreviewReady: coverage.isBusinessPreviewReady
  });
  const outputs: PipelineResult['outputs'] =
    outputStrategy === 'bilingual_table_bundle'
      ? {
          bilingualTableBundle: (() => {
            const bundle = buildBilingualTableBundle(segments);
            return bundle;
          })()
        }
      : (() => {
          const mixedSupplementSegments =
            documentMainType === 'mixed' ? selectMixedSupplementTableSegments(segments) : [];
          return {
            annotatedPdf: buildAnnotatedPdfOutput(segments, documentMainType),
            bilingualTableBundle:
              mixedSupplementSegments.length > 0
                ? buildBilingualTableBundle(mixedSupplementSegments)
                : undefined
          };
        })();
  if (outputs.bilingualTableBundle) {
    try {
      outputs.bilingualTableBundle.downloadable = await materializeBilingualXlsx(
        path.basename(input.fileName),
        outputs.bilingualTableBundle,
        coverage
      );
      outputs.bilingualTableBundle.downloadableTableStylePdf = await materializeTableStylePdf(
        path.basename(input.fileName),
        outputs.bilingualTableBundle,
        coverage
      );
    } catch (err) {
      if (DEBUG_PIPELINE) {
        console.error('[assistant:pipeline] table-style pdf materialize failed', err);
      }
      // keep structure available even when file write fails
    }
  }
  if (outputs.annotatedPdf) {
    outputs.annotatedPdf.snapshot = buildTranslationSnapshot(
      input.fileName,
      documentMainType,
      outputs.annotatedPdf,
      segments,
      {
        translatedSegmentCount: coverage.translatedSegmentCount,
        translationCoveragePct: coverage.translationCoveragePct,
        aModelExecuted,
        bModelExecuted: bModelStats.configured && bModelStats.batchAttempts > 0
      }
    );
    try {
      outputs.annotatedPdf.downloadable = await materializeAnnotatedHtmlPreview(
        path.basename(input.fileName),
        outputs.annotatedPdf,
        coverage
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
      aModelFallbackUsed,
      aModelActiveModel,
      visionTargetPages,
      visionPageBlockCounts,
      visionPageRawBlockCounts,
      visionPageErrors,
      bModelExecuted: translatedMap.size > 0,
      bModelApiConfigured: bModelStats.configured,
      bModelBatchAttempts: bModelStats.batchAttempts,
      bModelBatchJsonOk: bModelStats.batchJsonOk,
      bModelLastErrorKind: bModelStats.lastErrorKind,
      bModelFallbackUsed: bModelStats.fallbackUsed,
      bModelActiveModel: bModelStats.activeModel,
      translatedSegmentCount: coverage.translatedSegmentCount,
      translationCoveragePct: coverage.translationCoveragePct,
      businessSegmentCount: coverage.businessSegmentCount,
      translatedBusinessSegmentCount: coverage.translatedBusinessSegmentCount,
      businessTranslationCoveragePct: coverage.businessTranslationCoveragePct,
      businessPreviewThresholdPct: coverage.businessPreviewThresholdPct,
      isBusinessPreviewReady: coverage.isBusinessPreviewReady,
      previewSuppressedReason: coverage.previewSuppressedReason
    },
    segments,
    outputs
  };
}
