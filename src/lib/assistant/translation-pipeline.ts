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
  isTranslationModelConfigured
} from '@/lib/assistant/qwen-client';
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
    translatedSegmentCount: number;
    translationCoveragePct: number;
    businessPreviewThresholdPct: number;
    isBusinessPreviewReady: boolean;
    previewSuppressedReason?: 'coverage_too_low' | 'no_translations';
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
  businessPreviewThresholdPct: number;
  isBusinessPreviewReady: boolean;
  previewSuppressedReason?: 'coverage_too_low' | 'no_translations';
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
  segments: Array<{ zh?: string }>
): TranslationCoverageStats {
  const translatedSegmentCount = segments.filter((segment) => Boolean(segment.zh?.trim())).length;
  const totalSegments = segments.length;
  const translationCoveragePct = segments.length
    ? Math.round((translatedSegmentCount / segments.length) * 100)
    : 0;
  const isBusinessPreviewReady =
    translatedSegmentCount > 0 && translationCoveragePct >= BUSINESS_PREVIEW_THRESHOLD_PCT;

  return {
    totalSegments,
    translatedSegmentCount,
    translationCoveragePct,
    businessPreviewThresholdPct: BUSINESS_PREVIEW_THRESHOLD_PCT,
    isBusinessPreviewReady,
    previewSuppressedReason:
      translatedSegmentCount === 0
        ? 'no_translations'
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

function scoreSegmentForTranslation(text: string) {
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

  return score;
}

function selectSegmentsForTranslation(
  segments: PipelineResult['segments'],
  limit?: number
) {
  if (!limit || limit <= 0 || segments.length <= limit) {
    return segments;
  }

  const groups = new Map<number, Array<PipelineResult['segments'][number] & { __score: number }>>();
  for (const segment of segments) {
    const enriched = { ...segment, __score: scoreSegmentForTranslation(segment.text) };
    const bucket = groups.get(segment.pageNumber) ?? [];
    bucket.push(enriched);
    groups.set(segment.pageNumber, bucket);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => b.__score - a.__score);
  }

  const orderedPages = [...groups.keys()].sort((a, b) => a - b);
  const picked = new Map<string, PipelineResult['segments'][number]>();
  const seenNormalized = new Set<string>();

  // Round-robin by page first, to avoid spending all calls on the first page/header blocks.
  while (picked.size < limit) {
    let advanced = false;
    for (const page of orderedPages) {
      const bucket = groups.get(page);
      if (!bucket || bucket.length === 0) continue;
      let next = bucket.shift();
      while (next) {
        const normalized = next.text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!seenNormalized.has(normalized)) break;
        next = bucket.shift();
      }
      if (!next) continue;
      picked.set(next.id, next);
      seenNormalized.add(next.text.replace(/\s+/g, ' ').trim().toLowerCase());
      advanced = true;
      if (picked.size >= limit) break;
    }
    if (!advanced) break;
  }

  if (picked.size < limit) {
    const rest = segments
      .filter((segment) => !picked.has(segment.id))
      .map((segment) => ({ segment, score: scoreSegmentForTranslation(segment.text) }))
      .sort((a, b) => b.score - a.score);
    for (const item of rest) {
      const normalized = item.segment.text.replace(/\s+/g, ' ').trim().toLowerCase();
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
  segments: PipelineResult['segments']
): NonNullable<PipelineResult['outputs']['annotatedPdf']> {
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

type BModelBatchStats = {
  configured: boolean;
  batchAttempts: number;
  batchJsonOk: number;
  lastErrorKind: 'none' | 'not_configured' | 'timeout' | 'http' | 'rate_limited' | 'parse';
  providerHits: string[];
  retranslatePasses: number;
  retranslatedSegmentCount: number;
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
  if (/429|Too Many Requests|quota exceeded/i.test(message)) {
    return 'rate_limited';
  }
  if (/JSON|parse|Unexpected token/i.test(message)) {
    return 'parse';
  }
  return 'http';
}

async function translateSegmentsWithModelB(
  segments: PipelineResult['segments'],
  maxSegmentsForTranslation?: number
): Promise<{ map: Map<string, string>; stats: BModelBatchStats }> {
  const translated = new Map<string, string>();
  const configured = isTranslationModelConfigured();
  const stats: BModelBatchStats = {
    configured,
    batchAttempts: 0,
    batchJsonOk: 0,
    lastErrorKind: 'none',
    providerHits: [],
    retranslatePasses: 0,
    retranslatedSegmentCount: 0
  };
  if (!configured || segments.length === 0) {
    stats.lastErrorKind = configured ? 'none' : 'not_configured';
    return { map: translated, stats };
  }
  const scopedSegments = selectSegmentsForTranslation(segments, maxSegmentsForTranslation);

  const batchSize = Number(process.env.B_MODEL_BATCH_SIZE ?? '1');
  const baseMaxTokens = Number(process.env.B_MODEL_MAX_TOKENS ?? '450');
  const segTextMaxChars = Number(process.env.B_MODEL_SEG_TEXT_MAX_CHARS ?? '800');
  const batchDelayMs = Number(process.env.B_MODEL_BATCH_DELAY_MS ?? '0');
  const rateLimitRetryLimit = Number(process.env.B_MODEL_RATE_LIMIT_RETRY_LIMIT ?? '0');
  const rateLimitBackoffMs = Number(process.env.B_MODEL_RATE_LIMIT_BACKOFF_MS ?? '4000');
  const retranslateEnabled = process.env.B_MODEL_RETRANSLATE_ENABLED !== '0';
  const retranslateMaxPasses = Number(process.env.B_MODEL_RETRANSLATE_MAX_PASSES ?? '2');
  const retranslateBatchDelayMs = Number(process.env.B_MODEL_RETRANSLATE_DELAY_MS ?? '1200');
  const retranslateMaxTokens = Number(process.env.B_MODEL_RETRANSLATE_MAX_TOKENS ?? '320');
  let stopDueRateLimit = false;

  async function runPass(
    passSegments: PipelineResult['segments'],
    options: {
      batchSize: number;
      delayMs: number;
      maxTokens: number;
      promptMode: 'default' | 'retranslate';
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
              '',
              '未译片段：',
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
                    : 'You are a precise segment translation model.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            maxTokens:
              transportRetriesUsed === 0
                ? options.maxTokens
                : Math.max(220, Math.floor(options.maxTokens * 0.7))
          });
          const normalized = result.text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
          const parsed = JSON.parse(normalized) as {
            translations?: Array<{ id?: string; zh?: string }>;
          };
          stats.batchJsonOk += 1;
          stats.providerHits.push(
            options.promptMode === 'retranslate' ? 'translation-model:retranslate' : 'translation-model'
          );
          for (const item of parsed.translations ?? []) {
            if (item.id && item.zh) {
              translated.set(item.id, item.zh);
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
          if (transportRetriesUsed >= 1) break;
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
        attemptedSegments: untranslatedSegments.length,
        remainingSegments: remaining
      });
      if (remaining === 0 || stopDueRateLimit) {
        break;
      }
    }
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
        bModelExecuted: false,
        bModelApiConfigured: isTranslationModelConfigured(),
        bModelBatchAttempts: 0,
        bModelBatchJsonOk: 0,
        bModelLastErrorKind: 'none',
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

  const { map: translatedMap, stats: bModelStats } = await translateSegmentsWithModelB(
    segments,
    input.maxSegmentsForTranslation
  );
  for (const segment of segments) {
    const zh = translatedMap.get(segment.id);
    if (zh) segment.zh = zh;
  }
  const coverage = summarizeTranslationCoverage(segments);
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
      : {
          annotatedPdf: buildAnnotatedPdfOutput(segments)
        };
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
      bModelExecuted: translatedMap.size > 0,
      bModelApiConfigured: bModelStats.configured,
      bModelBatchAttempts: bModelStats.batchAttempts,
      bModelBatchJsonOk: bModelStats.batchJsonOk,
      bModelLastErrorKind: bModelStats.lastErrorKind,
      translatedSegmentCount: coverage.translatedSegmentCount,
      translationCoveragePct: coverage.translationCoveragePct,
      businessPreviewThresholdPct: coverage.businessPreviewThresholdPct,
      isBusinessPreviewReady: coverage.isBusinessPreviewReady,
      previewSuppressedReason: coverage.previewSuppressedReason
    },
    segments,
    outputs
  };
}
