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

export type ComparisonMatch = {
  aiIndex: number;
  referenceIndex: number;
  aiLocationLabel: string;
  referenceLocationLabel: string;
  aiTextZh: string;
  referenceText: string;
  score: number;
  samePage: boolean;
};

export type ComparisonMetrics = {
  status: 'pass' | 'warn' | 'fail' | 'no_reference';
  aiCandidateCount: number;
  referenceCandidateCount: number;
  matchedCount: number;
  unmatchedAiCount: number;
  unmatchedReferenceCount: number;
  averageMatchScorePct: number;
  referenceRecallPct: number;
  aiPrecisionPct: number;
  skippedAiCount: number;
  skippedReferenceCount: number;
};

export type ComparisonCandidate = {
  index: number;
  pageNumber?: number;
  lineNumber?: number;
  locationLabel: string;
  text: string;
  normalizedText: string;
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
    maxSegmentsForTranslation?: number;
    budgetCapped: boolean;
  };
  referenceStats: {
    documentCount: number;
    totalReferenceItems: number;
  };
  metrics: ComparisonMetrics;
  topMatches: ComparisonMatch[];
  unmatchedAi: ComparisonCandidate[];
  unmatchedReference: ComparisonCandidate[];
  sideBySideRows: SideBySideComparisonRow[];
  reviewHints: string[];
  generatedAt: string;
};

export type EvaluationRunContext = {
  manifestPath: string;
  generatedAt: string;
  maxSegmentsForTranslation?: number;
  skipExisting?: boolean;
  onlySamples?: string[];
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
  comparisonStatus?: ComparisonMetrics['status'];
  referenceRecallPct?: number;
  aiPrecisionPct?: number;
  maxSegmentsForTranslation?: number;
  budgetCapped?: boolean;
  artifacts?: {
    annotatedPreview?: string | null;
    bilingualXlsx?: string | null;
    tableStylePdf?: string | null;
  };
  error?: string;
};

const MARKDOWN_COMPARE_ROW_LIMIT = 80;
const MATCH_THRESHOLD_DEFAULT = 0.52;
const TOP_MATCH_LIMIT = 12;
const UNMATCHED_LIMIT = 12;

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

  function splitReferenceLine(text: string) {
    const normalized = text.replace(/\u00a0/g, ' ').trim();
    if (!normalized) {
      return [];
    }

    const chunks = normalized
      .split(/\s{4,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    return chunks.length > 1 ? chunks : [normalized];
  }

  extracted.pages.forEach((page) => {
    page.lines
      .map((line, lineIndex) => ({
        lineIndex,
        text: line.trim()
      }))
      .filter((item) => item.text.length > 0)
      .forEach((item) => {
        const parts = splitReferenceLine(item.text);
        parts.forEach((part, partIndex) => {
          items.push({
            sourceRole: role,
            sourcePath: toRepoRelative(sourcePath),
            index: items.length + 1,
            text: part,
            pageNumber: page.pageNumber,
            lineNumber: item.lineIndex + 1,
            locationLabel:
              parts.length > 1
                ? `P${page.pageNumber}L${item.lineIndex + 1}.${partIndex + 1}`
                : `P${page.pageNumber}L${item.lineIndex + 1}`
          });
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
  const baseItems = pipeline.outputs.bilingualTableBundle?.rows?.length
    ? pipeline.outputs.bilingualTableBundle.rows.map((row, index) => ({
      index: index + 1,
      source: 'bilingual_table_bundle' as const,
      pageNumber: row.pageNumber,
      regionId: row.regionId,
      textEn: row.en ?? '',
      textZh: row.zh?.trim() ?? '',
      locationLabel: `P${row.pageNumber ?? '?'} · ${row.regionId ?? 'region'}`
    }))
    : pipeline.outputs.annotatedPdf?.items?.length
      ? pipeline.outputs.annotatedPdf.items.map((item, index) => ({
      index: index + 1,
      source: 'annotated_preview' as const,
      pageNumber: item.pageNumber,
      regionId: item.regionId,
      textEn: item.en ?? '',
      textZh: item.zh?.trim() ?? '',
      locationLabel: `P${item.pageNumber ?? '?'} · ${item.regionId ?? 'region'}`
      }))
      : pipeline.segments.map((segment, index) => ({
    index: index + 1,
    source: 'segments' as const,
    pageNumber: segment.pageNumber,
    regionId: segment.regionId,
    textEn: segment.text ?? '',
    textZh: segment.zh?.trim() ?? '',
    locationLabel: `P${segment.pageNumber ?? '?'} · ${segment.regionId ?? 'region'}`
      }));

  if (pipeline.documentMainType !== 'mixed') {
    return baseItems;
  }

  const grouped: AiComparisonItem[] = [];
  const rowFragmentPattern = /^(p\d+_r\d+)_s\d+$/i;
  let pending:
    | (AiComparisonItem & {
        rowGroup: string;
      })
    | null = null;

  function flushPending() {
    if (!pending) return;
    grouped.push({
      index: grouped.length + 1,
      source: pending.source,
      pageNumber: pending.pageNumber,
      regionId: pending.regionId,
      textEn: pending.textEn.replace(/\s*\|\s*/g, ' | ').trim(),
      textZh: pending.textZh.replace(/\s*\|\s*/g, ' | ').trim(),
      locationLabel: pending.locationLabel
    });
    pending = null;
  }

  for (const item of baseItems) {
    const match = item.regionId?.match(rowFragmentPattern);
    if (!match || /vision/i.test(item.regionId ?? '')) {
      flushPending();
      grouped.push({
        ...item,
        index: grouped.length + 1
      });
      continue;
    }

    const rowGroup = match[1];
    const sameGroup =
      pending &&
      pending.pageNumber === item.pageNumber &&
      pending.rowGroup === rowGroup &&
      pending.source === item.source;

    if (!sameGroup) {
      flushPending();
      pending = {
        ...item,
        index: grouped.length + 1,
        rowGroup,
        regionId: rowGroup,
        locationLabel: `P${item.pageNumber ?? '?'} · ${rowGroup}`
      };
      continue;
    }

    if (pending) {
      pending.textEn = [pending.textEn, item.textEn].filter(Boolean).join(' | ');
      pending.textZh = [pending.textZh, item.textZh].filter(Boolean).join(' | ');
    }
  }

  flushPending();

  const expanded: AiComparisonItem[] = [];
  for (const item of grouped) {
    const parts = splitMixedComparisonText(item.textZh);
    if (parts.length <= 1) {
      expanded.push({
        ...item,
        index: expanded.length + 1
      });
      continue;
    }

    for (const part of parts) {
      expanded.push({
        ...item,
        index: expanded.length + 1,
        textZh: part
      });
    }
  }

  return expanded;
}

function hasCjk(text: string) {
  return /[\u3400-\u9fff]/u.test(text);
}

function looksLikeLowValueMeta(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  return (
    /\b(hiver|ete|spring|summer|autumn|winter)\b/i.test(normalized) ||
    /\b(dossier style|en attente|artwork|description)\b/i.test(normalized) ||
    /\b(style sheet|designer|graphic designer|model maker|purchaser|oversea)\b/i.test(normalized) ||
    /\b(all rights reserved|edited on)\b/i.test(normalized) ||
    /^(quality|details|references|front|back|colours|trims|men|women(?:swear)?|option\s*\d+)$/i.test(
      normalized
    ) ||
    /^created:\s*\d{4}\s+\d{2}\s+\d{2}\s*\|\s*updated:?$/i.test(normalized) ||
    /^supplier:?$/i.test(normalized) ||
    /^for\s+middle\s+front\s+opening\s*\+\s*cuffs?$/i.test(normalized) ||
    /^nm\s*\d+[\d\s,./a-z-]*pts?\s*\/\s*1cm(?:\s*t\/t)?$/i.test(normalized) ||
    /^original idea for shape and collar shape$/i.test(normalized) ||
    /^l&m$/i.test(normalized) ||
    /^\d+\/\d+$/.test(normalized) ||
    /^[A-Z]\d{5,}$/i.test(normalized) ||
    /^\s*(size|base)\s+[A-Z0-9 ]+$/i.test(normalized)
  );
}

function splitMixedComparisonText(text: string) {
  const pieces = text
    .split(/\s*\|\s*/)
    .map((item) => item.trim())
    .flatMap((item) => {
      const colorPlusLabel = item.match(
        /^((?:\d+\s*#?\s*)?(?:黑色|白色|绿色|蓝色|咖色|海军蓝|ecru|sage|bleu acier|ecorce))\s+(.+)$/i
      );
      if (colorPlusLabel) {
        return [colorPlusLabel[1], colorPlusLabel[2]];
      }
      return [item];
    })
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return Array.from(new Set(pieces));
}

function canonicalizeBusinessTerms(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/shell\s*fabric\s*option\s*#?\s*1/gi, '面料1')
    .replace(/shell\s*fabric\s*option\s*#?\s*2/gi, '面料2')
    .replace(/面料(?:选项|方案)?\s*#?\s*1/gi, '面料1')
    .replace(/面料(?:选项|方案)?\s*#?\s*2/gi, '面料2')
    .replace(/02\s*#?\s*黑色|02\s*noir/gi, '02黑色')
    .replace(/48\s*#?\s*海军蓝|48\s*marine/gi, '48海军蓝')
    .replace(/尺码标|码标/gi, '尺码标')
    .replace(/尺码标\s*73518|码标\s*73518|73518(?:\s*尺码标|\s*码标)?/gi, '尺码标73518')
    .replace(/里布|身里|body lining/gi, '里布')
    .replace(/哑光尼龙(?:里布|衬)?|dull nylon lining/gi, '哑光尼龙里')
    .replace(/60grs|60g/gi, '60g')
    .replace(/40grs|40g/gi, '40g')
    .replace(/衣身|身部|body/gi, '大身')
    .replace(/袖子|sleeves/gi, '袖子')
    .replace(/袖口\+?腰带\+?领子?面料|袖口[，,]底摆[，,]领材料|袖口底摆领材料/gi, '袖口底摆领材料')
    .replace(/外观同棉质|棉质感材料|相同棉制|same cotton fabric|same cotton face look/gi, '棉质')
    .replace(/剃毛抓绒|背面不做羊羔毛|反面无羊羔毛|反面无羊羔|no polar fleece|shaved polar fleece/gi, '反面无羊羔')
    .replace(/更薄一些|to be thinner|更薄/gi, '更薄')
    .replace(/炭灰色|深灰色|anthracite/gi, '深灰色')
    .replace(/反光转印线条|反光面胶|reflective transfer print line|reflective line/gi, '反光')
    .replace(/1\/1|1x1/gi, '1x1')
    .replace(/内袖口罗纹|袖口1x1尼龙罗纹|inside cuff knit rib/gi, '袖口罗纹')
    .replace(/new logo label|新logo主标|新logo标|新主标/gi, '新主标')
    .replace(/尺码标|码标/gi, '尺码标')
    .replace(/吊牌/gi, '吊牌')
    .replace(/主标/gi, '主标')
    .replace(/烫标/gi, '烫标')
    .replace(/back\s*elasticated\s*waistband/gi, '后腰松紧')
    .replace(/后(?:腰部?)?(?:橡筋|松紧腰头|松紧带)/gi, '后腰松紧')
    .replace(/chino\s*pocket\s*\+\s*pleat/gi, '侧袋')
    .replace(/斜插侧袋|卡其布口袋(?:\s*\+\s*褶裥)?/gi, '侧袋')
    .replace(/(?:15\s*mm\s*)?(?:piped pocket|包边袋|嵌线袋|单开线口袋)/gi, '15mm嵌线袋')
    .replace(/plastic snap|按扣|门襟扣|四合扣/gi, '四合扣')
    .replace(/top front fly button|front fly|门襟用|门襟顶部纽扣/gi, '门襟')
    .replace(/autoblock zipper|zipper|拉链/gi, '拉链')
    .replace(/reverse coil/gi, '反装')
    .replace(/5mm|5#/gi, '5#')
    .replace(/3mm|3#/gi, '3#')
    .replace(/尼龙反装开尾拉链|反向线圈拉链|反装拉链/gi, '反装拉链')
    .replace(/自动锁头闭尾拉链|自动锁拉链/g, '自动锁拉链')
    .replace(/15\s*mm\s*(?:塑料)?(?:门襟)?四合扣|15mm塑料门襟扣/gi, '15mm四合扣')
    .replace(/门襟84851四合扣|前开襟[:：]?\s*84851/gi, '门襟84851四合扣')
    .replace(/袖口84851四合扣|84851(?:\s*在)?袖口开(?:口|衩)处/gi, '袖口84851四合扣')
    .replace(/3#隐形拉链侧|隐形拉链[:：]?(?:前袋|侧袋)?(?:，|,)?(?:颜色|配色)?(?:与外层面料一致|同色)?/gi, '3#隐形拉链侧')
    .replace(/里兜3#反装尼龙|3#尼龙反装拉链黑色|反装拉链黑色/gi, '里兜3#反装尼龙')
    .replace(/面料[:：]?\s*华悦.*m245013|面料1.*m245013/gi, '面料1与m245013相同面料')
    .replace(/对比面料[:：]?.*m145023|面料2.*m145023/gi, '面料2与m145023相同面料')
    .replace(/身里春亚纺\s*黑色|里料.*02\s*黑色.*适用于所有组合/gi, '身里春亚纺黑色')
    .replace(/填充物[:：]?.*m145023.*|填充[:：]?\s*与m145023相同/gi, '填充与m145023相同')
    .replace(/1x1罗纹内领|领内罗纹[:：]?.*1\/?1.*聚酯纤维/gi, '1x1罗纹内领')
    .replace(/面料平装领|外平领[:：]?.*外层面料/gi, '面料平装领')
    .replace(/版型基于\s*m?(\d{5,})/gi, '版型基于m$1')
    .replace(/版型同\s*m?145023|版型基于\s*m?145023|^m145023$/gi, '版型同m145023')
    .replace(/门襟\s*\+\s*侧袋|门襟侧袋|middle front opening\s*\+\s*front pockets? opening/gi, '门襟侧袋')
    .replace(/样板按照原样品但是后中长做到?\s*74\s*cm|后中长做到?\s*74\s*cm|but middle back length\s*74\s*cm/gi, '后中长74cm')
    .replace(/袋布[:：]?\s*经编起毛布(?:颜色)?|pocketing fabric/gi, '袋布')
    .replace(/顺主身面料|同主身面料色|matching color with shell fabric color/gi, '同主身面料')
    .replace(/ikks(?:\s*logo)?\s*puller/gi, 'ikks拉头')
    .replace(/顺大身色|同面布|matching color(?: with outshell fabric)?/gi, '同色')
    .replace(/票袋|metro pass pocket/gi, '票袋')
    .replace(/front pocket|inside pocket|pocket bag/gi, '袋')
    .replace(/中背长|middle back length/gi, '后中长')
    .replace(/总袖长|spread sleeves length/gi, '总袖长')
    .replace(/attachment sample|参考样衣|附件样衣/gi, '参考样衣')
    .replace(/inside neckline patched jersey band|领圈有针织带|领口内侧贴罗纹带/gi, '领圈针织带')
    .replace(/same back construction.*attachment|后背结构与附件相同/gi, '后背结构相同')
    .replace(/same front workmanship.*attachment|与参考样品相同的正面工艺/gi, '前片工艺相同')
    .replace(/后背结构同附件sple|后背结构同附件/gi, '后背结构相同')
    .replace(/tunnel pocket on front.*inside body|前身袋鼠兜顶部缝合在身内/gi, '前袋缝在身内')
    .replace(/前身袋鼠兜|隧道袋|tunnel pocket on front/gi, '前袋')
    .replace(/顶部缝合在身内|top[- ]?stitch.*inside body/gi, '顶缝在身内')
    .replace(/窄盖机双针保证牢固度|双针保证牢固度/gi, '双针加固')
    .replace(/帽上隐形磁吸朝向与my42033相同|帽门襟暗磁扣.*my42033|hidden magnets.*my42033/gi, '帽磁吸my42033')
    .replace(/门贴内有拉链|middle front placket.*zipped opening/gi, '门贴拉链')
    .replace(/前胸贴袋|胸袋盖|thermofused chest flap/gi, '前胸贴袋')
    .replace(/袋口压双面胶内藏拉链口袋|front hidden zipped pocket.*thermofused/gi, '袋口拉链')
    .replace(/后浮水压双面胶|thermofused flap/gi, '双面胶')
    .replace(/暗襟双面胶|thermofused under placket/gi, '暗襟双面胶')
    .replace(/侧缝移到后身|后身侧缝.*错位|side seam.*back body/gi, '侧缝后移')
    .replace(/后背反光面胶|reflective line on middle back/gi, '后背反光')
    .replace(/羊羔毛|抓绒|polar fleece/gi, '抓毛')
    .replace(/pocketing/gi, '袋布')
    .replace(/colour|color/gi, '颜色')
    .replace(/matching color with outshell fabric/gi, '同面布')
    .replace(/配色同面布|配色同外层面料|与外层面料同色/gi, '同面布')
    .replace(/dart|后省|省道|省\b/gi, '省')
    .replace(/gun metal(?: finishing)?/gi, '枪色')
    .replace(/extra flat/gi, '')
    .replace(/placket/gi, '门襟')
    .replace(/[（）()［］[\]{}<>]/g, ' ')
    .replace(/[,:;·•，。；：!！?？/\\|"'`~^*_+=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(text: string) {
  return canonicalizeBusinessTerms(text).replace(/\s+/g, '');
}

function buildBigrams(value: string) {
  if (value.length <= 1) {
    return new Set(value ? [value] : []);
  }

  const pairs = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    pairs.add(value.slice(index, index + 2));
  }
  return pairs;
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftPairs = buildBigrams(left);
  const rightPairs = buildBigrams(right);
  if (leftPairs.size === 0 || rightPairs.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) {
      intersection += 1;
    }
  }

  return (2 * intersection) / (leftPairs.size + rightPairs.size);
}

function extractNumericTokens(text: string) {
  return Array.from(
    new Set(
      (text.match(/\d+(?:\.\d+)?(?:mm|cm|gr\/m2|grm2|m2|#)?/gi) ?? []).map((item) =>
        item.toLowerCase()
      )
    )
  );
}

function numericOverlapScore(left: string, right: string) {
  const leftTokens = extractNumericTokens(left);
  const rightTokens = extractNumericTokens(right);
  if (leftTokens.length === 0 && rightTokens.length === 0) {
    return 1;
  }
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const matched = leftTokens.filter((token) => rightSet.has(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function computeMatchScore(aiText: string, referenceText: string, samePage: boolean) {
  const aiNormalized = normalizeForComparison(aiText);
  const referenceNormalized = normalizeForComparison(referenceText);
  if (!aiNormalized || !referenceNormalized) {
    return 0;
  }

  const shorterLength = Math.min(aiNormalized.length, referenceNormalized.length);
  const longerLength = Math.max(aiNormalized.length, referenceNormalized.length);
  const containsScore =
    aiNormalized.includes(referenceNormalized) || referenceNormalized.includes(aiNormalized)
      ? Math.max(0.82, shorterLength / Math.max(1, longerLength))
      : 0;
  const diceScore = diceCoefficient(aiNormalized, referenceNormalized);
  const numberScore = numericOverlapScore(aiNormalized, referenceNormalized);

  const rawScore = Math.max(containsScore, diceScore * 0.78 + numberScore * 0.22);
  return Math.min(1, rawScore + (samePage ? 0.06 : 0));
}

function scoreThresholdForPair(aiText: string, referenceText: string) {
  const shortest = Math.min(
    normalizeForComparison(aiText).length,
    normalizeForComparison(referenceText).length
  );
  if (shortest <= 2) return 0.95;
  if (shortest <= 4) return 0.8;
  if (shortest <= 6) return 0.68;
  return MATCH_THRESHOLD_DEFAULT;
}

function toAiCandidate(item: AiComparisonItem): ComparisonCandidate | null {
  if (!item.textZh.trim()) {
    return null;
  }
  const highValueZh =
    /版型基于|四合扣|拉链|袋布|面料\d|后腰|侧袋|单开线口袋|嵌线袋|省|黑色|新主标|尺码标|刺绣|后中长|里布|领/u.test(
      item.textZh
    );
  if (!highValueZh && (looksLikeLowValueMeta(item.textEn) || looksLikeLowValueMeta(item.textZh))) {
    return null;
  }

  return {
    index: item.index,
    pageNumber: item.pageNumber,
    locationLabel: item.locationLabel,
    text: item.textZh.trim(),
    normalizedText: normalizeForComparison(item.textZh)
  };
}

function toReferenceCandidate(item: ReferenceItem): ComparisonCandidate | null {
  if (!item.text.trim()) {
    return null;
  }
  if (!hasCjk(item.text) || looksLikeLowValueMeta(item.text)) {
    return null;
  }

  return {
    index: item.index,
    pageNumber: item.pageNumber,
    lineNumber: item.lineNumber,
    locationLabel: item.locationLabel,
    text: item.text.trim(),
    normalizedText: normalizeForComparison(item.text)
  };
}

function mergeMixedReferenceCandidates(referenceCandidates: ComparisonCandidate[]) {
  const merged: ComparisonCandidate[] = [];
  let pending: ComparisonCandidate | null = null;

  function flushPending() {
    if (!pending) return;
    merged.push(pending);
    pending = null;
  }

  for (const current of referenceCandidates) {
    const canMerge =
      pending &&
      pending.pageNumber === current.pageNumber &&
      typeof pending.lineNumber === 'number' &&
      typeof current.lineNumber === 'number' &&
      current.lineNumber - pending.lineNumber <= 1 &&
      pending.text.length <= 18 &&
      current.text.length <= 18 &&
      !/[。！？!?:：]$/.test(pending.text);

    if (!canMerge) {
      flushPending();
      pending = { ...current };
      continue;
    }

    const previous: ComparisonCandidate = pending as ComparisonCandidate;
    pending = {
      ...previous,
      lineNumber: current.lineNumber,
      text: `${previous.text}${current.text}`,
      normalizedText: normalizeForComparison(`${previous.text}${current.text}`)
    };
  }

  flushPending();
  return merged;
}

function filterMixedAiCandidates(aiCandidates: ComparisonCandidate[]) {
  return aiCandidates.filter((item) => {
    const text = item.text.replace(/\s+/g, ' ').trim();
    return !(
      /^m\d+[a-z0-9-]*$/i.test(text) ||
      /^款号[:：]/.test(text) ||
      /^成分[:：]/.test(text) ||
      /^克重[:：]/.test(text) ||
      /^幅宽[:：]/.test(text) ||
      /^面料[/:：]?织物$/.test(text) ||
      /^#?[a-z0-9-]{4,}$/i.test(text) ||
      /^\d+%[A-Z ]+$/i.test(text) ||
      /^底压$/.test(text) ||
      /^原样$/.test(text) ||
      /^后视图$/.test(text) ||
      /^15mm$/.test(text) ||
      /^内袋$/.test(text) ||
      /^t\/t$/i.test(text) ||
      /^下摆[:：]可调节腰带$/.test(text) ||
      /^底身侧[:：]可调节腰带$/.test(text) ||
      /^底边可调节腰带$/.test(text) ||
      /^面料[:：]起皱轻尼龙$/.test(text) ||
      /^前中第二开口 ?\+ ?领口 ?\+ ?护颈$/.test(text)
    );
  });
}

function buildComparisonMetrics(
  aiItems: AiComparisonItem[],
  referenceItems: ReferenceItem[],
  documentMainType?: string
) {
  const rawAiCandidates = aiItems.map(toAiCandidate).filter(Boolean) as ComparisonCandidate[];
  const aiCandidates =
    documentMainType === 'mixed' ? filterMixedAiCandidates(rawAiCandidates) : rawAiCandidates;
  const rawReferenceCandidates = referenceItems
    .map(toReferenceCandidate)
    .filter(Boolean) as ComparisonCandidate[];
  const referenceCandidates =
    documentMainType === 'mixed'
      ? mergeMixedReferenceCandidates(rawReferenceCandidates)
      : rawReferenceCandidates;

  if (referenceCandidates.length === 0) {
    return {
      metrics: {
        status: 'no_reference' as const,
        aiCandidateCount: aiCandidates.length,
        referenceCandidateCount: 0,
        matchedCount: 0,
        unmatchedAiCount: aiCandidates.length,
        unmatchedReferenceCount: 0,
        averageMatchScorePct: 0,
        referenceRecallPct: 0,
        aiPrecisionPct: 0,
        skippedAiCount: aiItems.length - aiCandidates.length,
        skippedReferenceCount: referenceItems.length
      },
      matches: [] as ComparisonMatch[],
      unmatchedAi: aiCandidates,
      unmatchedReference: [] as ComparisonCandidate[]
    };
  }

  const allPairs: ComparisonMatch[] = [];
  for (const ai of aiCandidates) {
    for (const reference of referenceCandidates) {
      const samePage =
        typeof ai.pageNumber === 'number' &&
        typeof reference.pageNumber === 'number' &&
        ai.pageNumber === reference.pageNumber;
      const score = computeMatchScore(ai.text, reference.text, samePage);
      allPairs.push({
        aiIndex: ai.index,
        referenceIndex: reference.index,
        aiLocationLabel: ai.locationLabel,
        referenceLocationLabel: reference.locationLabel,
        aiTextZh: ai.text,
        referenceText: reference.text,
        score,
        samePage
      });
    }
  }

  const referenceBestMatches = referenceCandidates
    .map((reference) =>
      allPairs
        .filter((pair) => pair.referenceIndex === reference.index)
        .sort((left, right) => right.score - left.score)[0] ?? null
    )
    .filter((item): item is ComparisonMatch => Boolean(item))
    .filter((pair) => pair.score >= scoreThresholdForPair(pair.aiTextZh, pair.referenceText));

  const aiBestMatches = aiCandidates
    .map((ai) =>
      allPairs
        .filter((pair) => pair.aiIndex === ai.index)
        .sort((left, right) => right.score - left.score)[0] ?? null
    )
    .filter((item): item is ComparisonMatch => Boolean(item))
    .filter((pair) => pair.score >= scoreThresholdForPair(pair.aiTextZh, pair.referenceText));

  const pairMap = new Map<string, ComparisonMatch>();
  for (const pair of [...referenceBestMatches, ...aiBestMatches]) {
    const key = `${pair.aiIndex}:${pair.referenceIndex}`;
    const existing = pairMap.get(key);
    if (!existing || pair.score > existing.score) {
      pairMap.set(key, pair);
    }
  }

  const matches = Array.from(pairMap.values()).sort((left, right) => right.score - left.score);
  const matchedAiSet = new Set(aiBestMatches.map((pair) => pair.aiIndex));
  const matchedReferenceSet = new Set(referenceBestMatches.map((pair) => pair.referenceIndex));
  const unmatchedAi = aiCandidates.filter((item) => !matchedAiSet.has(item.index));
  const unmatchedReference = referenceCandidates.filter((item) => !matchedReferenceSet.has(item.index));
  const averageScore =
    matches.length > 0
      ? Math.round(
          (matches.reduce((sum, item) => sum + item.score, 0) / matches.length) * 100
        )
      : 0;
  const referenceRecallPct = referenceCandidates.length
    ? Math.round((matchedReferenceSet.size / referenceCandidates.length) * 100)
    : 0;
  const aiPrecisionPct = aiCandidates.length
    ? Math.round((matchedAiSet.size / aiCandidates.length) * 100)
    : 0;

  let status: ComparisonMetrics['status'] = 'fail';
  if (referenceRecallPct >= 72 && aiPrecisionPct >= 58 && averageScore >= 70) {
    status = 'pass';
  } else if (referenceRecallPct >= 50 && aiPrecisionPct >= 42 && averageScore >= 60) {
    status = 'warn';
  }

  return {
    metrics: {
      status,
      aiCandidateCount: aiCandidates.length,
      referenceCandidateCount: referenceCandidates.length,
      matchedCount: matches.length,
      unmatchedAiCount: unmatchedAi.length,
      unmatchedReferenceCount: unmatchedReference.length,
      averageMatchScorePct: averageScore,
      referenceRecallPct,
      aiPrecisionPct,
      skippedAiCount: aiItems.length - aiCandidates.length,
      skippedReferenceCount: referenceItems.length - referenceCandidates.length
    },
    matches,
    unmatchedAi,
    unmatchedReference
  };
}

function buildReviewHints(
  pipeline: PipelineResult,
  referenceBundle: NormalizedReferenceBundle,
  metrics: ComparisonMetrics,
  options?: {
    maxSegmentsForTranslation?: number;
  }
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

  if (
    typeof options?.maxSegmentsForTranslation === 'number' &&
    pipeline.segments.length > options.maxSegmentsForTranslation
  ) {
    hints.push(
      `当前 run 设置了 TEST02_MAX_SEGMENTS=${options.maxSegmentsForTranslation}，本样本属于预算裁剪场景；Recall/Precision 只能作为受限口径参考。`
    );
  }

  if (!pipeline.outputs.annotatedPdf?.downloadable && !pipeline.outputs.bilingualTableBundle?.downloadable) {
    hints.push('当前没有可直接打开的预览/Excel 产物，需先检查 pipeline 输出。');
  }

  if (metrics.status === 'fail') {
    hints.push('当前匹配分数未过门槛，优先查看 unmatchedReference / unmatchedAi 定位缺块与噪音。');
  } else if (metrics.status === 'warn') {
    hints.push('当前已达到可继续优化状态，重点压术语风格差异和冗余输出。');
  }

  return hints;
}

export function buildSampleComparison(
  sample: SampleEntry,
  pipeline: PipelineResult,
  referenceBundle: NormalizedReferenceBundle,
  options?: {
    maxSegmentsForTranslation?: number;
  }
) {
  const aiItems = normalizeAiComparisonItems(pipeline);
  const referenceItems = referenceBundle.documents.flatMap((document) => document.items);
  const comparisonMetrics = buildComparisonMetrics(
    aiItems,
    referenceItems,
    pipeline.documentMainType
  );
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
      hasBilingualTableBundle: Boolean(pipeline.outputs.bilingualTableBundle?.downloadable?.relativePath),
      maxSegmentsForTranslation: options?.maxSegmentsForTranslation,
      budgetCapped:
        typeof options?.maxSegmentsForTranslation === 'number' &&
        pipeline.segments.length > options.maxSegmentsForTranslation
    },
    referenceStats: {
      documentCount: referenceBundle.documents.length,
      totalReferenceItems: referenceBundle.totalReferenceItems
    },
    metrics: comparisonMetrics.metrics,
    topMatches: comparisonMetrics.matches.slice(0, TOP_MATCH_LIMIT),
    unmatchedAi: comparisonMetrics.unmatchedAi.slice(0, UNMATCHED_LIMIT),
    unmatchedReference: comparisonMetrics.unmatchedReference.slice(0, UNMATCHED_LIMIT),
    sideBySideRows,
    reviewHints: buildReviewHints(pipeline, referenceBundle, comparisonMetrics.metrics, options),
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
  lines.push(
    `- Max Segments: ${typeof comparison.aiStats.maxSegmentsForTranslation === 'number' ? comparison.aiStats.maxSegmentsForTranslation : 'unlimited'}`
  );
  lines.push(`- Budget Capped: ${comparison.aiStats.budgetCapped ? 'yes' : 'no'}`);
  lines.push(`- Reference Documents: ${comparison.referenceStats.documentCount}`);
  lines.push(`- Reference Items: ${comparison.referenceStats.totalReferenceItems}`);
  lines.push(`- Match Status: ${comparison.metrics.status}`);
  lines.push(
    `- Match Metrics: recall ${comparison.metrics.referenceRecallPct}% / precision ${comparison.metrics.aiPrecisionPct}% / avg score ${comparison.metrics.averageMatchScorePct}%`
  );
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
  lines.push('## 匹配摘要');
  lines.push('');
  lines.push(
    `- AI 候选条目: ${comparison.metrics.aiCandidateCount}（跳过 ${comparison.metrics.skippedAiCount} 条低价值/空译文）`
  );
  lines.push(
    `- 参考候选条目: ${comparison.metrics.referenceCandidateCount}（跳过 ${comparison.metrics.skippedReferenceCount} 条非中文/低价值项）`
  );
  lines.push(`- 成功匹配: ${comparison.metrics.matchedCount}`);
  lines.push(`- 未匹配 AI: ${comparison.metrics.unmatchedAiCount}`);
  lines.push(`- 未匹配参考: ${comparison.metrics.unmatchedReferenceCount}`);
  lines.push('');
  lines.push('## Top Matches');
  lines.push('');
  lines.push('| Score | AI 位置 | AI 中文 | 参考位置 | 参考文本 |');
  lines.push('| ---: | --- | --- | --- | --- |');
  for (const match of comparison.topMatches) {
    lines.push(
      `| ${match.score.toFixed(2)} | ${escapeMarkdownTable(match.aiLocationLabel)} | ${escapeMarkdownTable(match.aiTextZh)} | ${escapeMarkdownTable(match.referenceLocationLabel)} | ${escapeMarkdownTable(match.referenceText)} |`
    );
  }
  lines.push('');
  lines.push('## Unmatched Reference');
  lines.push('');
  lines.push('| 位置 | 文本 |');
  lines.push('| --- | --- |');
  for (const item of comparison.unmatchedReference) {
    lines.push(`| ${escapeMarkdownTable(item.locationLabel)} | ${escapeMarkdownTable(item.text)} |`);
  }
  lines.push('');
  lines.push('## Unmatched AI');
  lines.push('');
  lines.push('| 位置 | 文本 |');
  lines.push('| --- | --- |');
  for (const item of comparison.unmatchedAi) {
    lines.push(`| ${escapeMarkdownTable(item.locationLabel)} | ${escapeMarkdownTable(item.text)} |`);
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

export function buildSummaryMarkdown(
  runId: string,
  manifestPath: string,
  summaries: SummaryRow[],
  context?: EvaluationRunContext
) {
  const lines: string[] = [];
  lines.push('# test02 Regression Run');
  lines.push('');
  lines.push(`- Run ID: \`${runId}\``);
  lines.push(`- Manifest: \`${manifestPath}\``);
  lines.push(`- Generated at: ${context?.generatedAt ?? new Date().toISOString()}`);
  lines.push(
    `- TEST02_MAX_SEGMENTS: ${typeof context?.maxSegmentsForTranslation === 'number' ? context.maxSegmentsForTranslation : 'unlimited'}`
  );
  lines.push(`- TEST02_SKIP_EXISTING: ${context?.skipExisting ? '1' : '0'}`);
  if (context?.onlySamples?.length) {
    lines.push(`- TEST02_ONLY_SAMPLES: \`${context.onlySamples.join(',')}\``);
  }
  lines.push('');
  lines.push(
    '| Sample | Status | Match | Recall | Precision | Coverage | PreviewReady | Comparison | References | Notes |'
  );
  lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: | --- |');

  for (const item of summaries) {
    const coverage =
      item.totalSegments && typeof item.translatedSegmentCount === 'number'
        ? `${item.translatedSegmentCount}/${item.totalSegments} (${item.translationCoveragePct ?? 0}%)`
        : '-';
    const matchStatus = item.comparisonStatus ?? '-';
    const recall =
      typeof item.referenceRecallPct === 'number' ? `${item.referenceRecallPct}%` : '-';
    const precision = typeof item.aiPrecisionPct === 'number' ? `${item.aiPrecisionPct}%` : '-';
    const notes =
      item.status === 'missing_source'
        ? `missing source: ${item.sourcePdf ?? '-'}`
        : item.status === 'failed'
          ? item.error ?? 'pipeline failed'
          : [item.previewSuppressedReason ?? '', item.budgetCapped ? 'budget-capped' : '']
              .filter(Boolean)
              .join(' · ');

    lines.push(
      `| ${item.sampleId} | ${item.status} | ${matchStatus} | ${recall} | ${precision} | ${coverage} | ${item.businessPreviewReady ? 'yes' : 'no'} | ${item.comparisonReady ? 'yes' : 'no'} | ${item.referenceCount} | ${notes} |`
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
