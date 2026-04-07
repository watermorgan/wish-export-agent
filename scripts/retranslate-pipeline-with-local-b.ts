import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

import {
  callTranslationModelChat,
  type ModelRuntimeConfig
} from '../src/lib/assistant/qwen-client';
import { normalizeFashionTranslation } from '../src/lib/assistant/translation-pipeline';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type PipelineResult = {
  fileName: string;
  success: boolean;
  segments: Array<{
    id: string;
    text: string;
    zh?: string;
    pageNumber: number;
    regionId: string;
    extractionMeta?: {
      sourceType?: string;
      pageLayoutType?: string;
    };
  }>;
  diagnostics: Record<string, unknown>;
  outputs: {
    annotatedPdf?: {
      items?: Array<{
        id: string;
        pageNumber: number;
        regionId: string;
        en: string;
        zh?: string;
        renderMode?: string;
      }>;
      snapshot?: {
        version: string;
        items: Array<{
          id: string;
          pageNumber: number;
          regionId: string;
          en: string;
          zh?: string;
          renderMode?: string;
          sourceType?: string;
          confidence?: number;
          pageLayoutType?: string;
        }>;
      };
    };
  };
};

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim()) ?? '';
}

function getLocalBConfig(): ModelRuntimeConfig {
  const baseUrl = firstNonEmpty(
    process.env.LOCAL_OPENAI_API_URL,
    process.env.LOCAL_MODEL_API_URL
  );
  const model = firstNonEmpty(
    process.env.LOCAL_OPENAI_MODEL_NAME,
    process.env.LOCAL_MODEL_NAME,
    'gemma-4-31B-it-Q3_K_M.gguf'
  );
  const apiKey = firstNonEmpty(
    process.env.LOCAL_OPENAI_API_KEY,
    process.env.LOCAL_MODEL_API_KEY
  );
  if (!baseUrl) {
    throw new Error('LOCAL_OPENAI_API_URL is missing');
  }
  return {
    model,
    baseUrl,
    apiKey,
    label: 'local-B-retranslate'
  };
}

function safeParseTranslationResponse(raw: string): Array<{ id: string; zh: string }> {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(normalized) as
    | { translations?: Array<{ id?: string; zh?: string; text?: string }> }
    | Array<{ id?: string; zh?: string; text?: string }>;
  const items = Array.isArray(parsed) ? parsed : (parsed.translations ?? []);
  return items
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      zh: String(item.zh ?? item.text ?? '').trim()
    }))
    .filter((item) => item.id && item.zh);
}

function buildPrompt(batch: Array<{ id: string; text: string }>) {
  return [
    '你是服装工艺单翻译模型(B)。仅翻译结构化片段，不做结构识别，不做内容合并。',
    '输出 JSON：{"translations":[{"id":"...","zh":"..."}]}。',
    '请保留每个 id，不要新增或删除。',
    '译文要求：使用服装工艺单常用中文短句，优先贴标签式表达，不写解释性废话。',
    '颜色/面料/辅料/洗水/车缝类片段尽量保持“项目：内容”结构。',
    '款号、物料码、成分比例、克重、幅宽、毫米、厘米等数字和单位原样保留，不要编造。',
    '',
    '片段：',
    JSON.stringify(batch)
  ].join('\n');
}

function isRenderableBusinessItem(item: {
  zh?: string;
  renderMode?: string;
}) {
  const zh = String(item.zh ?? '').trim();
  if (!zh) return false;
  return item.renderMode !== 'footnote';
}

async function translateSegmentsWithLocalB(
  segments: PipelineResult['segments'],
  config: ModelRuntimeConfig
) {
  const translated = new Map<string, string>();
  const batchSize = Math.max(1, Number(process.env.RETRANSLATE_LOCAL_B_BATCH_SIZE ?? '1'));
  const maxTokens = Math.max(300, Number(process.env.RETRANSLATE_LOCAL_B_MAX_TOKENS ?? '900'));
  const segTextMaxChars = Math.max(
    80,
    Number(process.env.RETRANSLATE_LOCAL_B_SEG_TEXT_MAX_CHARS ?? '220')
  );

  for (let index = 0; index < segments.length; index += batchSize) {
    const batch = segments.slice(index, index + batchSize).map((segment) => ({
      id: segment.id,
      text:
        segment.text.length > segTextMaxChars
          ? segment.text.slice(0, segTextMaxChars)
          : segment.text
    }));
    const result = await callTranslationModelChat({
      runtimeConfigOverride: config,
      temperature: 0.1,
      maxTokens,
      messages: [
        {
          role: 'system',
          content: 'You are a precise segment translation model.'
        },
        {
          role: 'user',
          content: buildPrompt(batch)
        }
      ]
    });
    const parsed = safeParseTranslationResponse(result.text);
    for (const item of parsed) {
      translated.set(item.id, item.zh);
    }
  }

  return translated;
}

async function main() {
  const pipelinePath = path.resolve(process.argv[2] ?? '');
  const originalPdf = path.resolve(process.argv[3] ?? '');
  const outputDir = path.resolve(process.argv[4] ?? '');

  if (!pipelinePath || !originalPdf || !outputDir) {
    throw new Error(
      'Usage: node --import tsx scripts/retranslate-pipeline-with-local-b.ts <pipeline-result.json> <original.pdf> <output-dir>'
    );
  }

  const config = getLocalBConfig();
  const result = JSON.parse(await readFile(pipelinePath, 'utf8')) as PipelineResult;
  const originalItemZh = new Map(
    (result.outputs.annotatedPdf?.items ?? []).map((item) => [item.id, item.zh ?? ''])
  );
  const originalSnapshotZh = new Map(
    (result.outputs.annotatedPdf?.snapshot?.items ?? []).map((item) => [item.id, item.zh ?? ''])
  );
  const translated = await translateSegmentsWithLocalB(result.segments, config);

  for (const segment of result.segments) {
    const rawZh = translated.get(segment.id);
    segment.zh = rawZh ? normalizeFashionTranslation(segment.text, rawZh) : rawZh;
  }

  const items = result.outputs.annotatedPdf?.items ?? [];
  for (const item of items) {
    const rawZh = translated.get(item.id);
    const originalZh = originalItemZh.get(item.id) ?? '';
    if (!originalZh) {
      item.zh = '';
      continue;
    }
    item.zh = rawZh ? normalizeFashionTranslation(item.en, rawZh) : rawZh;
  }

  const snapshot = result.outputs.annotatedPdf?.snapshot;
  if (!snapshot) {
    throw new Error(`Annotated snapshot missing in ${pipelinePath}`);
  }
  for (const item of snapshot.items) {
    const rawZh = translated.get(item.id);
    const originalZh = originalSnapshotZh.get(item.id) ?? '';
    if (!originalZh) {
      item.zh = '';
      continue;
    }
    item.zh = rawZh ? normalizeFashionTranslation(item.en, rawZh) : rawZh;
  }

  const translatedSegmentCount = result.segments.filter((segment) => segment.zh?.trim()).length;
  const translatedBusinessSegmentCount = snapshot.items.filter((item) =>
    isRenderableBusinessItem(item)
  ).length;
  const businessSegmentCount = snapshot.items.filter(
    (item) => item.renderMode !== 'footnote'
  ).length;

  result.diagnostics = {
    ...result.diagnostics,
    bModelExecuted: true,
    bModelActiveModel: config.model,
    bModelFallbackUsed: false,
    translatedSegmentCount,
    translationCoveragePct:
      result.segments.length > 0
        ? Math.round((translatedSegmentCount / result.segments.length) * 100)
        : 0,
    businessSegmentCount,
    translatedBusinessSegmentCount,
    businessTranslationCoveragePct:
      businessSegmentCount > 0
        ? Math.round((translatedBusinessSegmentCount / businessSegmentCount) * 100)
        : 0,
    isBusinessPreviewReady:
      businessSegmentCount > 0 && translatedBusinessSegmentCount === businessSegmentCount,
    previewSuppressedReason:
      businessSegmentCount > 0 && translatedBusinessSegmentCount === businessSegmentCount
        ? null
        : 'no_business_translations'
  };

  await mkdir(outputDir, { recursive: true });
  const outPipeline = path.join(outputDir, 'pipeline-result.json');
  const responseJson = path.join(outputDir, `${path.basename(originalPdf)}.response.json`);
  const annotatedPdf = path.join(outputDir, `${path.basename(originalPdf)}.annotated.pdf`);

  await writeFile(outPipeline, JSON.stringify(result, null, 2), 'utf8');

  const responsePayload = {
    summary: `${path.basename(originalPdf)} local gemma4 B retranslation`,
    artifacts: [
      {
        title: '原文保留式双语翻译',
        kind: 'text',
        summary: '复用既有 A/segment 结果，仅替换 B 为本地 gemma4 后生成正式 PDF。',
        fields: [
          {
            label: 'PDF Pipeline 结果',
            value: `${path.basename(originalPdf)} local gemma4 B retranslation`,
            citation: path.basename(originalPdf),
            structuredData: snapshot
          }
        ]
      }
    ]
  };
  await writeFile(responseJson, JSON.stringify(responsePayload, null, 2), 'utf8');

  const render = spawnSync(
    'python3',
    ['scripts/render_feedback_pdf.py', originalPdf, responseJson, annotatedPdf],
    {
      cwd: process.cwd(),
      encoding: 'utf8'
    }
  );
  if (render.status !== 0) {
    throw new Error(`render failed: ${render.stderr || render.stdout}`);
  }

  console.log(
    JSON.stringify(
      {
        pipelinePath: outPipeline,
        responseJson,
        annotatedPdf,
        translatedSegmentCount,
        totalSegments: result.segments.length,
        bModelActiveModel: config.model
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
