import path from 'node:path';

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
  const outputs =
    outputStrategy === 'bilingual_table_bundle'
      ? {
          bilingualTableBundle: buildBilingualTableBundle(segments)
        }
      : {
          annotatedPdf: buildAnnotatedPdfOutput(segments)
        };

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
