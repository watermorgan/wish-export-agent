/**
 * Vision-assisted extraction interface layer.
 * Phase 1: Skeleton + fallback; structure ready for future OCR / multimodal provider.
 */
import {
  callVisionModelChat,
  getVisionModelName,
  isVisionModelConfigured
} from '@/lib/assistant/qwen-client';

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
export function createQwenVisionProvider(): VisionExtractionProvider {
  return async (input: VisionExtractionInput) => {
    if (!isVisionModelConfigured()) {
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

    const parsed = safeParseQwenBlocks(result.text);
    return {
      blocks: parsed.length > 0 ? parsed : (input.textLayerBlocks ?? []),
      fallbackUsed: parsed.length === 0,
      provider: getVisionModelName()
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
