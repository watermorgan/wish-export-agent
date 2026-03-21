import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  buildFeedbackSourceReference,
  type FeedbackSourceSection,
  type FeedbackSourceReference
} from '@/lib/assistant/feedback-source';
import { extractPdfTextFromPath } from '@/lib/assistant/file-extractor';
import { generateWithAvailableProvider } from '@/lib/assistant/llm/router';
import { loadSkillPrompt } from '@/lib/assistant/prompt-loader';
import type {
  ArtifactField,
  ArtifactSection,
  AssistantReply,
  AssistantReplyMetadata,
  AssistantRequest,
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
    .filter((file) => file.contentText && file.contentText.trim().length > 0)
    .sort((left, right) => (right.contentText?.length ?? 0) - (left.contentText?.length ?? 0))[0];
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
      segments: section.segments.slice(start, start + SECTION_CHUNK_SIZE)
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
  const translatedSections: TranslationSection[] = [];
  const terms = new Set<string>();
  const pendingItems: Array<{ label: string; reason: string }> = [];
  const providerHits: string[] = [];

  for (const section of sourceReference.sections) {
    const chunkResults: SectionTranslationModelResponse[] = [];
    const translationMap = new Map<string, string>();
    const chunkSections = chunkFeedbackSection(section);

    for (let index = 0; index < chunkSections.length; index += SECTION_CHUNK_CONCURRENCY) {
      const batch = chunkSections.slice(index, index + SECTION_CHUNK_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          const providerResult = await generateWithAvailableProvider({
            system: systemPrompt,
            user: buildSectionUserPrompt(sourceFile, request, chunk),
            timeoutMs: 90000
          });

          return {
            chunk,
            provider: providerResult.provider,
            parsed: safeParseSectionModelResponse(providerResult.text, chunk)
          };
        })
      );

      for (const result of batchResults) {
        chunkResults.push(result.parsed);
        for (const item of result.parsed.segmentTranslations) {
          translationMap.set(item.id, item.translation);
        }

        for (const term of result.parsed.terms ?? []) {
          terms.add(term);
        }

        for (const item of result.parsed.pendingItems ?? []) {
          pendingItems.push(item);
        }

        providerHits.push(
          chunkSections.length > 1
            ? `${section.id}:${result.chunk.id}:${result.provider}`
            : `${section.id}:${result.provider}`
        );
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
  }

  return {
    summary: `已完成 ${translatedSections.length} 个章节的原文保留式双语翻译。`,
    sections: translatedSections,
    terms: [...terms],
    pendingItems,
    providerHits
  };
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
  translationMode: AssistantReplyMetadata['translationMode']
): AssistantReplyMetadata {
  return {
    needsHumanReview: pendingConfirmations.some((item) => item.status !== 'confirmed'),
    providerHits,
    translationMode
  };
}

async function findGoldenFixture(sourceFileName: string) {
  const baseName = basename(sourceFileName, extname(sourceFileName));
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
        if (structured.sourceFile === sourceFileName && Array.isArray(structured.sections)) {
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
          file.name.startsWith(baseName)
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
              structuredData: fixture.reference
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
      translationMode: 'fixture' as const
    }
  };
}

export async function maybeRunRealFeedbackTranslation(
  request: AssistantRequest,
  reply: AssistantReply
): Promise<AssistantReply> {
  const isFeedbackTask = reply.taskType === 'feedback';
  const hasTranslatorSkill = reply.selectedSkills.some((skill) => skill.id === 'comment-translator');
  const sourceFile = pickSourceFile(request.files);
  const sourceReference = sourceFile ? buildFeedbackSourceReference(sourceFile) : null;

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
  try {
    if (process.env.FEEDBACK_TRANSLATION_MODE === 'whole-document') {
      const providerResult = await generateWithAvailableProvider({
        system: systemPrompt,
        user: buildUserPrompt(sourceFile, request, sourceReference),
        timeoutMs: 90000
      });
      const raw = providerResult.text;
      result = safeParseModelResponse(raw);
      providerHits = [providerResult.provider];
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
    }
    reply = {
      ...reply,
      auditTrail: [
        ...reply.auditTrail,
        {
          label: '模型 provider 已命中',
          detail: `当前任务已使用 ${providerHits.join(', ')} 执行真实翻译，并基于结构化源数据分段输出。`
        }
      ]
    };
  } catch (error) {
    console.warn('Real feedback translation failed, falling back to local golden fixture.', error);
    return buildFixtureReply(reply, sourceFile);
  }
  const pendingConfirmations = buildPendingItems(result);
  const hasMergerSkill = reply.selectedSkills.some((skill) => skill.id === 'comment-merger');
  const translationMode =
    process.env.FEEDBACK_TRANSLATION_MODE === 'whole-document'
      ? ('whole-document' as const)
      : ('section-chunked' as const);

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
    artifacts: buildArtifacts(sourceFile, result),
    auditTrail: [
      ...reply.auditTrail,
      {
        label: '真实翻译已执行',
        detail: `已基于文件“${sourceFile.name}”生成 ${result.sections.length} 个章节的英中双语对照。`
      }
    ],
    metadata: buildReplyMetadata(pendingConfirmations, providerHits, translationMode)
  };
}
