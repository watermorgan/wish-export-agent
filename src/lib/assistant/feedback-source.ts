/**
 * Feedback PDF extraction V2:
 * - keep text-layer main chain (pdftotext -layout)
 * - add page layout heuristic
 * - add multi-region split
 * - apply region/layout specific segmentation strategy
 */

import type { SegmentExtractionMeta, SegmentSourceType } from '@/lib/assistant/types';
import type { ExtractedPage, ExtractedPdfResult } from '@/lib/assistant/file-extractor';

export type PageLayoutType = 'sketch' | 'table' | 'reference' | 'mixed';

export type ExtractedRegion = {
  id: string;
  pageNumber: number;
  regionType: 'label_cluster' | 'paragraph_block' | 'table_block' | 'reference_block';
  lineRange: [number, number];
  lines: string[];
};

export type FeedbackSourceSegment = {
  id: string;
  text: string;
  pageNumber: number;
  regionId: string;
  extractionMeta: SegmentExtractionMeta;
};

export type FeedbackSourceSection = {
  id: string;
  title: string;
  summary?: string;
  segments: FeedbackSourceSegment[];
  pageLayoutType: PageLayoutType;
};

export type FeedbackSourceReference = {
  file: { name: string };
  sections: FeedbackSourceSection[];
};

const SHORT_LABEL_MAX_LEN = 40;
const EARLY_GATE_MIN_CHARS_PER_LINE = 6;
const EARLY_GATE_MIN_NON_EMPTY_LINES = 4;
export const LOW_CONF_LAYOUT_THRESHOLD = 0.8;
export const LOW_CONF_MERGE_THRESHOLD = 0.8;
const LOW_CONF_MAX_SEGMENTS_PER_PAGE_TABLE = 32;
const LOW_CONF_MAX_SEGMENTS_PER_PAGE_MIXED = 28;
const LOW_CONF_SHORT_SEGMENT_LEN = 12;
const LOW_CONF_SHORT_SEGMENT_RATIO = 0.55;
const CONTINUATION_INDICATORS = /^[-–—•·]\s|^[a-z]\s|^\.\.\.|^\d+\.\s/;
const LABEL_PATTERNS =
  /^(No side seam|Colour|Color|Main fabric|Stretch fabric|Sleeve|Details|Reference|TP|BOM|Value driver)/i;

type IndexedLine = {
  index: number;
  raw: string;
  text: string;
  indent: number;
  bucket: 'left' | 'center' | 'right';
};

export type ExtractionPipelineDiagnostics = {
  earlyGatePages: number[];
  lowConfidencePages: number[];
  lowConfidenceRegionIds: string[];
  secondPassRequired: boolean;
  secondPassExecuted: boolean;
};

export type FeedbackSourceBuildResult = {
  reference: FeedbackSourceReference;
  diagnostics: ExtractionPipelineDiagnostics;
};

function toIndexedLines(page: ExtractedPage): IndexedLine[] {
  const result: IndexedLine[] = [];
  for (let i = 0; i < page.lines.length; i++) {
    const raw = page.lines[i];
    const text = raw.trim();
    if (!text) continue;
    const indent = raw.search(/\S|$/);
    const bucket: IndexedLine['bucket'] = indent < 24 ? 'left' : indent < 56 ? 'center' : 'right';
    result.push({
      index: i,
      raw,
      text,
      indent,
      bucket
    });
  }
  return result;
}

function ratio(hits: number, total: number) {
  return hits / Math.max(1, total);
}

function hasTableColumns(line: string) {
  return /\S\s{2,}\S/.test(line) && (line.match(/\s{2,}/g)?.length ?? 0) >= 2;
}

function inferPageLayoutType(page: ExtractedPage): PageLayoutType {
  const indexed = toIndexedLines(page);
  const lines = indexed.map((item) => item.text);
  const joined = lines.join(' ');
  const lineCount = lines.length;
  const avgLen = lines.reduce((s, l) => s + l.length, 0) / Math.max(1, lineCount);
  const numericRatio =
    (joined.match(/\d/g) ?? []).length / Math.max(1, joined.replace(/\s/g, '').length);
  const shortLineCount = lines.filter((l) => l.length <= SHORT_LABEL_MAX_LEN).length;
  const shortRatio = shortLineCount / Math.max(1, lineCount);
  const columnLikeCount = indexed.filter((item) => hasTableColumns(item.raw)).length;
  const columnLikeRatio = ratio(columnLikeCount, lineCount);
  const hasTableRhythm = /\d+\s+\d+\s+\d+/.test(joined) || columnLikeRatio > 0.28;
  const hasLabels = lines.some((l) => LABEL_PATTERNS.test(l));
  const hasRefWords = /\b(reference|colour|color|fabric|main|stretch)\b/i.test(joined);
  const tableHintWords = /\b(size|spec|measurement|tolerance|qty|quantity|material|trim|body)\b/i.test(
    joined
  );

  if ((hasTableRhythm && numericRatio > 0.12 && lineCount >= 8) || (tableHintWords && columnLikeRatio > 0.2)) {
    return 'table';
  }

  if (hasRefWords && shortRatio > 0.5 && lineCount >= 3) {
    return 'reference';
  }
  if (avgLen > 60 && lineCount >= 4 && hasLabels) {
    return 'sketch';
  }
  if (lineCount >= 4 && (shortRatio > 0.3 || numericRatio > 0.1)) {
    return 'mixed';
  }

  return lineCount <= 3 ? 'reference' : 'sketch';
}

function isTextLayerInsufficient(page: ExtractedPage): boolean {
  const nonEmpty = page.lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmpty.length < EARLY_GATE_MIN_NON_EMPTY_LINES) return true;
  const avgChars = nonEmpty.reduce((sum, line) => sum + line.length, 0) / Math.max(1, nonEmpty.length);
  return avgChars < EARLY_GATE_MIN_CHARS_PER_LINE;
}

function buildRegionsForPage(page: ExtractedPage, layoutType: PageLayoutType): ExtractedRegion[] {
  const indexed = toIndexedLines(page);
  if (indexed.length === 0) {
    return [];
  }

  // table-heavy pages: split by blank-line-separated row blocks
  if (layoutType === 'table') {
    const regions: ExtractedRegion[] = [];
    let blockStart = indexed[0].index;
    let current: IndexedLine[] = [indexed[0]];

    for (let i = 1; i < indexed.length; i++) {
      const prev = indexed[i - 1];
      const cur = indexed[i];
      const hasGap = cur.index - prev.index > 1;
      if (hasGap && current.length > 0) {
        regions.push({
          id: `p${page.pageNumber}_r${regions.length}`,
          pageNumber: page.pageNumber,
          regionType: 'table_block',
          lineRange: [blockStart, prev.index],
          lines: current.map((item) => item.raw)
        });
        current = [];
        blockStart = cur.index;
      }
      current.push(cur);
    }

    if (current.length > 0) {
      regions.push({
        id: `p${page.pageNumber}_r${regions.length}`,
        pageNumber: page.pageNumber,
        regionType: 'table_block',
        lineRange: [blockStart, current[current.length - 1].index],
        lines: current.map((item) => item.raw)
      });
    }
    return regions;
  }

  // sketch/mixed/reference: multi-region by bucket + gap continuity
  const regions: ExtractedRegion[] = [];
  let blockStart = indexed[0].index;
  let current: IndexedLine[] = [indexed[0]];
  let currentBucket = indexed[0].bucket;

  for (let i = 1; i < indexed.length; i++) {
    const prev = indexed[i - 1];
    const cur = indexed[i];
    const hasGap = cur.index - prev.index > 1;
    const bucketChanged = cur.bucket !== currentBucket;

    if ((bucketChanged || hasGap) && current.length > 0) {
      const shortRatio = ratio(
        current.filter((item) => item.text.length <= SHORT_LABEL_MAX_LEN).length,
        current.length
      );
      const regionType =
        layoutType === 'reference'
          ? 'reference_block'
          : shortRatio > 0.75
            ? 'label_cluster'
            : 'paragraph_block';
      regions.push({
        id: `p${page.pageNumber}_r${regions.length}`,
        pageNumber: page.pageNumber,
        regionType,
        lineRange: [blockStart, prev.index],
        lines: current.map((item) => item.raw)
      });
      current = [];
      blockStart = cur.index;
      currentBucket = cur.bucket;
    }

    current.push(cur);
  }

  if (current.length > 0) {
    const shortRatio = ratio(
      current.filter((item) => item.text.length <= SHORT_LABEL_MAX_LEN).length,
      current.length
    );
    const regionType =
      layoutType === 'reference'
        ? 'reference_block'
        : shortRatio > 0.75
          ? 'label_cluster'
          : 'paragraph_block';
    regions.push({
      id: `p${page.pageNumber}_r${regions.length}`,
      pageNumber: page.pageNumber,
      regionType,
      lineRange: [blockStart, current[current.length - 1].index],
      lines: current.map((item) => item.raw)
    });
  }

  return regions;
}

function isShortLabel(line: string): boolean {
  return line.length <= SHORT_LABEL_MAX_LEN && !/^[a-z]{3,}\s/.test(line) && !line.endsWith(',');
}

function looksLikeContinuation(line: string, prevLine: string): boolean {
  if (line.length > 80) return false;
  if (CONTINUATION_INDICATORS.test(line)) return true;
  if (prevLine.endsWith('-') || prevLine.endsWith(',')) return true;
  if (/^[a-z]/.test(line) && prevLine.length > 20 && !prevLine.endsWith('.')) return true;
  return false;
}

function shouldSplitBefore(line: string): boolean {
  if (isShortLabel(line)) return true;
  if (LABEL_PATTERNS.test(line)) return true;
  if (/^(Colour|Color|Main fabric|Stretch fabric)/i.test(line)) return true;
  return false;
}

/** reference_block / label_cluster: 保守拆分，短行优先单独成段 */
function isConservativeRegion(rt: ExtractedRegion['regionType']): boolean {
  return rt === 'reference_block' || rt === 'label_cluster';
}

function pushSegment(
  segments: FeedbackSourceSegment[],
  region: ExtractedRegion,
  text: string,
  layoutConf: number,
  mergeConf: number
) {
  const normalized = text.trim();
  if (!normalized) return;
  segments.push({
    id: `${region.id}_s${segments.length}`,
    text: normalized,
    pageNumber: region.pageNumber,
    regionId: region.id,
    extractionMeta: {
      sourceType: 'text_layer' as SegmentSourceType,
      layoutConfidence: layoutConf,
      mergeConfidence: mergeConf,
      regionId: region.id
    }
  });
}

function splitMixedTableCells(rawLine: string) {
  return rawLine
    .split(/\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function segmentsFromTableRegion(
  region: ExtractedRegion,
  layoutType: PageLayoutType
): FeedbackSourceSegment[] {
  const segments: FeedbackSourceSegment[] = [];
  for (const rawLine of region.lines) {
    const text = rawLine.trim();
    if (!text) continue;
    const cells = text.split(/\s{2,}/).map((item) => item.trim()).filter(Boolean);
    if (layoutType === 'mixed') {
      const mixedCells =
        cells.flatMap((cell) => splitMixedTableCells(cell)).filter(Boolean);
      if (mixedCells.length >= 2) {
        for (const cell of mixedCells) {
          pushSegment(segments, region, cell, 0.91, 0.95);
        }
      } else {
        pushSegment(
          segments,
          region,
          splitMixedTableCells(text).join(' | ') || text,
          0.9,
          0.92
        );
      }
      continue;
    }

    if (cells.length >= 2) {
      pushSegment(segments, region, cells.join(' | '), 0.93, 0.95);
    } else {
      pushSegment(segments, region, text, 0.9, 0.9);
    }
  }
  return segments;
}

function segmentsFromRegion(region: ExtractedRegion, layoutType: PageLayoutType): FeedbackSourceSegment[] {
  if (region.regionType === 'table_block' || layoutType === 'table') {
    return segmentsFromTableRegion(region, layoutType);
  }

  const conservative = isConservativeRegion(region.regionType);
  const segments: FeedbackSourceSegment[] = [];
  const lines = region.lines;
  let buffer: string[] = [];
  let mergeConfidence = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';

    if (line.trim().length === 0) {
      if (buffer.length > 0) {
        pushSegment(segments, region, buffer.join(' ').trim(), 0.85, mergeConfidence);
        buffer = [];
        mergeConfidence = 1;
      }
      continue;
    }

    const isContinuation = buffer.length > 0 && looksLikeContinuation(line, prevLine);
    const forceSplit = shouldSplitBefore(line);
    const shortLine = isShortLabel(line);

    if (conservative && shortLine) {
      if (buffer.length > 0) {
        pushSegment(segments, region, buffer.join(' ').trim(), 0.85, mergeConfidence);
        buffer = [];
      }
      pushSegment(segments, region, line.trim(), 0.9, 1);
      continue;
    }

    if (forceSplit && buffer.length > 0) {
      pushSegment(segments, region, buffer.join(' ').trim(), 0.85, mergeConfidence);
      buffer = [];
      mergeConfidence = 1;
    }

    if (forceSplit && !isContinuation) {
      pushSegment(segments, region, line.trim(), 0.9, 1);
      continue;
    }

    if (isContinuation) {
      buffer.push(line.trim());
      mergeConfidence = Math.min(mergeConfidence, conservative ? 0.85 : 0.9);
    } else {
      if (buffer.length > 0) {
        pushSegment(segments, region, buffer.join(' ').trim(), 0.85, mergeConfidence);
        buffer = [];
      }
      buffer.push(line.trim());
    }
  }

  if (buffer.length > 0) {
    pushSegment(segments, region, buffer.join(' ').trim(), 0.85, mergeConfidence);
  }

  return segments;
}

function hasSuspiciousShortFragments(segments: FeedbackSourceSegment[]): boolean {
  if (segments.length === 0) return false;
  const shortCount = segments.filter((segment) => segment.text.length <= LOW_CONF_SHORT_SEGMENT_LEN).length;
  return ratio(shortCount, segments.length) >= LOW_CONF_SHORT_SEGMENT_RATIO;
}

function hasAbnormalSegmentsPerPage(layoutType: PageLayoutType, count: number): boolean {
  if (layoutType === 'table') return count >= LOW_CONF_MAX_SEGMENTS_PER_PAGE_TABLE;
  if (layoutType === 'mixed') return count >= LOW_CONF_MAX_SEGMENTS_PER_PAGE_MIXED;
  return false;
}

function isLowConfidenceSegment(segment: FeedbackSourceSegment): boolean {
  return (
    segment.extractionMeta.layoutConfidence < LOW_CONF_LAYOUT_THRESHOLD ||
    segment.extractionMeta.mergeConfidence < LOW_CONF_MERGE_THRESHOLD
  );
}

type FirstPassPageResult = {
  pageNumber: number;
  layoutType: PageLayoutType;
  regions: ExtractedRegion[];
  segments: FeedbackSourceSegment[];
};

function runFirstPassFusion(page: ExtractedPage): FirstPassPageResult {
  const layoutType = inferPageLayoutType(page);
  const regions = buildRegionsForPage(page, layoutType);
  const segments = regions.flatMap((region) => segmentsFromRegion(region, layoutType));
  return {
    pageNumber: page.pageNumber,
    layoutType,
    regions,
    segments
  };
}

function detectLowConfidence(
  firstPass: FirstPassPageResult[]
): { lowConfidencePages: Set<number>; lowConfidenceRegions: Set<string> } {
  const lowConfidencePages = new Set<number>();
  const lowConfidenceRegions = new Set<string>();

  for (const page of firstPass) {
    const lowSegments = page.segments.filter(isLowConfidenceSegment);
    const hasLowSegment = lowSegments.length > 0;
    const abnormalDensity = hasAbnormalSegmentsPerPage(page.layoutType, page.segments.length);
    const suspiciousShortFragments = hasSuspiciousShortFragments(page.segments);
    const noTableBlockOnTablePage =
      page.layoutType === 'table' && page.regions.every((region) => region.regionType !== 'table_block');
    const pageLow = hasLowSegment || abnormalDensity || suspiciousShortFragments || noTableBlockOnTablePage;

    if (pageLow) {
      lowConfidencePages.add(page.pageNumber);
      if (hasLowSegment) {
        for (const segment of lowSegments) {
          lowConfidenceRegions.add(segment.regionId);
        }
      } else {
        for (const region of page.regions) {
          lowConfidenceRegions.add(region.id);
        }
      }
    }
  }

  return { lowConfidencePages, lowConfidenceRegions };
}

function runSecondPassFusionPlaceholder(
  firstPass: FirstPassPageResult[],
  lowConfidencePages: Set<number>,
  lowConfidenceRegions: Set<string>
): FirstPassPageResult[] {
  // P0 placeholder: keep text-layer result, reserve second-pass integration point.
  if (lowConfidencePages.size === 0 && lowConfidenceRegions.size === 0) return firstPass;
  return firstPass;
}

export function buildFeedbackSourceReference(
  extracted: ExtractedPdfResult,
  file: { name: string }
): FeedbackSourceReference {
  return buildFeedbackSourceReferenceWithDiagnostics(extracted, file).reference;
}

export function buildFeedbackSourceReferenceWithDiagnostics(
  extracted: ExtractedPdfResult,
  file: { name: string }
): FeedbackSourceBuildResult {
  const sections: FeedbackSourceSection[] = [];
  const earlyGatePages = new Set<number>();

  const firstPass = extracted.pages.map((page) => {
    if (isTextLayerInsufficient(page)) {
      earlyGatePages.add(page.pageNumber);
    }
    return runFirstPassFusion(page);
  });

  const lowConfidence = detectLowConfidence(firstPass);
  for (const pageNumber of earlyGatePages) {
    lowConfidence.lowConfidencePages.add(pageNumber);
    const page = firstPass.find((item) => item.pageNumber === pageNumber);
    if (page) {
      for (const region of page.regions) {
        lowConfidence.lowConfidenceRegions.add(region.id);
      }
    }
  }
  const secondPass = runSecondPassFusionPlaceholder(
    firstPass,
    lowConfidence.lowConfidencePages,
    lowConfidence.lowConfidenceRegions
  );

  for (const page of secondPass) {
    for (let regionIndex = 0; regionIndex < page.regions.length; regionIndex++) {
      const region = page.regions[regionIndex];
      const segs = page.segments.filter((segment) => segment.regionId === region.id);
      if (segs.length > 0) {
        sections.push({
          id: `section_p${page.pageNumber}_r${regionIndex}`,
          title: `Page ${page.pageNumber} / Region ${regionIndex + 1}`,
          summary: `${region.regionType} · ${segs.length} segments`,
          segments: segs,
          pageLayoutType: page.layoutType
        });
      }
    }
  }

  return {
    reference: {
      file,
      sections
    },
    diagnostics: {
      earlyGatePages: Array.from(earlyGatePages).sort((a, b) => a - b),
      lowConfidencePages: Array.from(lowConfidence.lowConfidencePages).sort((a, b) => a - b),
      lowConfidenceRegionIds: Array.from(lowConfidence.lowConfidenceRegions).sort(),
      secondPassRequired: lowConfidence.lowConfidencePages.size > 0,
      secondPassExecuted: false
    }
  };
}
