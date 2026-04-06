/**
 * Vision-assisted extraction interface layer.
 * Phase 1: Skeleton + fallback; structure ready for future OCR / multimodal provider.
 */
import { renderPdfPageToPng } from '@/lib/assistant/pdf-page-raster';
import {
  callQwenChat,
  callQwenChatWithContentParts,
  isQwenConfigured,
  type QwenChatContentPart
} from '@/lib/assistant/qwen-client';
import { getVisionMaxRenderSize } from '@/lib/assistant/vision-render-config';

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

/**
 * Qwen-based auxiliary provider for P1:
 * - only used when caller explicitly triggers for low-confidence pages/regions
 * - returns conservative text hints as vision blocks (no whole-document translation)
 */
function buildVisionAssistPrompt(preview: string) {
  return [
    '你是抽取辅助识别器。请对低置信文本块给出纠偏建议，不做翻译。',
    '输出 JSON：{"blocks":[{"pageNumber":1,"regionId":"...","regionType":"paragraph_block","text":"...","confidence":0.0}]}',
    'regionType 仅可用 label_cluster/paragraph_block/table_block/reference_block。',
    '没有把握时，保持原文本。',
    '',
    '输入块：',
    preview || '(empty)'
  ].join('\n');
}

async function runVisionAssistModel(
  prompt: string,
  input: VisionExtractionInput
): Promise<string> {
  const looksPdf =
    Boolean(input.mimeType?.includes('pdf')) || /\.pdf$/i.test(input.filePath ?? '');
  const multimodal =
    process.env.VISION_MULTIMODAL_ENABLED === '1' && looksPdf && Boolean(input.filePath);

  if (!multimodal) {
    const result = await callQwenChat({
      messages: [
        { role: 'system', content: 'You are a PDF extraction correction assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 1200
    });
    return result.text;
  }

  const blocks = input.textLayerBlocks ?? [];
  const maxPages = Math.min(
    Math.max(1, Number(process.env.VISION_MULTIMODAL_MAX_PAGES ?? '2')),
    6
  );
  const pages = [...new Set(blocks.map((b) => b.pageNumber))]
    .sort((a, b) => a - b)
    .slice(0, maxPages);

  const maxSide = getVisionMaxRenderSize();
  const parts: QwenChatContentPart[] = [{ type: 'text', text: prompt }];

  try {
    for (const page of pages) {
      const png = await renderPdfPageToPng(input.filePath!, page, maxSide);
      const b64 = png.toString('base64');
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` }
      });
    }
    const result = await callQwenChatWithContentParts({
      messages: [
        { role: 'system', content: 'You are a PDF extraction correction assistant.' },
        { role: 'user', content: parts }
      ],
      temperature: 0.1,
      maxTokens: 1200
    });
    return result.text;
  } catch {
    const result = await callQwenChat({
      messages: [
        { role: 'system', content: 'You are a PDF extraction correction assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 1200
    });
    return result.text;
  }
}

export function createQwenVisionProvider(): VisionExtractionProvider {
  return async (input: VisionExtractionInput) => {
    if (!isQwenConfigured()) {
      return {
        blocks: input.textLayerBlocks ?? [],
        fallbackUsed: true,
        provider: undefined
      };
    }

    const preview = (input.textLayerBlocks ?? [])
      .slice(0, 12)
      .map(
        (block, index) =>
          `${index + 1}. [p${block.pageNumber}/${block.regionType}] ${block.text.slice(0, 120)}`
      )
      .join('\n');
    const prompt = buildVisionAssistPrompt(preview);

    const rawText = await runVisionAssistModel(prompt, input);
    const parsed = safeParseQwenBlocks(rawText);
    return {
      blocks: parsed.length > 0 ? parsed : (input.textLayerBlocks ?? []),
      fallbackUsed: parsed.length === 0,
      provider: 'qwen3.5-35b-instruct'
    };
  };
}

function safeParseQwenBlocks(raw: string): ExtractedBlock[] {
  try {
    const normalized = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const json = JSON.parse(normalized) as { blocks?: Array<Partial<ExtractedBlock>> };
    const blocks = json.blocks ?? [];
    return blocks
      .filter((item) => item.pageNumber && item.regionId && item.regionType && item.text)
      .map((item) => ({
        pageNumber: Number(item.pageNumber),
        regionId: String(item.regionId),
        regionType: item.regionType as ExtractedBlock['regionType'],
        text: String(item.text),
        confidence: Number(item.confidence ?? 0.8),
        sourceType: 'vision' as const,
        bbox: item.bbox
      }));
  } catch {
    return [];
  }
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
