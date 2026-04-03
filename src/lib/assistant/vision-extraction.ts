/**
 * Vision-assisted extraction interface layer.
 * Phase 1: Skeleton + fallback; structure ready for future OCR / multimodal provider.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  callVisionModelChat,
  getVisionFallbackRuntimeConfig,
  getVisionModelName,
  isVisionModelConfigured
} from '@/lib/assistant/qwen-client';
import type { ModelRuntimeConfig } from '@/lib/assistant/qwen-client';

const execFileAsync = promisify(execFile);
const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN ?? 'pdftoppm';
const VISION_PAGE_RETRY_LIMIT = Math.max(0, Number(process.env.VISION_PAGE_RETRY_LIMIT ?? '1'));
const VISION_PAGE_RETRY_DELAY_MS = Math.max(
  0,
  Number(process.env.VISION_PAGE_RETRY_DELAY_MS ?? '600')
);
const VISION_MAX_RENDER_SIZE = Math.max(
  512,
  Number(process.env.VISION_MAX_RENDER_SIZE ?? '2000')
);

export type ExtractedBlockSourceType = 'text_layer' | 'vision' | 'merged';

export type ExtractedBlock = {
  pageNumber: number;
  regionId: string;
  regionType: 'label_cluster' | 'paragraph_block' | 'table_block' | 'reference_block';
  text: string;
  bbox?: { x: number; y: number; w: number; h: number };
  confidence: number;
  sourceType: ExtractedBlockSourceType;
};

export type VisionExtractionInput = {
  filePath: string;
  mimeType?: string;
  textLayerBlocks?: ExtractedBlock[];
  targetPages?: number[];
};

export type VisionExtractionResult = {
  blocks: ExtractedBlock[];
  fallbackUsed: boolean;
  provider?: string;
  modelExecuted?: boolean;
  fallbackProviderUsed?: boolean;
  pageBlockCounts?: Array<{ pageNumber: number; blockCount: number }>;
  pageRawBlockCounts?: Array<{ pageNumber: number; blockCount: number }>;
  pageErrors?: Array<{
    pageNumber: number;
    stage: 'primary' | 'fallback';
    mode: 'full' | 'focused' | 'business_crop';
    error: string;
  }>;
};

/**
 * Provider interface: implementations can plug in OCR, multimodal, etc.
 */
export type VisionExtractionProvider = (
  input: VisionExtractionInput
) => Promise<VisionExtractionResult>;

function normalizeBlockText(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeCompactText(text: string) {
  return text.replace(/[\s\-_/.:,#]+/g, '').trim().toLowerCase();
}

function looksLikeHighValueVisionText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  return /(?:颜色|color|fabric|material|pocket|zip|zipper|snap|button|waist|cuff|hem|collar|label|logo|lining|rib|fleece|embroidery|dart|pleat|waistband|option|shell|body|back|front|bag|pocketing|stitch|cm|mm|gr\/m2|g\/m2|noir|ecru|donuts)/i.test(
    normalized
  );
}

function looksLikeLowValueVisionText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }
  if (
    /^(?:colors\s*\/\s*couleurs|fabrics\s*\/\s*tissus|artwork|fitting\s*\/\s*volume|treatment\s*\/\s*traitement|stitchings\s*\/\s*coutures)$/i.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^73518$/i.test(normalized)) {
    return false;
  }
  if (looksLikeHighValueVisionText(normalized)) {
    return false;
  }

  return (
    /\b(hiver|ete|spring|summer|autumn|winter|dossier style|en attente)\b/i.test(normalized) ||
    /\b(styliste|graphiste|n[eé]goce|mod[eé]liste|acheteur|buyer|customer|client)\b/i.test(
      normalized
    ) ||
    /\b(qty|quantity|price|sales|date)\b/i.test(normalized) ||
    /\b(all rights reserved|edited on|copyright|original sample pictures)\b/i.test(normalized) ||
    /\b(style no\.?|erp|season|collection)\b/i.test(normalized) ||
    /^\s*(?:l&m|t\/t)\s*$/i.test(normalized) ||
    /^\s*nm\s*\d+(?:\s*[a-z0-9./-]+)?\s*$/i.test(normalized) ||
    /^\s*\d+(?:[.,]\d+)?\s*pts?\s*\/\s*1cm\s*$/i.test(normalized) ||
    /^\s*\d+\s*[$€]\s*\/\s*m\s*$/i.test(normalized) ||
    /^\s*(?:qty|quantity)[:：]?\s*\d+\b/i.test(normalized) ||
    /^\s*price[:：]?\s*[$€]?\s*\d+(?:\.\d+)?\b/i.test(normalized) ||
    /^\s*sales[:：]/i.test(normalized) ||
    /^\s*date[:：]?\s*\d{2,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/i.test(normalized) ||
    /^\s*\d{4,}\s*$/i.test(normalized) ||
    /^\s*[#a-z0-9-]{8,}\s*$/i.test(normalized)
  );
}

function shouldPrioritizeBusinessCrop(pageBlocks: ExtractedBlock[]) {
  const nonEmptyBlocks = pageBlocks.filter((block) => block.text.trim().length > 0);
  if (nonEmptyBlocks.length === 0) {
    return true;
  }
  const hasHighValueHint = nonEmptyBlocks.some((block) => looksLikeHighValueVisionText(block.text));
  if (hasHighValueHint) {
    return false;
  }
  return nonEmptyBlocks.length <= 8;
}

function toTokenSet(text: string) {
  return new Set(
    normalizeBlockText(text)
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function buildBigrams(text: string) {
  const normalized = normalizeCompactText(text);
  const bigrams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function overlapRatio<T>(left: Set<T>, right: Set<T>) {
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

function textSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeBlockText(left);
  const normalizedRight = normalizeBlockText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  const compactLeft = normalizeCompactText(left);
  const compactRight = normalizeCompactText(right);
  if (compactLeft && compactLeft === compactRight) {
    return 0.98;
  }
  return Math.max(
    overlapRatio(toTokenSet(left), toTokenSet(right)),
    overlapRatio(buildBigrams(left), buildBigrams(right))
  );
}

function dedupeBlocks(blocks: ExtractedBlock[]) {
  const deduped: ExtractedBlock[] = [];

  for (const block of blocks) {
    const normalized = normalizeBlockText(block.text);
    if (!normalized) {
      continue;
    }
    const duplicateIndex = deduped.findIndex((existing) => {
      if (existing.pageNumber !== block.pageNumber) {
        return false;
      }
      return textSimilarity(existing.text, block.text) >= 0.92;
    });
    if (duplicateIndex >= 0) {
      const existing = deduped[duplicateIndex];
      const keepExisting =
        existing.sourceType === 'text_layer' ||
        existing.confidence >= block.confidence;
      if (!keepExisting) {
        deduped[duplicateIndex] = block;
      }
      continue;
    }
    deduped.push(block);
  }

  return deduped;
}

function filterVisionBlocks(
  blocks: ExtractedBlock[],
  pageBlocks: ExtractedBlock[]
) {
  const textLayerSeen = new Set(pageBlocks.map((block) => normalizeCompactText(block.text)));
  return blocks.filter((block) => {
    const compact = normalizeCompactText(block.text);
    if (!compact) {
      return false;
    }
    if (textLayerSeen.has(compact)) {
      return false;
    }
    return !looksLikeLowValueVisionText(block.text);
  });
}

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonRetryableVisionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('无法连接本地模型服务')
  );
}

function isLocalRuntimeConfig(config?: ModelRuntimeConfig) {
  if (!config) {
    return false;
  }
  try {
    const hostname = new URL(config.baseUrl).hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^192\.168\./.test(hostname)
    );
  } catch {
    return false;
  }
}

async function renderPdfPageToDataUrl(filePath: string, pageNumber: number) {
  const outputDir = path.join(process.cwd(), '.tmp', 'vision-pages');
  await mkdir(outputDir, { recursive: true });
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prefix = path.join(
    outputDir,
    `${path.basename(filePath).replace(/[^\w.-]+/g, '_')}_p${pageNumber}_${token}`
  );
  const imagePath = `${prefix}.png`;

  try {
    await execFileAsync(
      PDFTOPPM_BIN,
      [
        '-png',
        '-singlefile',
        '-scale-to',
        String(VISION_MAX_RENDER_SIZE),
        '-f',
        String(pageNumber),
        '-l',
        String(pageNumber),
        filePath,
        prefix
      ],
      {
        maxBuffer: 32 * 1024 * 1024
      }
    );
    const image = await readFile(imagePath);
    return `data:image/png;base64,${image.toString('base64')}`;
  } finally {
    await rm(imagePath, { force: true }).catch(() => {});
  }
}

async function renderPdfPageCropToDataUrl(
  filePath: string,
  pageNumber: number,
  crop: { x: number; y: number; w: number; h: number }
) {
  const outputDir = path.join(process.cwd(), '.tmp', 'vision-pages');
  await mkdir(outputDir, { recursive: true });
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prefix = path.join(
    outputDir,
    `${path.basename(filePath).replace(/[^\w.-]+/g, '_')}_p${pageNumber}_${token}`
  );
  const imagePath = `${prefix}.png`;
  const cropPath = `${prefix}_crop.png`;

  try {
    await execFileAsync(
      PDFTOPPM_BIN,
      [
        '-png',
        '-singlefile',
        '-scale-to',
        String(VISION_MAX_RENDER_SIZE),
        '-f',
        String(pageNumber),
        '-l',
        String(pageNumber),
        filePath,
        prefix
      ],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', imagePath], {
      maxBuffer: 4 * 1024 * 1024
    });
    const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? '0');
    const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? '0');
    if (!width || !height) {
      const image = await readFile(imagePath);
      return `data:image/png;base64,${image.toString('base64')}`;
    }

    const cropWidth = Math.max(256, Math.min(width, Math.round(width * crop.w)));
    const cropHeight = Math.max(256, Math.min(height, Math.round(height * crop.h)));
    const offsetX = Math.max(0, Math.min(width - cropWidth, Math.round(width * crop.x)));
    const offsetY = Math.max(0, Math.min(height - cropHeight, Math.round(height * crop.y)));

    await execFileAsync(
      'sips',
      [
        '-c',
        String(cropHeight),
        String(cropWidth),
        '--cropOffset',
        String(offsetY),
        String(offsetX),
        imagePath,
        '--out',
        cropPath
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    const image = await readFile(cropPath);
    return `data:image/png;base64,${image.toString('base64')}`;
  } finally {
    await rm(imagePath, { force: true }).catch(() => {});
    await rm(cropPath, { force: true }).catch(() => {});
  }
}

function buildPageVisionPrompt(pageNumber: number, textLayerBlocks: ExtractedBlock[]) {
  const hints = textLayerBlocks
    .slice(0, 20)
    .map(
      (block, index) =>
        `${index + 1}. [${block.regionType}] ${block.text.slice(0, 120)}`
    )
    .join('\n');

  return [
    '你是服装工艺单/线稿批注 OCR 抽取器，只做识别，不做翻译。',
    `请识别第 ${pageNumber} 页上所有有业务价值的标签、批注、部位说明、辅料说明、颜色/尺寸/工艺说明。`,
    '重点：图面边上的小字批注、箭头说明、局部工艺说明，也要尽量抽出来。',
    '优先保留：颜色、面料、辅料、口袋、拉链、按扣、针距、工艺处理、版型、批注说明。',
    '如果页面同时存在头部元信息和衣服/部件工艺批注，优先输出工艺批注，不要把输出额度浪费在页眉页脚或管理字段上。',
    '若同一页存在多条短标签，必须尽量逐条拆开输出，不要把左右两列、上下相邻或不同部位的小标签合并成一句。',
    '如果页面里能看到 PROTO #1 / PROTO #2 / OP1 / OP2 这类方案标签，必须单独抽出来，不要当成低价值字段忽略。',
    '特别注意：尺码标、主标/吊牌、拉链型号/颜色、里布、罗纹、反光、热压、暗磁、袋口、门襟、袖口/下摆高度等短标签也属于高价值信息。',
    '忽略重复页头、品牌 logo、款号、页码、版权声明、编辑日期、纯装饰标题。',
    '也忽略买手/设计师/客户名、season/proto/style no/ERP、价格、针数参数、面料供应商编码这类管理或打样字段，除非它们直接描述衣服做法。',
    '下面文本层提示里的内容通常已经被其他链路抓到；除非它们是颜色/面料/工艺批注，否则不要重复输出。',
    '如果文本层提示里缺少页面上的额外批注，仍然要把这些额外内容输出。',
    '不要凭空猜测看不清的字，看不清就跳过。',
    '输出 JSON：{"blocks":[{"pageNumber":1,"regionType":"label_cluster","text":"...","confidence":0.0,"bbox":{"x":0,"y":0,"w":0,"h":0}}]}',
    'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
    'bbox 必填，使用页面归一化坐标系：左上角为原点，x/y/w/h 取值 0-1000。',
    'bbox 只需近似覆盖该批注文字本身，不需要覆盖整块版面。',
    '如果一条 OCR 结果里混入多个独立事项，请拆成多条 blocks。',
    '保持输出简洁，优先短标签；最多返回 28 个最有业务价值的 blocks。',
    '',
    '当前文本层提示（已捕获内容，可能不完整）：',
    hints || '(empty)'
  ].join('\n');
}

function buildFocusedPageVisionPrompt(pageNumber: number, textLayerBlocks: ExtractedBlock[]) {
  const hints = textLayerBlocks
    .slice(0, 12)
    .map(
      (block, index) =>
        `${index + 1}. [${block.regionType}] ${block.text.slice(0, 100)}`
    )
    .join('\n');

  return [
    '你是服装工艺单/线稿批注 OCR 抽取器，只做识别，不做翻译。',
    `请重新检查第 ${pageNumber} 页，但这次忽略顶部表头和管理字段，只看页面中部和右侧的业务内容。`,
    '重点抽取：颜色块、面料框、材料说明、主标/码标颜色、刺绣、口袋有无、版型或参考样衣说明。',
    '如果页面里有成对方案、选项、OP1/OP2、with pocket / without pocket、front/back、same as attachment/reference sample 之类的短业务句，必须单独拆出来。',
    '不要输出页眉、买手、设计师、客户、版权、编辑日期、页码。',
    '输出 JSON：{"blocks":[{"pageNumber":1,"regionType":"label_cluster","text":"...","confidence":0.0,"bbox":{"x":0,"y":0,"w":0,"h":0}}]}',
    'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
    'bbox 必填，x/y/w/h 取值 0-1000。',
    '最多返回 20 个最有业务价值的 blocks。',
    '',
    '当前文本层提示（多为已抓到的页眉，谨慎重复）：',
    hints || '(empty)'
  ].join('\n');
}

function buildLocalFallbackVisionPrompt(
  pageNumber: number,
  _textLayerBlocks: ExtractedBlock[],
  mode:
    | 'full'
    | 'focused'
    | 'business_crop'
    | 'detail_crop'
    | 'right_panel_crop'
    | 'lower_panel_crop'
) {
  const areaHint =
    mode === 'business_crop'
      ? '这次图片是页面中部和右侧的业务区裁切。'
      : mode === 'detail_crop'
        ? '这次图片是页面下半区和右侧标签区域的细节裁切。'
        : mode === 'right_panel_crop'
          ? '这次图片是页面右侧标签和标识区域的裁切。'
          : mode === 'lower_panel_crop'
            ? '这次图片是页面下半区方案和工艺说明区域的裁切。'
      : mode === 'focused'
        ? '这次只看业务内容，不看页眉页脚和管理字段。'
        : '优先识别颜色、面料、主标/码标、刺绣、口袋、front/back、same as attachment sample 等业务句。';

  return [
    '你是服装工艺单 OCR 抽取器，只做识别，不做翻译。',
    `请识别第 ${pageNumber} 页的业务文字块。${areaHint}`,
    '忽略：设计师、买手、客户、版权、页码、日期、价格、数量、style/ERP。',
    '保留：颜色、面料、码标、主标、刺绣、口袋、front/back、with pocket/without pocket、reference sample、same as attachment、PROTO #1/#2、OP1/OP2、尺寸和版型说明。',
    '输出 JSON 数组，每项格式：{"pageNumber":1,"regionType":"label_cluster","text":"...","confidence":0.0,"bbox":{"x":0,"y":0,"w":0,"h":0}}',
    'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
    '尽量覆盖整页上下两组方案、颜色、面料、主标/码标、刺绣与结构批注。',
    '最多返回 24 条。',
    '不要参考文本层页眉或管理字段。'
  ].join('\n');
}

function extractBalancedJsonObjects(raw: string) {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const blocksIndex = normalized.indexOf('"blocks"');
  const arrayStart = blocksIndex >= 0 ? normalized.indexOf('[', blocksIndex) : normalized.indexOf('[');
  if (arrayStart < 0) {
    return [];
  }

  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\\\') {
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

    if (char === '{') {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && objectStart >= 0) {
          objects.push(normalized.slice(objectStart, index + 1));
          objectStart = -1;
        }
      }
    }
  }

  return objects;
}

function parsePlainTextBlocks(
  raw: string,
  options?: {
    fallbackPageNumber?: number;
    regionIdPrefix?: string;
  }
) {
  const prefix = options?.regionIdPrefix ?? 'vision';
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/\r/g, '')
    .trim();
  if (!normalized || /^[\[{]/.test(normalized)) {
    return [] as ExtractedBlock[];
  }

  const parts = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3)
    .filter((line) => !/^page\s+\d+$/i.test(line))
    .filter((line) => !/^blocks?[:：]?$/i.test(line))
    .slice(0, 28);

  return parts.map((text, index) => ({
    pageNumber: Number(options?.fallbackPageNumber ?? 1),
    regionId: `${prefix}_${index + 1}`,
    regionType: 'label_cluster' as const,
    text,
    confidence: 0.45,
    sourceType: 'vision' as const
  }));
}

function safeParseQwenBlocks(
  raw: string,
  options?: {
    fallbackPageNumber?: number;
    regionIdPrefix?: string;
    forcePageNumber?: boolean;
    forceRegionIdPrefix?: boolean;
  }
): ExtractedBlock[] {
  type VisionOnlyBlock = Omit<ExtractedBlock, 'sourceType'> & { sourceType: 'vision' };
  function normalizeRegionType(value: unknown): ExtractedBlock['regionType'] | null {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      return null;
    }
    if (
      normalized === 'label_cluster' ||
      normalized === 'paragraph_block' ||
      normalized === 'table_block' ||
      normalized === 'reference_block'
    ) {
      return normalized as ExtractedBlock['regionType'];
    }
    if (/color|label|logo|spec|fabric_note|text_block/.test(normalized)) {
      return 'label_cluster';
    }
    if (/fabric|material/.test(normalized)) {
      return 'paragraph_block';
    }
    if (/reference/.test(normalized)) {
      return 'reference_block';
    }
    return 'paragraph_block';
  }

  try {
    const normalized = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const json = JSON.parse(normalized) as
      | {
          blocks?: Array<Partial<ExtractedBlock> & { pageNumber?: number; regionId?: string }>;
        }
      | Array<Partial<ExtractedBlock> & { pageNumber?: number; regionId?: string }>;
    const blocks = Array.isArray(json) ? json : (json.blocks ?? []);
    const prefix = options?.regionIdPrefix ?? 'vision';
    const parsedBlocks: VisionOnlyBlock[] = [];
    for (const [index, item] of blocks.entries()) {
      const regionType = normalizeRegionType(item.regionType);
      if (!item.text || !regionType) {
        continue;
      }
      parsedBlocks.push({
        pageNumber: Number(
          options?.forcePageNumber
            ? options?.fallbackPageNumber ?? 1
            : item.pageNumber ?? options?.fallbackPageNumber ?? 1
        ),
        regionId: String(
          options?.forceRegionIdPrefix
            ? `${prefix}_${index + 1}`
            : item.regionId ?? `${prefix}_${index + 1}`
        ),
        regionType,
        text: String(item.text),
        confidence: Number(item.confidence ?? 0.8),
        sourceType: 'vision' as const,
        bbox: item.bbox
      });
    }
    return parsedBlocks;
  } catch {
    const prefix = options?.regionIdPrefix ?? 'vision';
    const recovered = extractBalancedJsonObjects(raw)
      .map((item, index) => {
        try {
          const parsed = JSON.parse(item) as Partial<ExtractedBlock> & {
            pageNumber?: number;
            regionId?: string;
          };
          const regionType = normalizeRegionType(parsed.regionType);
          if (!parsed.text || !regionType) {
            return null;
          }
          const block: VisionOnlyBlock = {
            pageNumber: Number(
              options?.forcePageNumber
                ? options?.fallbackPageNumber ?? 1
                : parsed.pageNumber ?? options?.fallbackPageNumber ?? 1
            ),
            regionId: String(
              options?.forceRegionIdPrefix
                ? `${prefix}_${index + 1}`
                : parsed.regionId ?? `${prefix}_${index + 1}`
            ),
            regionType,
            text: String(parsed.text),
            confidence: Number(parsed.confidence ?? 0.8),
            sourceType: 'vision' as const,
            bbox: parsed.bbox
          };
          return block;
        } catch {
          return null;
        }
      })
      .filter((item): item is VisionOnlyBlock => item !== null);
    if (recovered.length > 0) {
      return recovered;
    }
    return parsePlainTextBlocks(raw, options);
  }
}

/**
 * Qwen-based auxiliary provider for P1:
 * - only used when caller explicitly triggers for low-confidence pages/regions
 * - returns conservative text hints as vision blocks (no whole-document translation)
 */
export function createQwenVisionProvider(): VisionExtractionProvider {
  return async (input: VisionExtractionInput) => {
    const fallbackConfig = getVisionFallbackRuntimeConfig();
    if (!isVisionModelConfigured() && !fallbackConfig) {
      return {
        blocks: input.textLayerBlocks ?? [],
        fallbackUsed: true,
        provider: undefined,
        modelExecuted: false,
        fallbackProviderUsed: false,
        pageBlockCounts: []
      };
    }

    const targetPages = Array.from(
      new Set(
        (input.targetPages ?? []).filter((pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0)
      )
    ).sort((a, b) => a - b);

    if (targetPages.length > 0) {
      const mergedBlocks = [...(input.textLayerBlocks ?? [])];
      const existingKeys = new Set(
        mergedBlocks.map((block) => `${block.pageNumber}:${normalizeBlockText(block.text)}`)
      );
      let novelVisionBlockCount = 0;
      let modelExecuted = false;
      let fallbackProviderUsed = false;
      let activeProvider = isVisionModelConfigured() ? getVisionModelName() : undefined;
      const pageBlockCounts: Array<{ pageNumber: number; blockCount: number }> = [];
      const pageRawBlockCounts: Array<{ pageNumber: number; blockCount: number }> = [];
      const pageErrors: NonNullable<VisionExtractionResult['pageErrors']> = [];

      async function callPageWithConfig(
        pageNumber: number,
        pageBlocks: ExtractedBlock[],
        runtimeConfigOverride?: ModelRuntimeConfig,
        focused = false,
        cropMode:
          | 'full'
          | 'business_crop'
          | 'detail_crop'
          | 'right_panel_crop'
          | 'lower_panel_crop' = 'full'
      ) {
        const mode:
          | 'full'
          | 'focused'
          | 'business_crop'
          | 'detail_crop'
          | 'right_panel_crop'
          | 'lower_panel_crop' =
          cropMode === 'business_crop'
            ? 'business_crop'
            : cropMode === 'detail_crop'
              ? 'detail_crop'
              : cropMode === 'right_panel_crop'
                ? 'right_panel_crop'
                : cropMode === 'lower_panel_crop'
                  ? 'lower_panel_crop'
              : focused
                ? 'focused'
                : 'full';
        const useLocalFallbackProfile = Boolean(runtimeConfigOverride && isLocalRuntimeConfig(runtimeConfigOverride));
        const promptText = useLocalFallbackProfile
          ? buildLocalFallbackVisionPrompt(pageNumber, pageBlocks, mode)
          : focused
            ? buildFocusedPageVisionPrompt(pageNumber, pageBlocks)
            : buildPageVisionPrompt(pageNumber, pageBlocks);
        const dataUrl =
          cropMode === 'business_crop'
            ? await renderPdfPageCropToDataUrl(input.filePath, pageNumber, {
                x: 0.06,
                y: 0.12,
                w: 0.88,
                h: 0.8
              })
            : cropMode === 'detail_crop'
              ? await renderPdfPageCropToDataUrl(input.filePath, pageNumber, {
                  x: 0.2,
                  y: 0.22,
                  w: 0.72,
                  h: 0.66
                })
              : cropMode === 'right_panel_crop'
                ? await renderPdfPageCropToDataUrl(input.filePath, pageNumber, {
                    x: 0.67,
                    y: 0.12,
                    w: 0.28,
                    h: 0.74
                  })
                : cropMode === 'lower_panel_crop'
                  ? await renderPdfPageCropToDataUrl(input.filePath, pageNumber, {
                      x: 0.32,
                      y: 0.38,
                      w: 0.6,
                      h: 0.56
                    })
            : await renderPdfPageToDataUrl(input.filePath, pageNumber);
        const result = await callVisionModelChat({
          runtimeConfigOverride,
          messages: [
            {
              role: 'system',
              content: 'You are a garment tech pack OCR assistant. Return JSON only.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: promptText
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl
                  }
                }
              ]
            }
          ],
          temperature: useLocalFallbackProfile ? 0 : 0.1,
          maxTokens: useLocalFallbackProfile
            ? cropMode === 'business_crop' ||
              cropMode === 'detail_crop' ||
              cropMode === 'right_panel_crop' ||
              cropMode === 'lower_panel_crop' ||
              focused
              ? 2200
              : 1800
            : 2600
        });

        const parsed = safeParseQwenBlocks(result.text, {
          fallbackPageNumber: pageNumber,
          regionIdPrefix: `vision_p${pageNumber}_${mode}`,
          forcePageNumber: true,
          forceRegionIdPrefix: true
        });
        if (parsed.length === 0) {
          throw new Error(`vision page ${pageNumber} returned no parsable blocks`);
        }
        return parsed;
      }

      for (const pageNumber of targetPages) {
        const pageBlocks = (input.textLayerBlocks ?? []).filter(
          (block) => block.pageNumber === pageNumber
        );
        let parsedForPage: ExtractedBlock[] = [];
        for (let attempt = 0; attempt <= VISION_PAGE_RETRY_LIMIT; attempt += 1) {
          try {
            const primaryPlans = [
              { focused: false, cropMode: 'full' as const },
              { focused: true, cropMode: 'full' as const },
              { focused: true, cropMode: 'business_crop' as const },
              { focused: true, cropMode: 'detail_crop' as const },
              { focused: true, cropMode: 'right_panel_crop' as const },
              { focused: true, cropMode: 'lower_panel_crop' as const }
            ];
            let filteredPageBlocks: ExtractedBlock[] = [];
            for (const plan of primaryPlans) {
              try {
                parsedForPage = await callPageWithConfig(
                  pageNumber,
                  pageBlocks,
                  undefined,
                  plan.focused,
                  plan.cropMode
                );
                modelExecuted = true;
                activeProvider = getVisionModelName();
                pageRawBlockCounts.push({ pageNumber, blockCount: parsedForPage.length });
                const planBlocks = filterVisionBlocks(parsedForPage, pageBlocks);
                if (planBlocks.length > 0) {
                  filteredPageBlocks = dedupeBlocks([...filteredPageBlocks, ...planBlocks]);
                }
                if (filteredPageBlocks.length > 0) {
                  break;
                }
              } catch (error) {
                pageErrors.push({
                  pageNumber,
                  stage: 'primary',
                  mode: plan.cropMode === 'business_crop' ? 'business_crop' : plan.focused ? 'focused' : 'full',
                  error: error instanceof Error ? error.message : 'primary full-page vision request failed'
                });
                if (isNonRetryableVisionError(error)) {
                  break;
                }
              }
            }
            pageBlockCounts.push({ pageNumber, blockCount: filteredPageBlocks.length });
            for (const block of filteredPageBlocks) {
              const key = `${block.pageNumber}:${normalizeBlockText(block.text)}`;
              if (!existingKeys.has(key)) {
                novelVisionBlockCount += 1;
                existingKeys.add(key);
              }
              mergedBlocks.push(block);
            }
            break;
          } catch (error) {
            pageErrors.push({
              pageNumber,
              stage: 'primary',
              mode: 'full',
              error: error instanceof Error ? error.message : 'primary full-page vision request failed'
            });
            if (attempt >= VISION_PAGE_RETRY_LIMIT || isNonRetryableVisionError(error)) {
              break;
            }
            await delay(VISION_PAGE_RETRY_DELAY_MS);
          }
        }
        if (parsedForPage.length === 0 && fallbackConfig) {
          const preferBusinessCropFirst =
            isLocalRuntimeConfig(fallbackConfig) && shouldPrioritizeBusinessCrop(pageBlocks);
          const fallbackPlan = preferBusinessCropFirst
            ? ([
              { focused: true, cropMode: 'business_crop' as const },
              { focused: true, cropMode: 'full' as const },
              { focused: true, cropMode: 'detail_crop' as const },
              { focused: true, cropMode: 'right_panel_crop' as const },
              { focused: true, cropMode: 'lower_panel_crop' as const },
              { focused: false, cropMode: 'full' as const }
            ] as const)
            : ([
              { focused: false, cropMode: 'full' as const },
              { focused: true, cropMode: 'full' as const },
              { focused: true, cropMode: 'business_crop' as const },
              { focused: true, cropMode: 'detail_crop' as const },
              { focused: true, cropMode: 'right_panel_crop' as const },
              { focused: true, cropMode: 'lower_panel_crop' as const }
            ] as const);
          for (let attempt = 0; attempt <= VISION_PAGE_RETRY_LIMIT; attempt += 1) {
            try {
              let filteredPageBlocks: ExtractedBlock[] = [];
              const aggregatedPageBlocks: ExtractedBlock[] = [];
              for (const plan of fallbackPlan) {
                try {
                  parsedForPage = await callPageWithConfig(
                    pageNumber,
                    pageBlocks,
                    fallbackConfig,
                    plan.focused,
                    plan.cropMode
                  );
                  modelExecuted = true;
                  fallbackProviderUsed = true;
                  activeProvider = getVisionModelName(fallbackConfig);
                  pageRawBlockCounts.push({ pageNumber, blockCount: parsedForPage.length });
                  const planBlocks = filterVisionBlocks(parsedForPage, pageBlocks);
                  if (planBlocks.length > 0) {
                    aggregatedPageBlocks.push(...planBlocks);
                    filteredPageBlocks = dedupeBlocks(aggregatedPageBlocks);
                  }
                } catch (error) {
                  pageErrors.push({
                    pageNumber,
                    stage: 'fallback',
                    mode: plan.cropMode === 'business_crop' ? 'business_crop' : plan.focused ? 'focused' : 'full',
                    error: error instanceof Error ? error.message : 'fallback full-page vision request failed'
                  });
                  if (isNonRetryableVisionError(error)) {
                    break;
                  }
                }
              }
              pageBlockCounts.push({ pageNumber, blockCount: filteredPageBlocks.length });
              for (const block of filteredPageBlocks) {
                const key = `${block.pageNumber}:${normalizeBlockText(block.text)}`;
                if (!existingKeys.has(key)) {
                  novelVisionBlockCount += 1;
                  existingKeys.add(key);
                }
                mergedBlocks.push(block);
              }
              break;
            } catch (error) {
              pageErrors.push({
                pageNumber,
                stage: 'fallback',
                mode: 'full',
                error: error instanceof Error ? error.message : 'fallback full-page vision request failed'
              });
              if (attempt >= VISION_PAGE_RETRY_LIMIT || isNonRetryableVisionError(error)) {
                break;
              }
              await delay(VISION_PAGE_RETRY_DELAY_MS);
            }
          }
        }
      }

      return {
        blocks: dedupeBlocks(mergedBlocks),
        fallbackUsed: novelVisionBlockCount === 0,
        provider: activeProvider,
        modelExecuted,
        fallbackProviderUsed,
        pageBlockCounts,
        pageRawBlockCounts,
        pageErrors
      };
    }

    const preview = (input.textLayerBlocks ?? [])
      .slice(0, 12)
      .map(
        (block, index) =>
          `${index + 1}. [p${block.pageNumber}/${block.regionType}] ${block.text.slice(0, 120)}`
      )
      .join('\n');
    const prompt = [
      '你是抽取辅助识别器。请对低置信文本块给出纠偏建议，不做翻译。',
      '输出 JSON：{"blocks":[{"pageNumber":1,"regionId":"...","regionType":"paragraph_block","text":"...","confidence":0.0}]}',
      'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
      '没有把握时，保持原文本。',
      '',
      '输入块：',
      preview || '(empty)'
    ].join('\n');

    let parsed: ExtractedBlock[] = [];
    let modelExecuted = false;
    let fallbackProviderUsed = false;
    let activeProvider = isVisionModelConfigured() ? getVisionModelName() : undefined;
    try {
      const result = await callVisionModelChat({
        messages: [
          { role: 'system', content: 'You are a PDF extraction correction assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        maxTokens: 1200
      });
      parsed = safeParseQwenBlocks(result.text, {
        regionIdPrefix: 'vision_hint'
      });
      modelExecuted = parsed.length > 0;
    } catch {
      parsed = [];
    }
    if (parsed.length === 0 && fallbackConfig) {
      try {
        const result = await callVisionModelChat({
          runtimeConfigOverride: fallbackConfig,
          messages: [
            { role: 'system', content: 'You are a PDF extraction correction assistant.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          maxTokens: 1200
        });
        parsed = safeParseQwenBlocks(result.text, {
          regionIdPrefix: 'vision_hint'
        });
        modelExecuted = parsed.length > 0;
        fallbackProviderUsed = parsed.length > 0;
        activeProvider = getVisionModelName(fallbackConfig);
      } catch {
        parsed = [];
      }
    }
    return {
      blocks: parsed.length > 0 ? dedupeBlocks(parsed) : (input.textLayerBlocks ?? []),
      fallbackUsed: parsed.length === 0,
      provider: activeProvider,
      modelExecuted,
      fallbackProviderUsed,
      pageBlockCounts: [],
      pageRawBlockCounts: [],
      pageErrors: []
    };
  };
}

/**
 * Phase 1: Fallback only. Pass-through text_layer blocks, no real vision call.
 */
export async function extractWithVisionFallback(
  input: VisionExtractionInput,
  provider?: VisionExtractionProvider | null
): Promise<VisionExtractionResult> {
  if (provider) {
    return provider(input);
  }

  if (input.textLayerBlocks && input.textLayerBlocks.length > 0) {
    return {
      blocks: input.textLayerBlocks,
      fallbackUsed: true,
      provider: undefined,
      modelExecuted: false,
      fallbackProviderUsed: false,
      pageBlockCounts: [],
      pageRawBlockCounts: [],
      pageErrors: []
    };
  }

  return {
    blocks: [],
    fallbackUsed: true,
    provider: undefined,
    modelExecuted: false,
    fallbackProviderUsed: false,
    pageBlockCounts: [],
    pageRawBlockCounts: [],
    pageErrors: []
  };
}
