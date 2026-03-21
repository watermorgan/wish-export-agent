import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , sourceReferenceArg, outputArg] = process.argv;

if (!sourceReferenceArg || !outputArg) {
  console.error('Usage: node --env-file=.env.local scripts/offline-feedback-translate.mjs <source-reference.json> <translator-response.json>');
  process.exit(1);
}

const sourceReferencePath = path.resolve(sourceReferenceArg);
const outputPath = path.resolve(outputArg);

const apiKey = process.env.MODELSCOPE_API_KEY;
const baseUrl =
  process.env.MODELSCOPE_API_URL || 'https://api-inference.modelscope.cn/v1/chat/completions';
const model = process.env.MODELSCOPE_MODEL || 'Qwen/Qwen3.5-35B-A3B';
const chunkSize = Number(process.env.FEEDBACK_OFFLINE_CHUNK_SIZE || 6);
const concurrency = Number(process.env.FEEDBACK_OFFLINE_CHUNK_CONCURRENCY || 1);
const timeoutMs = Number(process.env.FEEDBACK_OFFLINE_TIMEOUT_MS || 90000);
const maxRetries = Number(process.env.FEEDBACK_OFFLINE_MAX_RETRIES || 5);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (!apiKey) {
  console.error('MODELSCOPE_API_KEY missing');
  process.exit(1);
}

function sanitizeJson(raw) {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
}

function normalizeTranslation(value) {
  const trimmed = String(value || '').trim();
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildHtml(sections) {
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

async function generate(system, user) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        }),
        signal: controller.signal
      });

      if (response.status === 429 && attempt < maxRetries) {
        const waitMs = (attempt + 1) * 5000;
        console.warn(`rate limited, retrying in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${await response.text()}`);
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      const text = Array.isArray(content)
        ? content.map((item) => item.text || '').join('\n').trim()
        : String(content || '').trim();

      if (!text) {
        throw new Error('empty content');
      }

      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('generation failed after retries');
}

async function translateChunk(systemPrompt, sourceFile, chunk) {
  const raw = await generate(systemPrompt, buildChunkPrompt(sourceFile, chunk));
  const parsed = JSON.parse(sanitizeJson(raw));
  return { chunk, parsed };
}

async function translateChunkWithRetry(systemPrompt, sourceFile, chunk) {
  try {
    return await translateChunk(systemPrompt, sourceFile, chunk);
  } catch (error) {
    if (chunk.segments.length <= 1) {
      throw error;
    }

    const midpoint = Math.ceil(chunk.segments.length / 2);
    const leftChunk = {
      id: `${chunk.id}a`,
      title: `${chunk.title} A`,
      segments: chunk.segments.slice(0, midpoint)
    };
    const rightChunk = {
      id: `${chunk.id}b`,
      title: `${chunk.title} B`,
      segments: chunk.segments.slice(midpoint)
    };

    console.warn(
      `chunk split retry: ${chunk.id} (${chunk.segments.length}) -> ${leftChunk.segments.length} + ${rightChunk.segments.length}`
    );

    const left = await translateChunkWithRetry(systemPrompt, sourceFile, leftChunk);
    const right = await translateChunkWithRetry(systemPrompt, sourceFile, rightChunk);

    return {
      chunk,
      parsed: {
        summary: [left.parsed.summary, right.parsed.summary].filter(Boolean).join(' ').trim(),
        segmentTranslations: [
          ...(left.parsed.segmentTranslations || []),
          ...(right.parsed.segmentTranslations || [])
        ],
        terms: [...(left.parsed.terms || []), ...(right.parsed.terms || [])],
        pendingItems: [...(left.parsed.pendingItems || []), ...(right.parsed.pendingItems || [])]
      }
    };
  }
}

function buildChunkPrompt(sourceFile, chunk) {
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
    '任务说明：请保留英文原文，在每段下方增加中文翻译，仅做翻译，不做归并。',
    `文件名：${sourceFile}`,
    `Section: ${chunk.title} (${chunk.id})`,
    '',
    '当前 section 原文：',
    JSON.stringify(chunk, null, 2)
  ].join('\n');
}

function chunkSection(section) {
  const chunks = [];
  for (let index = 0; index < section.segments.length; index += chunkSize) {
    const part = Math.floor(index / chunkSize) + 1;
    chunks.push({
      id: `${section.id}__chunk_${part}`,
      title: `${section.title} · Part ${part}`,
      segments: section.segments.slice(index, index + chunkSize)
    });
  }

  return chunks;
}

const sourceReference = JSON.parse(await readFile(sourceReferencePath, 'utf8'));
const systemPrompt = await readFile(path.resolve('src/skills/comment-translator/prompt.md'), 'utf8');
const translatedSections = [];
const terms = new Set();
const pendingItems = [];

for (const section of sourceReference.sections) {
  const translationMap = new Map();
  const summaries = [];
  const chunks = chunkSection(section);

  for (let start = 0; start < chunks.length; start += concurrency) {
    const batch = chunks.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map((chunk) => translateChunkWithRetry(systemPrompt, sourceReference.sourceFile, chunk))
    );

    for (const { chunk, parsed } of results) {
      if (parsed.summary) {
        summaries.push(String(parsed.summary).trim());
      }

      for (const item of parsed.segmentTranslations || []) {
        if (item?.id && item?.translation) {
          translationMap.set(item.id, normalizeTranslation(item.translation));
        }
      }

      for (const term of parsed.terms || []) {
        if (term) {
          terms.add(String(term));
        }
      }

      for (const item of parsed.pendingItems || []) {
        if (item?.label && item?.reason) {
          pendingItems.push({ label: String(item.label), reason: String(item.reason) });
        }
      }

      console.log(`chunk done: ${chunk.id} (${chunk.segments.length})`);
    }
  }

  translatedSections.push({
    id: section.id,
    title: section.title,
    summary: summaries.join(' ').trim() || undefined,
    segments: section.segments.map((segment) => ({
      source: segment.text,
      translation: translationMap.get(segment.id) || ''
    }))
  });
}

const structuredData = {
  caseId: 'runtime-generated',
  sourceFile: sourceReference.sourceFile,
  title: '原文保留式双语翻译',
  outputMode: 'bilingual_sections',
  sections: translatedSections
};

const dedupPending = Array.from(
  new Map(
    pendingItems.map((item, index) => [
      `${item.label}::${item.reason}`,
      {
        id: `feedback-pending-${index + 1}`,
        label: item.label,
        reason: item.reason,
        owner: 'sales',
        status: 'required'
      }
    ])
  ).values()
);

const payload = {
  summary: `已完成 ${translatedSections.length} 个章节的原文保留式双语翻译。`,
  artifacts: [
    {
      title: '原文保留式双语翻译',
      kind: 'text',
      summary: '保留英文原文，在其下方追加中文翻译，供样衣与业务沟通使用。',
      fields: [
        {
          label: '双语对照输出',
          value: `已生成 ${translatedSections.length} 个章节、${translatedSections.reduce(
            (count, section) => count + section.segments.length,
            0
          )} 条英中对照内容。`,
          citation: sourceReference.sourceFile,
          richTextHtml: buildHtml(translatedSections),
          structuredData
        },
        ...(terms.size
          ? [
              {
                label: '术语提示',
                value: Array.from(terms).join(' / '),
                citation: sourceReference.sourceFile
              }
            ]
          : [])
      ]
    }
  ],
  pendingConfirmations: dedupPending,
  task: null
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, outputPath, sections: translatedSections.map((section) => ({ id: section.id, count: section.segments.length })) }, null, 2));
