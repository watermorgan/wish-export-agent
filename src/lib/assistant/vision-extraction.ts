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
  getVisionModelName,
  isVisionModelConfigured
} from '@/lib/assistant/qwen-client';

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

function delay(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    '若同一页存在多条短标签，必须尽量逐条拆开输出，不要把左右两列、上下相邻或不同部位的小标签合并成一句。',
    '特别注意：尺码标、主标/吊牌、拉链型号/颜色、里布、罗纹、反光、热压、暗磁、袋口、门襟、袖口/下摆高度等短标签也属于高价值信息。',
    '忽略重复页头、品牌 logo、款号、页码、版权声明、编辑日期、纯装饰标题。',
    '如果文本层提示里缺少页面上的额外批注，仍然要把这些额外内容输出。',
    '不要凭空猜测看不清的字，看不清就跳过。',
    '输出 JSON：{"blocks":[{"pageNumber":1,"regionType":"label_cluster","text":"...","confidence":0.0,"bbox":{"x":0,"y":0,"w":0,"h":0}}]}',
    'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
    'bbox 必填，使用页面归一化坐标系：左上角为原点，x/y/w/h 取值 0-1000。',
    'bbox 只需近似覆盖该批注文字本身，不需要覆盖整块版面。',
    '如果一条 OCR 结果里混入多个独立事项，请拆成多条 blocks。',
    '保持输出简洁，优先短标签；最多返回 28 个最有业务价值的 blocks。',
    '',
    '当前文本层提示（可能不完整）：',
    hints || '(empty)'
  ].join('\n');
}

function extractBalancedJsonObjects(raw: string) {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const blocksIndex = normalized.indexOf('"blocks"');
  if (blocksIndex < 0) {
    return [];
  }
  const arrayStart = normalized.indexOf('[', blocksIndex);
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

function safeParseQwenBlocks(
  raw: string,
  options?: {
    fallbackPageNumber?: number;
    regionIdPrefix?: string;
  }
): ExtractedBlock[] {
  type VisionOnlyBlock = Omit<ExtractedBlock, 'sourceType'> & { sourceType: 'vision' };

  try {
    const normalized = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const json = JSON.parse(normalized) as {
      blocks?: Array<Partial<ExtractedBlock> & { pageNumber?: number; regionId?: string }>;
    };
    const blocks = json.blocks ?? [];
    const prefix = options?.regionIdPrefix ?? 'vision';
    return blocks
      .filter((item) => item.text && item.regionType)
      .map((item, index) => ({
        pageNumber: Number(item.pageNumber ?? options?.fallbackPageNumber ?? 1),
        regionId: String(item.regionId ?? `${prefix}_${index + 1}`),
        regionType: item.regionType as ExtractedBlock['regionType'],
        text: String(item.text),
        confidence: Number(item.confidence ?? 0.8),
        sourceType: 'vision' as const,
        bbox: item.bbox
      }));
  } catch {
    const prefix = options?.regionIdPrefix ?? 'vision';
    return extractBalancedJsonObjects(raw)
      .map((item, index) => {
        try {
          const parsed = JSON.parse(item) as Partial<ExtractedBlock> & {
            pageNumber?: number;
            regionId?: string;
          };
          if (!parsed.text || !parsed.regionType) {
            return null;
          }
          const block: VisionOnlyBlock = {
            pageNumber: Number(parsed.pageNumber ?? options?.fallbackPageNumber ?? 1),
            regionId: String(parsed.regionId ?? `${prefix}_${index + 1}`),
            regionType: parsed.regionType as ExtractedBlock['regionType'],
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
  }
}

/**
 * Qwen-based auxiliary provider for P1:
 * - only used when caller explicitly triggers for low-confidence pages/regions
 * - returns conservative text hints as vision blocks (no whole-document translation)
 */
export function createQwenVisionProvider(): VisionExtractionProvider {
  return async (input: VisionExtractionInput) => {
    if (!isVisionModelConfigured()) {
      return {
        blocks: input.textLayerBlocks ?? [],
        fallbackUsed: true,
        provider: undefined
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

      for (const pageNumber of targetPages) {
        for (let attempt = 0; attempt <= VISION_PAGE_RETRY_LIMIT; attempt += 1) {
          try {
            const dataUrl = await renderPdfPageToDataUrl(input.filePath, pageNumber);
            const pageBlocks = (input.textLayerBlocks ?? []).filter(
              (block) => block.pageNumber === pageNumber
            );
            const result = await callVisionModelChat({
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
                      text: buildPageVisionPrompt(pageNumber, pageBlocks)
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
              temperature: 0.1,
              maxTokens: 2600
            });

            const parsed = safeParseQwenBlocks(result.text, {
              fallbackPageNumber: pageNumber,
              regionIdPrefix: `vision_p${pageNumber}`
            });
            if (parsed.length === 0) {
              throw new Error(`vision page ${pageNumber} returned no parsable blocks`);
            }
            for (const block of parsed) {
              const key = `${block.pageNumber}:${normalizeBlockText(block.text)}`;
              if (!existingKeys.has(key)) {
                novelVisionBlockCount += 1;
                existingKeys.add(key);
              }
              mergedBlocks.push(block);
            }
            break;
          } catch {
            if (attempt >= VISION_PAGE_RETRY_LIMIT) {
              break;
            }
            await delay(VISION_PAGE_RETRY_DELAY_MS);
          }
        }
      }

      return {
        blocks: dedupeBlocks(mergedBlocks),
        fallbackUsed: novelVisionBlockCount === 0,
        provider: getVisionModelName()
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

    const result = await callVisionModelChat({
      messages: [
        { role: 'system', content: 'You are a PDF extraction correction assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 1200
    });

    const parsed = safeParseQwenBlocks(result.text, {
      regionIdPrefix: 'vision_hint'
    });
    return {
      blocks: parsed.length > 0 ? dedupeBlocks(parsed) : (input.textLayerBlocks ?? []),
      fallbackUsed: parsed.length === 0,
      provider: getVisionModelName()
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
      provider: undefined
    };
  }

  return {
    blocks: [],
    fallbackUsed: true,
    provider: undefined
  };
}
