/**
 * DEPRECATED: This file is no longer used and is replaced by the generalized 
 * sequential orchestration loop in execution.ts.
 * Mark for deletion in next cleanup cycle.
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  buildFeedbackSourceReference,
  type FeedbackSourceSection,
  type FeedbackSourceReference
} from '@/lib/assistant/feedback-source';
import { buildExtractedPdfResultFromText, extractPdfTextFromPath } from '@/lib/assistant/file-extractor';
import { generateWithAvailableProvider } from '@/lib/assistant/llm/router';
import { loadSkillPrompt } from '@/lib/assistant/prompt-loader';
import {
  runPdfTranslationPipeline,
  type TranslationSnapshot
} from '@/lib/assistant/translation-pipeline';
import type {
  ArtifactField,
  ArtifactSection,
  AssistantReply,
  AssistantReplyMetadata,
  AssistantRequest,
  HumanReviewGuide,
  PdfTranslationSkillPayload,
  PendingConfirmation,
  UploadedFile
} from '@/lib/assistant/types';

type TranslationSegment = {
  source: string;
  translation: string;
};

type TranslationSection = {
  id: string;
  title: string;
  summary?: string;
  segments: TranslationSegment[];
};

type TranslationModelResponse = {
  summary: string;
  sections: TranslationSection[];
  terms?: string[];
  pendingItems?: Array<{
    label: string;
    reason: string;
  }>;
};

type SectionTranslationModelResponse = {
  summary?: string;
  segmentTranslations: Array<{
    id: string;
    translation: string;
  }>;
  terms?: string[];
  pendingItems?: Array<{
    label: string;
    reason: string;
  }>;
};

type TranslationTimingStage = NonNullable<AssistantReplyMetadata['translationTiming']>['stages'][number];

type TranslationRunTiming = {
  totalMs: number;
  sourceBuildMs?: number;
  renderPrepMs?: number;
  stages: TranslationTimingStage[];
};

type GoldenSection = {
  id: string;
  title: string;
  summary?: string;
  segments: TranslationSegment[];
};

type GoldenTranslationReference = {
  caseId: string;
  sourceFile: string;
  title?: string;
  outputMode?: string;
  sections: GoldenSection[];
};

const SECTION_CHUNK_SIZE = Number(process.env.FEEDBACK_SECTION_CHUNK_SIZE || 12);
const SECTION_CHUNK_CONCURRENCY = Number(process.env.FEEDBACK_SECTION_CHUNK_CONCURRENCY || 3);

const COMMERCIAL_PENDING_RULES = [
  {
    label: '价格待确认',
    reason: '原文涉及价格、报价或成本信息，需人工确认后才能作为正式承诺。',
    patterns: [/\bprice\b/i, /\bpricing\b/i, /\bcost\b/i, /\bquote\b/i, /\bquotation\b/i, /\busd\b/i, /\beur\b/i, /\brmb\b/i]
  },
  {
    label: '交期待确认',
    reason: '原文涉及交期、出货或时间安排，需人工确认后再进入正式对外口径。',
    patterns: [/\blead time\b/i, /\bdelivery\b/i, /\bship(?:ping|ment)?\b/i, /\betd\b/i, /\beta\b/i, /\bdeadline\b/i]
  },
  {
    label: '认证待确认',
    reason: '原文涉及认证、测试或合规信息，需人工确认后再对外使用。',
    patterns: [/\bcert(?:ification|ified)?\b/i, /\btest report\b/i, /\bcompliance\b/i, /\boeko\b/i, /\bgots\b/i, /\bbv\b/i, /\bsgs\b/i]
  },
  {
    label: '付款条件待确认',
    reason: '原文涉及付款条款或结算方式，需人工确认后才能形成正式商务口径。',
    patterns: [/\bpayment\b/i, /\btt\b/i, /\bt\/t\b/i, /\blc\b/i, /\bl\/c\b/i, /\bdeposit\b/i]
  },
  {
    label: '物流待确认',
    reason: '原文涉及运输、港口或物流安排，需人工确认后再对外承诺。',
    patterns: [/\blogistics\b/i, /\bfreight\b/i, /\bport\b/i, /\bforwarder\b/i, /\bincoterm/i, /\bexw\b/i, /\bfob\b/i, /\bcif\b/i]
  }
] as const;

const UNCERTAIN_PATTERNS = [
  /无法确定/,
  /待确认/,
  /not sure/i,
  /unable to confirm/i,
  /to be confirmed/i,
  /unknown/i
];

function toGoldenReference(
  file: UploadedFile,
  title: string,
  sections: TranslationSection[]
): GoldenTranslationReference {
  return {
    caseId: 'runtime-generated',
    sourceFile: file.name,
    title,
    outputMode: 'bilingual_sections',
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      summary: section.summary,
      segments: section.segments
    }))
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildBilingualHtml(sections: TranslationSection[]) {
  return sections
    .map(
      (section) => `<section class="fixture-section">
  <header class="fixture-section-header">
    <h3>${escapeHtml(section.title)}</h3>
    ${section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ''}
  </header>
  <div class="fixture-segment-list">
    ${section.segments
      .map(
        (segment) => `<div class="bilingual-block">
  <p class="source-line">${escapeHtml(segment.source)}</p>
  <p class="translation-line">${escapeHtml(segment.translation)}</p>
</div>`
      )
      .join('\n')}
  </div>
</section>`
    )
    .join('\n');
}

function buildStructuredFixtureHtml(reference: GoldenTranslationReference) {
  return reference.sections
    .map(
      (section) => `<section class="fixture-section">
  <header class="fixture-section-header">
    <h3>${escapeHtml(section.title)}</h3>
    ${section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ''}
  </header>
  <div class="fixture-segment-list">
    ${section.segments
      .map(
        (segment) => `<div class="bilingual-block">
      <p class="source-line">${escapeHtml(segment.source)}</p>
      <p class="translation-line">${escapeHtml(segment.translation)}</p>
    </div>`
      )
      .join('\n')}
  </div>
</section>`
    )
    .join('\n');
}

function toTranslationSnapshot(reference: GoldenTranslationReference): TranslationSnapshot {
  const generatedAt = new Date().toISOString();
  const items = reference.sections.flatMap((section, sectionIndex) =>
    section.segments.map((segment, segmentIndex) => ({
      id: `${section.id}_${sectionIndex + 1}_${segmentIndex + 1}`,
      pageNumber: sectionIndex + 1,
      regionId: `${section.id}_${sectionIndex + 1}`,
      en: segment.source,
      zh: segment.translation,
      renderMode: 'inline' as const,
      sourceType: 'golden-fixture',
      confidence: 1
    }))
  );

  return {
    version: 'translation_snapshot_v1',
    generatedAt,
    fileName: reference.sourceFile,
    documentMainType: 'mixed',
    outputStrategy: 'annotated_pdf',
    diagnostics: {
      translatedSegmentCount: items.length,
      translationCoveragePct: 100,
      aModelExecuted: false,
      bModelExecuted: false
    },
    items
  };
}

function highlightChineseInline(value: string) {
  let result = '';

  for (const char of value) {
    const escaped = escapeHtml(char);
    if (/[\u3400-\u9fff]/.test(char)) {
      result += `<span class="translation-inline">${escaped}</span>`;
    } else {
      result += escaped;
    }
  }

  return result;
}

function buildFixtureHtml(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) => `<div class="bilingual-block fixture-block">
  <p class="fixture-line">${highlightChineseInline(line)}</p>
</div>`
    )
    .join('\n');
}

function pickSourceFile(files: UploadedFile[]) {
  return [...files]
    .filter(
      (file) =>
        (file.contentText && file.contentText.trim().length > 0) ||
        (file.name.toLowerCase().endsWith('.pdf') && (file.storagePath || file.localPath))
    )
    .sort((left, right) => {
      const leftPdfScore =
        left.name.toLowerCase().endsWith('.pdf') && (left.storagePath || left.localPath) ? 1 : 0;
      const rightPdfScore =
        right.name.toLowerCase().endsWith('.pdf') && (right.storagePath || right.localPath) ? 1 : 0;
      if (leftPdfScore !== rightPdfScore) {
        return rightPdfScore - leftPdfScore;
      }
      return (right.contentText?.length ?? 0) - (left.contentText?.length ?? 0);
    })[0];
}

function buildUserPrompt(
  file: UploadedFile,
  request: AssistantRequest,
  sourceReference: FeedbackSourceReference
) {
  return [
    '请根据以下规则完成翻译，只输出 JSON，不要输出 Markdown 代码块。',
    '',
    'JSON schema:',
    '{',
    '  "summary": "string",',
    '  "sections": [{"id":"string","title":"string","summary":"string","segments":[{"source":"string","translation":"string"}]}],',
    '  "terms": ["string"],',
    '  "pendingItems": [{"label":"string","reason":"string"}]',
    '}',
    '',
    '输出要求：',
    '1. 保留英文原文。',
    '2. 为每条英文原文补对应中文翻译。',
    '3. 不要归并，不要改写成结论，不要删掉关键术语。',
    '4. 如果没有价格、交期、认证、付款、物流，则 pendingItems 返回空数组。',
    '5. 必须沿用给定的 section id 和 section title，不要新增或删除 section。',
    '6. 每个 section 内按给定 source segment 的粒度输出，不要把整页压成一段。',
    '',
    `任务说明：${request.question}`,
    `文件名：${file.name}`,
    '',
    '结构化原始内容：',
    JSON.stringify(sourceReference, null, 2)
  ].join('\n');
}

function buildSectionUserPrompt(
  file: UploadedFile,
  request: AssistantRequest,
  section: FeedbackSourceSection
) {
  return [
    '请完成当前 section 的逐条翻译，只输出 JSON，不要输出 Markdown 代码块。',
    '',
    'JSON schema:',
    '{',
    '  "summary": "string",',
    '  "segmentTranslations": [{"id":"string","translation":"string"}],',
    '  "terms": ["string"],',
    '  "pendingItems": [{"label":"string","reason":"string"}]',
    '}',
    '',
    '输出要求：',
    '1. 只翻译，不归并，不总结成结论。',
    '2. 必须严格沿用给定 segment id。',
    '3. 不要返回 source 字段，英文原文由系统本地保留。',
    '4. 保留服装/工艺语境，不要把动作方向翻译反。',
    '5. 若涉及价格、交期、认证、付款、物流，必须放入 pendingItems；若无则返回空数组。',
    '6. 中文翻译要简洁可读，适合样衣和业务直接对照复核。',
    '',
    `任务说明：${request.question}`,
    `文件名：${file.name}`,
    `Section: ${section.title} (${section.id})`,
    '',
    '当前 section 原文：',
    JSON.stringify(section, null, 2)
  ].join('\n');
}

function safeParseModelResponse(raw: string): TranslationModelResponse {
  const sanitized = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(sanitized) as TranslationModelResponse;
  const normalizedSections =
    Array.isArray(parsed.sections) && parsed.sections.length > 0
      ? parsed.sections
          .map((section) => ({
            id: section.id?.trim(),
            title: section.title?.trim(),
            summary: section.summary?.trim(),
            segments: Array.isArray(section.segments)
              ? section.segments
                  .map((segment) => ({
                    source: segment.source?.trim(),
                    translation: segment.translation?.trim()
                  }))
                  .filter((segment) => segment.source && segment.translation)
              : []
          }))
          .filter((section) => section.id && section.title && section.segments.length > 0)
      : [];

  if (normalizedSections.length === 0) {
    throw new Error('模型未返回有效的双语分段。');
  }

  return {
    summary: parsed.summary?.trim() || '已完成原文保留式双语翻译。',
    sections: normalizedSections,
    terms: Array.isArray(parsed.terms) ? parsed.terms.filter(Boolean) : [],
    pendingItems: Array.isArray(parsed.pendingItems)
      ? parsed.pendingItems.filter((item) => item?.label && item?.reason)
      : []
  };
}

function normalizeModelTranslation(value: string) {
  const trimmed = value.trim();
  const translatedMatch = trimmed.match(/\[译文\]\s*([\s\S]*)$/);
  if (translatedMatch) {
    return translatedMatch[1].trim();
  }

  if (trimmed.includes('->')) {
    const right = trimmed.split('->').at(-1)?.replace(/\[译文\]/g, '').trim();
    if (right) {
      return right;
    }
  }

  return trimmed;
}

function safeParseSectionModelResponse(
  raw: string,
  section: FeedbackSourceSection
): SectionTranslationModelResponse {
  const sanitized = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(sanitized) as SectionTranslationModelResponse;
  const sourceIds = new Set(section.segments.map((segment) => segment.id));
  const segmentTranslations = Array.isArray(parsed.segmentTranslations)
    ? parsed.segmentTranslations
        .map((item) => ({
          id: item.id?.trim(),
          translation: item.translation ? normalizeModelTranslation(item.translation) : undefined
        }))
        .filter(
          (item): item is { id: string; translation: string } =>
            Boolean(item.id && item.translation && sourceIds.has(item.id))
        )
    : [];

  if (segmentTranslations.length === 0) {
    throw new Error(`模型未返回有效的 section 翻译：${section.id}`);
  }

  if (segmentTranslations.length !== section.segments.length) {
    const returnedIds = new Set(segmentTranslations.map((item) => item.id));
    const missingIds = section.segments
      .map((item) => item.id)
      .filter((segmentId) => !returnedIds.has(segmentId));
    if (missingIds.length > 0) {
      throw new Error(`section ${section.id} 缺少 segment 翻译：${missingIds.join(', ')}`);
    }
  }

  return {
    summary: parsed.summary?.trim(),
    segmentTranslations,
    terms: Array.isArray(parsed.terms) ? parsed.terms.filter(Boolean) : [],
    pendingItems: Array.isArray(parsed.pendingItems)
      ? parsed.pendingItems.filter((item) => item?.label && item?.reason)
      : []
  };
}

function chunkFeedbackSection(section: FeedbackSourceSection) {
  if (section.segments.length <= SECTION_CHUNK_SIZE) {
    return [section];
  }

  const chunks: FeedbackSourceSection[] = [];
  for (let start = 0; start < section.segments.length; start += SECTION_CHUNK_SIZE) {
    const index = Math.floor(start / SECTION_CHUNK_SIZE) + 1;
    chunks.push({
      id: `${section.id}__chunk_${index}`,
      title: `${section.title} · Part ${index}`,
      segments: section.segments.slice(start, start + SECTION_CHUNK_SIZE),
      pageLayoutType: section.pageLayoutType
    });
  }

  return chunks;
}

async function translateSectionsWithProvider(
  sourceFile: UploadedFile,
  request: AssistantRequest,
  sourceReference: FeedbackSourceReference,
  systemPrompt: string
) {
  const translationStartedAt = Date.now();
  const translatedSections: TranslationSection[] = [];
  const terms = new Set<string>();
  const pendingItems: Array<{ label: string; reason: string }> = [];
  const providerHits: string[] = [];
  const modelHits: string[] = [];
  const stages: TranslationTimingStage[] = [];

  for (const section of sourceReference.sections) {
    const sectionStartedAt = Date.now();
    const chunkResults: SectionTranslationModelResponse[] = [];
    const translationMap = new Map<string, string>();
    const chunkSections = chunkFeedbackSection(section);
    const sectionProviders = new Set<string>();

    for (let index = 0; index < chunkSections.length; index += SECTION_CHUNK_CONCURRENCY) {
      const batch = chunkSections.slice(index, index + SECTION_CHUNK_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (chunk) => ({
          chunk,
          attempt: await translateChunkWithProvider(
            sourceFile,
            request,
            systemPrompt,
            section,
            chunk
          )
        }))
      );

      for (const result of batchResults) {
        chunkResults.push(result.attempt.parsed);
        for (const item of result.attempt.parsed.segmentTranslations) {
          translationMap.set(item.id, item.translation);
        }

        for (const term of result.attempt.parsed.terms ?? []) {
          terms.add(term);
        }

        for (const item of result.attempt.parsed.pendingItems ?? []) {
          pendingItems.push(item);
        }

        providerHits.push(...result.attempt.providerHits);
        modelHits.push(...result.attempt.modelHits);
        for (const provider of result.attempt.providers) {
          sectionProviders.add(provider);
        }
      }
    }

    translatedSections.push({
      id: section.id,
      title: section.title,
      summary:
        chunkResults
          .map((item) => item.summary?.trim())
          .filter(Boolean)
          .join(' ')
          .trim() || undefined,
      segments: section.segments.map((segment) => ({
        source: segment.text,
        translation: translationMap.get(segment.id) ?? ''
      }))
    });

    stages.push({
      id: section.id,
      label: `${section.title} 翻译`,
      durationMs: Date.now() - sectionStartedAt,
      chunkCount: chunkSections.length,
      provider: Array.from(sectionProviders).join(', ')
    });
  }

  return {
    summary: `已完成 ${translatedSections.length} 个章节的原文保留式双语翻译。`,
    sections: translatedSections,
    terms: [...terms],
    pendingItems,
    providerHits,
    modelHits,
    timing: {
      totalMs: Date.now() - translationStartedAt,
      stages
    }
  };
}

type ChunkTranslationAttempt = {
  parsed: SectionTranslationModelResponse;
  providerHits: string[];
  modelHits: string[];
  providers: string[];
};

async function translateChunkWithProvider(
  sourceFile: UploadedFile,
  request: AssistantRequest,
  systemPrompt: string,
  parentSection: FeedbackSourceSection,
  chunk: FeedbackSourceSection
): Promise<ChunkTranslationAttempt> {
  try {
    const providerResult = await generateWithAvailableProvider({
      system: systemPrompt,
      user: buildSectionUserPrompt(sourceFile, request, chunk),
      timeoutMs: 90000,
      modelOverride: request.modelOverride
    });

    return {
      parsed: safeParseSectionModelResponse(providerResult.text, chunk),
      providerHits: [
        chunk.id === parentSection.id
          ? `${parentSection.id}:${providerResult.provider}`
          : `${parentSection.id}:${chunk.id}:${providerResult.provider}`
      ],
      modelHits: [
        chunk.id === parentSection.id
          ? `${parentSection.id}:${providerResult.model ?? request.modelOverride ?? 'default'}`
          : `${parentSection.id}:${chunk.id}:${providerResult.model ?? request.modelOverride ?? 'default'}`
      ],
      providers: [providerResult.provider]
    };
  } catch (error) {
    if (chunk.segments.length <= 1) {
      throw error;
    }

    const midpoint = Math.ceil(chunk.segments.length / 2);
    const leftChunk: FeedbackSourceSection = {
      ...chunk,
      id: `${chunk.id}__split_1`,
      title: `${chunk.title} · Split 1`,
      segments: chunk.segments.slice(0, midpoint)
    };
    const rightChunk: FeedbackSourceSection = {
      ...chunk,
      id: `${chunk.id}__split_2`,
      title: `${chunk.title} · Split 2`,
      segments: chunk.segments.slice(midpoint)
    };

    const left = await translateChunkWithProvider(
      sourceFile,
      request,
      systemPrompt,
      parentSection,
      leftChunk
    );
    const right = await translateChunkWithProvider(
      sourceFile,
      request,
      systemPrompt,
      parentSection,
      rightChunk
    );

    return {
      parsed: {
        summary: [left.parsed.summary, right.parsed.summary].filter(Boolean).join(' ').trim() || undefined,
        segmentTranslations: [
          ...left.parsed.segmentTranslations,
          ...right.parsed.segmentTranslations
        ],
        terms: [...(left.parsed.terms ?? []), ...(right.parsed.terms ?? [])],
        pendingItems: [
          ...(left.parsed.pendingItems ?? []),
          ...(right.parsed.pendingItems ?? [])
        ]
      },
      providerHits: [...left.providerHits, ...right.providerHits],
      modelHits: [...left.modelHits, ...right.modelHits],
      providers: [...left.providers, ...right.providers]
    };
  }
}

function buildArtifacts(
  file: UploadedFile,
  result: TranslationModelResponse
): ArtifactSection[] {
  const segmentCount = result.sections.reduce(
    (count, section) => count + section.segments.length,
    0
  );
  const bilingualField: ArtifactField = {
    label: '双语对照输出',
    value: `已生成 ${result.sections.length} 个章节、${segmentCount} 条英中对照内容。`,
    citation: file.name,
    richTextHtml: buildBilingualHtml(result.sections),
    structuredData: toGoldenReference(file, '原文保留式双语翻译', result.sections)
  };

  const fields: ArtifactField[] = [bilingualField];

  if (result.terms && result.terms.length > 0) {
    fields.push({
      label: '术语提示',
      value: result.terms.join(' / '),
      citation: file.name
    });
  }

  return [
    {
      title: '原文保留式双语翻译',
      kind: 'text',
      summary: '保留英文原文，在其下方追加中文翻译，供样衣与业务沟通使用。',
      fields
    }
  ];
}

function collectCombinedText(result: TranslationModelResponse) {
  return result.sections
    .flatMap((section) => section.segments.flatMap((segment) => [segment.source, segment.translation]))
    .join('\n');
}

function inferRuleBasedPendingItems(result: TranslationModelResponse) {
  const combinedText = collectCombinedText(result);
  const inferred: Array<{ label: string; reason: string }> = COMMERCIAL_PENDING_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(combinedText))
  ).map((rule) => ({
    label: rule.label,
    reason: rule.reason
  }));

  if (UNCERTAIN_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    inferred.push({
      label: '内容待人工确认',
      reason: '模型输出中包含“无法确定/待确认”类表达，需人工复核后再继续。'
    });
  }

  return inferred;
}

function normalizePendingKey(label: string, reason: string) {
  const combined = `${label} ${reason}`;

  if (/price|价格|quote|报价|cost|成本/i.test(combined)) {
    return 'commercial:price';
  }

  if (/delivery|lead time|交期|交货期|ship|shipment|etd|eta/i.test(combined)) {
    return 'commercial:delivery';
  }

  if (/cert|认证|test report|compliance|oeko|gots|sgs|bv/i.test(combined)) {
    return 'commercial:certification';
  }

  if (/payment|付款|tt|t\/t|lc|l\/c|deposit/i.test(combined)) {
    return 'commercial:payment';
  }

  if (/logistics|物流|freight|port|forwarder|incoterm|fob|cif|exw/i.test(combined)) {
    return 'commercial:logistics';
  }

  if (/无法确定|待确认|not sure|unable to confirm|to be confirmed|unknown/i.test(combined)) {
    return 'generic:uncertain';
  }

  return `${label}::${reason}`;
}

function buildPendingItems(result: TranslationModelResponse): PendingConfirmation[] {
  const seen = new Set<string>();

  return [...(result.pendingItems ?? []), ...inferRuleBasedPendingItems(result)]
    .filter((item) => {
      const key = normalizePendingKey(item.label, item.reason);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((item, index) => ({
      id: `feedback-pending-${index + 1}`,
      label: item.label,
      reason: item.reason,
      owner: 'sales',
      status: 'required'
    }));
}

function buildReplyMetadata(
  pendingConfirmations: PendingConfirmation[],
  providerHits: string[],
  modelHits: string[],
  translationMode: AssistantReplyMetadata['translationMode']
): AssistantReplyMetadata {
  return {
    needsHumanReview: pendingConfirmations.some((item) => item.status !== 'confirmed'),
    providerHits,
    modelHits,
    activeProvider: providerHits.at(-1),
    activeModel: modelHits.at(-1),
    translationMode
  };
}

function buildArtifactUrl(relativePath: string | null | undefined) {
  if (!relativePath) {
    return null;
  }

  return `/api/assistant/artifacts?path=${encodeURIComponent(relativePath)}`;
}

function buildPipelineRichTextHtml(
  annotated: NonNullable<Awaited<ReturnType<typeof runPdfTranslationPipeline>>['outputs']['annotatedPdf']>
) {
  const grouped = new Map<number, typeof annotated.items>();

  for (const item of annotated.items) {
    const bucket = grouped.get(item.pageNumber) ?? [];
    bucket.push(item);
    grouped.set(item.pageNumber, bucket);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, items]) => {
      const blocks = items
        .map((item) => {
          const zh = item.zh?.trim();
          return `<div class="bilingual-block">
  <p class="source-line">${escapeHtml(item.en)}</p>
  <p class="translation-line">${escapeHtml(zh && zh.length > 0 ? zh : '[待人工补译]')}</p>
</div>`;
        })
        .join('\n');

      return `<section class="fixture-section">
  <header class="fixture-section-header">
    <h3>Page ${pageNumber}</h3>
    <p>${items.length} 个识别块</p>
  </header>
  <div class="fixture-segment-list">
    ${blocks}
  </div>
</section>`;
    })
    .join('\n');
}

function buildPipelineSnapshot(
  annotated: NonNullable<Awaited<ReturnType<typeof runPdfTranslationPipeline>>['outputs']['annotatedPdf']>
): TranslationSnapshot {
  return annotated.snapshot;
}

function buildPipelinePendingItems(
  pipelineResult: Awaited<ReturnType<typeof runPdfTranslationPipeline>>
) {
  const joined = pipelineResult.segments
    .map((segment) => `${segment.text} ${segment.zh ?? ''}`)
    .join('\n');
  const items: PendingConfirmation[] = [];

  if (/EN ATTENTE|待确认|等待确认|待定/i.test(joined)) {
    items.push({
      id: 'pipeline-pending-status',
      label: '生产状态待定',
      reason: '识别结果中存在待定/等待确认状态，需人工确认后再继续推进样衣或生产。',
      owner: 'sales',
      status: 'required'
    });
  }

  if (
    pipelineResult.diagnostics.translationCoveragePct <
    pipelineResult.diagnostics.businessPreviewThresholdPct
  ) {
    items.push({
      id: 'pipeline-pending-coverage',
      label: '识别与翻译覆盖待复核',
      reason: `当前覆盖率 ${pipelineResult.diagnostics.translationCoveragePct}% 低于业务预览门槛 ${pipelineResult.diagnostics.businessPreviewThresholdPct}%，需人工复核遗漏区域。`,
      owner: 'sales',
      status: 'required'
    });
  }

  return items;
}

type ReviewRule = {
  id: string;
  title: string;
  reason: string;
  priority: 'high' | 'medium';
  patterns: RegExp[];
};

const PDF_REVIEW_RULES: ReviewRule[] = [
  {
    id: 'labels-and-variants',
    title: '核对方案标签、主标与码标',
    reason: 'OP1/OP2、PROTO、主标、码标、刺绣字样属于高误伤信息，建议对照原图人工确认。',
    priority: 'high',
    patterns: [
      /\b(op\s*#?\d+|proto\s*#?\d+)\b/i,
      /\b(size label|main label|logo label|new logo label|neck label|hangtag)\b/i,
      /\b(embroidery|embroidered|logo)\b/i
    ]
  },
  {
    id: 'colors-and-fabric',
    title: '核对颜色、顺色与主辅面料',
    reason: '颜色名、顺色要求以及主辅面料经常直接影响打样，不能只看摘要。',
    priority: 'high',
    patterns: [
      /\b(noir|ecru|donuts|ecr)\b/i,
      /\b(matching color|same color|self color|tone on tone|color with)\b/i,
      /\b(shell fabric|lining|pocketing|fabric|rib|jersey|fleece|cotton|polyester)\b/i
    ]
  },
  {
    id: 'pocket-and-closure',
    title: '核对口袋、拉链与闭合工艺',
    reason: '袋型、拉链、按扣、魔术贴和门襟类工艺很容易影响工厂执行，建议逐页核对。',
    priority: 'high',
    patterns: [
      /\b(pocket|zip|zipper|snap|button|velcro|placket|opening|binding)\b/i,
      /\b(tape|seam|piped pocket|hidden pocket)\b/i
    ]
  },
  {
    id: 'construction-and-fit',
    title: '核对结构与版型说明',
    reason: 'same front/back、construction、fit、pleat、dart 等结构语句需要确认没有漏掉条件和方向。',
    priority: 'medium',
    patterns: [
      /\b(same front|same back|construction|fit|fitting|pleat|dart|waistband)\b/i,
      /\b(collar|cuff|belt|inside design|binding finishing)\b/i
    ]
  }
];

function normalizeReviewText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function isLikelyBusinessReviewText(text: string) {
  const normalized = normalizeReviewText(text);
  if (normalized.length < 6) return false;
  if (
    /\b(all rights reserved|style sheet|edited on|copyright|avertissement|warning:|menswear|womenswear)\b/i.test(
      normalized
    )
  ) {
    return false;
  }
  if (/^[A-Z0-9\s:/#.+-]+$/.test(normalized) && normalized.length < 10) {
    return false;
  }
  return /[a-z]{3,}/i.test(normalized) || /[#/]/.test(normalized);
}

function buildHumanReviewGuide(
  pipelineResult: Awaited<ReturnType<typeof runPdfTranslationPipeline>>
): HumanReviewGuide | undefined {
  const focusPages = new Set<number>();
  const hints: HumanReviewGuide['hints'] = [];
  const pageRiskScore = new Map<number, number>();

  const addPageRisk = (pageNumber: number, score = 1) => {
    if (!pageNumber || !Number.isFinite(pageNumber)) {
      return;
    }
    focusPages.add(pageNumber);
    pageRiskScore.set(pageNumber, (pageRiskScore.get(pageNumber) ?? 0) + score);
  };

  for (const rule of PDF_REVIEW_RULES) {
    const matchedSegments = pipelineResult.segments.filter((segment) =>
      isLikelyBusinessReviewText(segment.text) &&
      rule.patterns.some((pattern) => pattern.test(segment.text))
    );

    if (matchedSegments.length === 0) {
      continue;
    }

    const pageNumbers = Array.from(
      new Set(matchedSegments.map((segment) => segment.pageNumber))
    ).sort((left, right) => left - right);
    for (const pageNumber of pageNumbers) {
      addPageRisk(pageNumber, rule.priority === 'high' ? 3 : 2);
    }

    const examples = Array.from(
      new Set(
        matchedSegments
          .map((segment) => normalizeReviewText(segment.text))
          .filter(Boolean)
          .slice(0, 3)
      )
    ).slice(0, 2);

    hints.push({
      id: rule.id,
      title: rule.title,
      reason: rule.reason,
      priority: rule.priority,
      pageNumbers,
      examples
    });
  }

  const untranslatedPages = Array.from(
    pipelineResult.segments.reduce((pages, segment) => {
      if (!segment.zh?.trim() && isLikelyBusinessReviewText(segment.text)) {
        pages.add(segment.pageNumber);
      }
      return pages;
    }, new Set<number>())
  ).sort((left, right) => left - right);

  if (!pipelineResult.diagnostics.isBusinessPreviewReady || untranslatedPages.length > 0) {
    for (const pageNumber of untranslatedPages) {
      addPageRisk(pageNumber, 4);
    }

    hints.unshift({
      id: 'coverage-check',
      title: '优先复核覆盖率不足页',
      reason:
        pipelineResult.diagnostics.previewSuppressedReason === 'no_business_translations'
          ? '当前译出内容主要是页眉或管理信息，建议先确认这些页是否还有关键业务批注漏掉。'
          : `当前业务预览覆盖率 ${pipelineResult.diagnostics.businessTranslationCoveragePct ?? pipelineResult.diagnostics.translationCoveragePct}% ，建议先看有未译业务句的页面。`,
      priority: 'high',
      pageNumbers: untranslatedPages.slice(0, 4),
      examples: untranslatedPages.length > 0 ? ['先核对这些页的关键批注是否已出中文。'] : undefined
    });
  }

  const sortedFocusPages = Array.from(focusPages)
    .sort((left, right) => (pageRiskScore.get(right) ?? 0) - (pageRiskScore.get(left) ?? 0))
    .slice(0, 4);

  if (sortedFocusPages.length === 0 && hints.length === 0) {
    return undefined;
  }

  return {
    summary:
      sortedFocusPages.length > 0
        ? `建议先人工复核第 ${sortedFocusPages.join('、')} 页，再决定是否直接给工厂使用。`
        : '当前结果可直接预览，但仍建议人工抽检关键业务条目。',
    focusPages: sortedFocusPages,
    suggestedAction: '先打开预览页，优先核对高风险页上的颜色、标类、口袋与结构说明。',
    hints: hints.slice(0, 5)
  };
}

function buildPdfTranslationSkillPayload(options: {
  sourceFile: UploadedFile;
  pipelineResult: Awaited<ReturnType<typeof runPdfTranslationPipeline>>;
  summary: string;
  pipelineModelName: string;
  pdfArtifactLinks: NonNullable<AssistantReplyMetadata['pdfArtifactLinks']>;
  humanReviewGuide?: HumanReviewGuide;
}): PdfTranslationSkillPayload {
  const { sourceFile, pipelineResult, summary, pipelineModelName, pdfArtifactLinks, humanReviewGuide } =
    options;
  const snapshot = pipelineResult.outputs.annotatedPdf?.snapshot;

  return {
    kind: 'pdf_translation_skill_v1',
    fileName: sourceFile.name,
    taskType: 'feedback',
    documentMainType: pipelineResult.documentMainType,
    outputStrategy: pipelineResult.outputStrategy,
    summary,
    reviewRequired: true,
    artifactLinks: pdfArtifactLinks,
    humanReviewGuide,
    snapshot: snapshot
      ? {
          version: snapshot.version,
          fileName: snapshot.fileName,
          documentMainType: snapshot.documentMainType,
          outputStrategy: snapshot.outputStrategy,
          generatedAt: snapshot.generatedAt
        }
      : undefined,
    diagnostics: {
      translatedSegmentCount: pipelineResult.diagnostics.translatedSegmentCount,
      translationCoveragePct: pipelineResult.diagnostics.translationCoveragePct,
      businessSegmentCount: pipelineResult.diagnostics.businessSegmentCount,
      translatedBusinessSegmentCount: pipelineResult.diagnostics.translatedBusinessSegmentCount,
      businessTranslationCoveragePct: pipelineResult.diagnostics.businessTranslationCoveragePct,
      businessPreviewReady: pipelineResult.diagnostics.isBusinessPreviewReady,
      activeModel: pipelineModelName,
      activeProvider: 'pdf-pipeline'
    }
  };
}

async function buildPipelineFallbackReply(
  request: AssistantRequest,
  reply: AssistantReply,
  sourceFile: UploadedFile,
  sourceBuildMs: number,
  startedAt: number,
  mode: 'fallback' | 'primary' = 'fallback'
): Promise<AssistantReply | null> {
  const filePath = sourceFile.storagePath ?? sourceFile.localPath;

  if (!filePath || !sourceFile.name.toLowerCase().endsWith('.pdf')) {
    return null;
  }

  const pipelineResult = await runPdfTranslationPipeline({
    filePath,
    fileName: sourceFile.name,
    translationModelOverride: request.translationModelOverride ?? request.modelOverride
  });

  const pdfArtifactLinks = [];

  if (pipelineResult.outputs.annotatedPdf) {
    pdfArtifactLinks.push({
      fileName: pipelineResult.fileName,
      documentMainType: pipelineResult.documentMainType,
      outputStrategy: pipelineResult.outputStrategy,
      primary: 'annotated_preview' as const,
      bilingualXlsxUrl: null,
      annotatedPreviewUrl: buildArtifactUrl(
        pipelineResult.outputs.annotatedPdf.downloadable?.relativePath
      ),
      tableStylePdfUrl: null
    });
  }

  if (pipelineResult.outputs.bilingualTableBundle) {
    pdfArtifactLinks.push({
      fileName: pipelineResult.fileName,
      documentMainType: pipelineResult.documentMainType,
      outputStrategy: pipelineResult.outputStrategy,
      primary: 'bilingual_xlsx' as const,
      bilingualXlsxUrl: buildArtifactUrl(
        pipelineResult.outputs.bilingualTableBundle.downloadable?.relativePath
      ),
      annotatedPreviewUrl: null,
      tableStylePdfUrl: buildArtifactUrl(
        pipelineResult.outputs.bilingualTableBundle.downloadableTableStylePdf?.relativePath
      )
    });
  }

  const pendingConfirmations = buildPipelinePendingItems(pipelineResult);
  const humanReviewGuide = buildHumanReviewGuide(pipelineResult);
  const coverageText = `已译 ${pipelineResult.diagnostics.translatedSegmentCount}/${pipelineResult.segments.length} 段（覆盖率 ${pipelineResult.diagnostics.translationCoveragePct}%）`;
  const pipelineModelName =
    pipelineResult.diagnostics.bModelActiveModel ??
    request.translationModelOverride ??
    request.modelOverride ??
    process.env.TRANSLATION_MODEL ??
    'translation-model';
  const pipelineFallbackHints = [
    ...(reply.metadata?.pipelineFallbackHints ?? []),
    ...(pipelineResult.diagnostics.aModelFallbackUsed
      ? [`主 A 未稳定产出 OCR，当前任务已切换备用 A：${pipelineResult.diagnostics.aModelActiveModel ?? 'fallback-a'}`]
      : []),
    ...(pipelineResult.diagnostics.bModelFallbackUsed
      ? [`主 B 未稳定产出中文，当前任务已切换备用 B：${pipelineModelName}`]
      : []),
    ...(pipelineResult.diagnostics.bModelLastErrorKind !== 'none'
      ? [`最近一次 B 错误：${pipelineResult.diagnostics.bModelLastErrorKind}`]
      : [])
  ];
  const nextSummary = pipelineResult.diagnostics.translatedSegmentCount > 0
    ? mode === 'primary'
      ? `已完成 ${pipelineResult.diagnostics.translatedSegmentCount} 个识别块的原文保留式双语翻译。`
      : `意见翻译主链已降级到 PDF pipeline。${coverageText}。`
    : mode === 'primary'
      ? '当前 PDF pipeline 未产出可用中文结果。'
      : '意见翻译主链已降级到 PDF pipeline，但当前模型未产出可用中文结果。';

  const skillPayload = buildPdfTranslationSkillPayload({
    sourceFile,
    pipelineResult,
    summary: nextSummary,
    pipelineModelName,
    pdfArtifactLinks,
    humanReviewGuide
  });

  const fallbackField: ArtifactField = {
    label: 'PDF Pipeline 结果',
    value: nextSummary,
    citation: sourceFile.name,
    richTextHtml: pipelineResult.outputs.annotatedPdf
      ? buildPipelineRichTextHtml(pipelineResult.outputs.annotatedPdf)
      : undefined,
    structuredData: pipelineResult.outputs.annotatedPdf
      ? buildPipelineSnapshot(pipelineResult.outputs.annotatedPdf)
      : undefined
  };

  const fallbackArtifact: ArtifactSection = {
    title: '翻译产物入口',
    kind: 'list',
    summary: '当前页面已切换为 PDF pipeline 产物入口，可直接预览或下载。',
    fields: [fallbackField]
  };

  const skillArtifact: ArtifactSection = {
    title: 'Skill 输出协议',
    kind: 'list',
    summary: '供页面、后续 skill 和 OpenClaw 复用的稳定 PDF 翻译结果包。',
    fields: [
      {
        label: 'pdf_translation_skill_v1',
        value: '已生成稳定 skill 输出协议',
        citation: sourceFile.name,
        structuredData: skillPayload
      }
    ]
  };

  return {
    ...reply,
    status: pendingConfirmations.length > 0 ? 'pending_user_confirmation' : reply.status,
    statusLabel: pendingConfirmations.length > 0 ? '待人工确认' : reply.statusLabel,
    summary: nextSummary,
    draftDirection:
      mode === 'primary'
        ? '当前结果来自 PDF pipeline 主链路，优先用于图面批注/线稿类文档的识别与双语预览。'
        : '当前结果来自 PDF pipeline 降级链路，优先用于页面预览与单文档验证；如需高覆盖率，再继续优化翻译模型稳定性。',
    nextActions:
      pipelineResult.diagnostics.translatedSegmentCount > 0
        ? [
            '先打开预览页检查原文与中文位置关系。',
            '若覆盖率仍低，再继续调翻译模型和分段策略。'
          ]
        : [
            '当前主链没有拿到可用中文，建议先更换更稳定的翻译模型。',
            '保留本次 PDF pipeline 产物作为诊断样本。'
          ],
    pendingConfirmations,
    riskAlerts: pendingConfirmations.map((item) => `${item.label}：${item.reason}`),
    artifacts: [...reply.artifacts, fallbackArtifact, skillArtifact],
    auditTrail: [
      ...reply.auditTrail,
      {
        label: mode === 'primary' ? 'PDF pipeline 主链已执行' : '翻译主链已降级',
        detail:
          mode === 'primary'
            ? '检测到 PDF 意见翻译任务，已优先切换到 PDF pipeline 识别与翻译链路。'
            : 'comment-translator 实时翻译失败，已自动切换到 PDF pipeline 结果。'
      },
      {
        label: 'PDF pipeline 已执行',
        detail: `${coverageText} · 文档类型 ${pipelineResult.documentMainType} · 输出策略 ${pipelineResult.outputStrategy}。`
      }
    ],
    metadata: {
      ...(reply.metadata ?? {}),
      needsHumanReview: true,
      providerHits: [...(reply.metadata?.providerHits ?? []), 'pdf-pipeline'],
      modelHits: [
        ...(reply.metadata?.modelHits ?? []),
        pipelineModelName
      ],
      activeProvider: 'pdf-pipeline',
      activeModel: pipelineModelName,
      translationMode: 'real',
      pdfArtifactLinks,
      pipelineFallbackHints,
      humanReviewGuide,
      skillPayload,
      translationTiming: {
        totalMs: Date.now() - startedAt,
        sourceBuildMs,
        stages: [
          {
            id: mode === 'primary' ? 'pdf-pipeline-primary' : 'pdf-pipeline-fallback',
            label: mode === 'primary' ? 'PDF pipeline 主链路' : 'PDF pipeline 降级链路',
            durationMs: Date.now() - startedAt,
            provider: 'pdf-pipeline'
          }
        ]
      }
    }
  };
}

async function findGoldenFixture(sourceFileName: string) {
  const baseName = basename(sourceFileName, extname(sourceFileName));
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const normalizedBaseName = normalizeName(baseName);
  const normalizedSourceFileName = normalizeName(sourceFileName);
  const rootDir = join(process.cwd(), 'data', 'feedback-translation');
  const caseDirs = await readdir(rootDir, { withFileTypes: true });

  for (const entry of caseDirs) {
    if (!entry.isDirectory()) {
      continue;
    }

    const goldenDir = join(rootDir, entry.name, 'golden');
    try {
      const structuredPath = join(goldenDir, 'translation-reference.json');
      try {
        const structured = JSON.parse(
          await readFile(structuredPath, 'utf8')
        ) as GoldenTranslationReference;
        if (
          Array.isArray(structured.sections) &&
          (structured.sourceFile === sourceFileName ||
            normalizeName(structured.sourceFile) === normalizedSourceFileName)
        ) {
          return {
            kind: 'structured' as const,
            name: 'translation-reference.json',
            reference: structured
          };
        }
      } catch {
        // Fall back to PDF-based fixture.
      }

      const goldenFiles = await readdir(goldenDir, { withFileTypes: true });
      const matched = goldenFiles.find(
        (file) =>
          file.isFile() &&
          file.name.toLowerCase().endsWith('.pdf') &&
          (file.name.startsWith(baseName) || normalizeName(file.name) === normalizedBaseName)
      );

      if (matched) {
        const fullPath = join(goldenDir, matched.name);
        return {
          kind: 'pdf-text' as const,
          name: matched.name,
          text: await extractPdfTextFromPath(fullPath)
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function buildFixtureReply(
  reply: AssistantReply,
  sourceFile: UploadedFile
): Promise<AssistantReply> {
  const fixture = await findGoldenFixture(sourceFile.name);
  if (!fixture) {
    return reply;
  }

  if (fixture.kind === 'structured') {
    const snapshot = toTranslationSnapshot(fixture.reference);
    return {
      ...reply,
      summary: '当前未连通正式模型，已使用结构化人工标准答案生成业务预览。',
      draftDirection: '当前输出来自结构化 golden fixture，用于开发调试、页面验收和后续自动评测。',
      nextActions: [
        '当前可以按章节检查翻译粒度、术语一致性和页面分组展示。',
        '如果这份 JSON 结构确认可用，后续可以直接作为自动评测基准。'
      ],
      riskAlerts: [],
      pendingConfirmations: [],
      artifacts: [
        {
          title: fixture.reference.title ?? '结构化标准答案预览',
          kind: 'text' as const,
          summary: '已按业务章节组织标准答案，适合对照预览和自动评测。',
          fields: [
          {
            label: 'Golden Preview',
            value: `已加载 ${fixture.name}`,
            citation: fixture.name,
            richTextHtml: buildStructuredFixtureHtml(fixture.reference),
            structuredData: snapshot
          }
        ]
      }
      ],
      auditTrail: [
        ...reply.auditTrail,
        {
          label: '结构化标准答案已加载',
          detail: `模型不可用时，已回退到结构化标准答案“${fixture.name}”进行开发验证。`
        }
      ],
      metadata: {
        ...(reply.metadata ?? {}),
        needsHumanReview: false,
        providerHits: [],
        modelHits: [],
        translationMode: 'fixture' as const
      }
    };
  }

  return {
    ...reply,
    summary: '当前未连通正式模型，已使用本地人工标准答案生成双语参考输出。',
    draftDirection: '当前输出来自本地 golden fixture，用于开发调试和页面验证，不代表真实模型推理结果。',
    nextActions: [
      '当前可以继续校验双语排版、人工标准答案结构和页面展示。',
      '补齐正式模型端点或可用 API Key 后，再切回在线推理模式。'
    ],
    riskAlerts: [],
    pendingConfirmations: [],
    artifacts: [
      {
        title: '本地标准答案预览',
        kind: 'text' as const,
        summary: '已根据人工标准答案渲染双语参考输出，用于开发和验收对照。',
        fields: [
            {
              label: 'Golden Preview',
              value: `已加载 ${fixture.name}`,
              citation: fixture.name,
              richTextHtml: buildFixtureHtml(fixture.text)
            }
          ]
        }
    ],
    auditTrail: [
      ...reply.auditTrail,
      {
        label: '本地标准答案已加载',
        detail: `模型不可用时，已回退到人工标准答案“${fixture.name}”进行开发验证。`
      }
    ],
    metadata: {
      ...(reply.metadata ?? {}),
      needsHumanReview: false,
      providerHits: [],
      modelHits: [],
      translationMode: 'fixture' as const
    }
  };
}

export async function maybeRunRealFeedbackTranslation(
  request: AssistantRequest,
  reply: AssistantReply
): Promise<AssistantReply> {
  const startedAt = Date.now();
  const isFeedbackTask = reply.taskType === 'feedback';
  const hasTranslatorSkill = reply.selectedSkills.some((skill) => skill.id === 'comment-translator');
  const sourceFile = pickSourceFile(request.files);
  const sourceBuildStartedAt = Date.now();
  const isPdfFeedbackTask =
    isFeedbackTask &&
    hasTranslatorSkill &&
    sourceFile?.name.toLowerCase().endsWith('.pdf');
  const canRunPdfPipeline = Boolean(sourceFile && (sourceFile.storagePath || sourceFile.localPath));

  if (process.env.ASSISTANT_FORCE_GOLDEN === '1' && sourceFile) {
    const goldenReply = await buildFixtureReply(reply, sourceFile);
    if (goldenReply !== reply) {
      console.log(
        `[ASSISTANT_FORCE_GOLDEN] loaded fixture reply for ${sourceFile.name}`
      );
      return goldenReply;
    }
  }

  if (sourceFile && isPdfFeedbackTask && canRunPdfPipeline) {
    const pipelineReply = await buildPipelineFallbackReply(
      request,
      reply,
      sourceFile,
      Date.now() - sourceBuildStartedAt,
      startedAt,
      'primary'
    );
    if (pipelineReply) {
      return pipelineReply;
    }
  }

  if (sourceFile && isPdfFeedbackTask) {
    return {
      ...reply,
      status: 'failed',
      statusLabel: '执行失败',
      summary: '当前 PDF 翻译任务未拿到可执行的 pipeline 输入路径，未再回退到旧路由。',
      nextActions: ['补齐 PDF 本地路径或上传存储路径后重新执行。'],
      riskAlerts: ['当前已禁止 PDF 任务回退到旧的 router 翻译链，避免入口与正式产物不一致。'],
      auditTrail: [
        ...reply.auditTrail,
        {
          label: 'PDF pipeline 输入缺失',
          detail: '检测到 feedback PDF 任务，但未拿到 storagePath/localPath，因此未回退到旧路由。'
        }
      ],
      metadata: {
        ...(reply.metadata ?? {}),
        needsHumanReview: true,
        activeProvider: 'pdf-pipeline',
        activeModel: request.translationModelOverride ?? request.modelOverride ?? 'translation-model',
        translationMode: 'real'
      }
    };
  }

  const sourceExtracted = sourceFile ? buildExtractedPdfResultFromText(sourceFile.contentText ?? '') : null;
  const sourceReference =
    sourceFile && sourceExtracted
      ? buildFeedbackSourceReference(sourceExtracted, { name: sourceFile.name })
      : null;
  const sourceBuildMs = Date.now() - sourceBuildStartedAt;

  if (
    !isFeedbackTask ||
    !hasTranslatorSkill ||
    !sourceFile?.contentText ||
    !sourceReference
  ) {
    return reply;
  }

  if (process.env.ASSISTANT_FORCE_GOLDEN === '1') {
    return buildFixtureReply(reply, sourceFile);
  }

  const systemPrompt = loadSkillPrompt('comment-translator');
  if (!systemPrompt) {
    return reply;
  }

  let result: TranslationModelResponse;
  let providerHits: string[] = [];
  let modelHits: string[] = [];
  let timing: TranslationRunTiming | undefined;
  try {
    if (process.env.FEEDBACK_TRANSLATION_MODE === 'whole-document') {
      const wholeDocumentStartedAt = Date.now();
      const providerResult = await generateWithAvailableProvider({
        system: systemPrompt,
        user: buildUserPrompt(sourceFile, request, sourceReference),
        timeoutMs: 90000,
        modelOverride: request.modelOverride
      });
      const raw = providerResult.text;
      result = safeParseModelResponse(raw);
      providerHits = [providerResult.provider];
      modelHits = [providerResult.model ?? request.modelOverride ?? 'default'];
      timing = {
        totalMs: Date.now() - wholeDocumentStartedAt,
        sourceBuildMs,
        stages: [
          {
            id: 'whole-document',
            label: '整单翻译',
            durationMs: Date.now() - wholeDocumentStartedAt,
            provider: providerResult.provider
          }
        ]
      };
    } else {
      const translated = await translateSectionsWithProvider(
        sourceFile,
        request,
        sourceReference,
        systemPrompt
      );
      result = {
        summary: translated.summary,
        sections: translated.sections,
        terms: translated.terms,
        pendingItems: translated.pendingItems
      };
      providerHits = translated.providerHits;
      modelHits = translated.modelHits;
      timing = {
        totalMs: translated.timing.totalMs,
        sourceBuildMs,
        stages: translated.timing.stages
      };
    }
    reply = {
      ...reply,
      auditTrail: [
        ...reply.auditTrail,
        {
          label: '模型 provider 已命中',
          detail: `当前任务已使用 ${providerHits.join(', ')} 执行真实翻译，并基于结构化源数据分段输出。模型：${modelHits.join(', ')}`
        },
        ...(timing
          ? [
              {
                label: '翻译耗时已记录',
                detail: `源数据整理 ${timing.sourceBuildMs ?? 0} ms；模型翻译 ${timing.totalMs} ms；总耗时 ${Date.now() - startedAt} ms。`
              },
              ...timing.stages.map((stage) => ({
                label: `${stage.label} 已完成`,
                detail: `${stage.durationMs} ms${stage.chunkCount ? ` · ${stage.chunkCount} 个分块` : ''}${stage.provider ? ` · ${stage.provider}` : ''}`
              }))
            ]
          : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown translation error';
    console.warn('Real feedback translation failed.', error);
    try {
      const fallbackReply = await buildPipelineFallbackReply(
        request,
        reply,
        sourceFile,
        sourceBuildMs,
        startedAt
      );
      if (fallbackReply) {
        return fallbackReply;
      }
    } catch (fallbackError) {
      console.warn('PDF pipeline fallback failed.', fallbackError);
    }
    throw new Error(`意见翻译失败：${message}`);
  }
  const pendingConfirmations = buildPendingItems(result);
  const hasMergerSkill = reply.selectedSkills.some((skill) => skill.id === 'comment-merger');
  const translationMode =
    process.env.FEEDBACK_TRANSLATION_MODE === 'whole-document'
      ? ('whole-document' as const)
      : ('section-chunked' as const);
  const renderPrepStartedAt = Date.now();
  const artifacts = buildArtifacts(sourceFile, result);
  const renderPrepMs = Date.now() - renderPrepStartedAt;
  const totalMs = Date.now() - startedAt;
  const nextTiming: TranslationRunTiming = {
    totalMs,
    sourceBuildMs,
    renderPrepMs,
    stages: timing?.stages ?? []
  };

  return {
    ...reply,
    summary: result.summary,
    draftDirection: hasMergerSkill
      ? '当前已先完成保留原文的双语翻译，后续可在此基础上继续做主题归并；当前仍不包含自动对外承诺。'
      : '当前为保留原文的双语翻译稿，适合样衣修改沟通，不包含自动归并或对外承诺。',
    nextActions:
      pendingConfirmations.length > 0
        ? [
            '先处理模型识别出的待确认项，再决定是否进入下一轮样衣沟通。',
            '保持英文原文与中文译文并排回看，避免动作方向译错。'
          ]
        : hasMergerSkill
          ? [
              '当前已完成逐条翻译，可在确认术语后继续叠加主题归并。',
              '继续保留英文原文和中文译文映射，避免归并时丢失责任归属。'
            ]
        : [
            '先由业务和样衣同事快速复核术语译法，再进入下一轮销售样沟通。',
            '如果后续需要主题归并，再叠加 comment-merger 技能。'
          ],
    riskAlerts: pendingConfirmations.map((item) => `${item.label}：${item.reason}`),
    pendingConfirmations,
    blockingIssues: [],
    validationIssues: reply.validationIssues.filter((item) => item.severity !== 'blocking'),
    artifacts,
    auditTrail: [
      ...reply.auditTrail,
      {
        label: '真实翻译已执行',
        detail: `已基于文件“${sourceFile.name}”生成 ${result.sections.length} 个章节的英中双语对照。`
      },
      {
        label: '结果渲染已完成',
        detail: `结构化结果整理 ${renderPrepMs} ms；整链路总耗时 ${totalMs} ms。`
      }
    ],
    metadata: {
      ...buildReplyMetadata(pendingConfirmations, providerHits, modelHits, translationMode),
      translationTiming: nextTiming
    }
  };
}
