import assert from 'node:assert/strict';
import test from 'node:test';

import { __translationPipelineInternals } from '../translation-pipeline';

const ENV_KEYS = [
  'LOCAL_MODEL_API_URL',
  'LOCAL_OPENAI_API_URL',
  'B_MODEL_API_URL',
  'TRANSLATION_API_URL',
  'DASHSCOPE_API_URL',
  'MODELSCOPE_TRANSLATION_API_URL',
  'QWEN_TRANSLATION_BASE_URL',
  'MODELSCOPE_API_URL',
  'QWEN_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'B_MODEL_FALLBACK_API_URL',
  'TRANSLATION_FALLBACK_API_URL',
  'OPENROUTER_API_URL',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_API_KEY',
  'B_MODEL_TRANSPORT_RETRY_LIMIT',
  'B_MODEL_BATCH_SIZE',
  'B_MODEL_CONCURRENCY',
  'B_MODEL_BATCH_DELAY_MS',
  'B_MODEL_RETRANSLATE_ENABLED',
  'B_MODEL_VISION_SECOND_STAGE_ENABLED',
  'B_MODEL_CLI_FALLBACK_ENABLED',
  'TRANSLATION_MODEL_API_TIMEOUT_MS',
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv.get(key);
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

test.afterEach(() => {
  resetEnv();
});

test('shouldAttemptTranslationFallback returns true for transport-style failure', () => {
  assert.equal(
    __translationPipelineInternals.shouldAttemptTranslationFallback(0, {
      batchAttempts: 1,
      batchJsonOk: 0,
      lastErrorKind: 'timeout'
    }),
    true
  );
});

test('shouldAttemptTranslationFallback returns true for successful-but-empty primary result', () => {
  assert.equal(
    __translationPipelineInternals.shouldAttemptTranslationFallback(0, {
      batchAttempts: 1,
      batchJsonOk: 1,
      lastErrorKind: 'none'
    }),
    true
  );
});

test('shouldAttemptTranslationFallback returns false when primary already translated content', () => {
  assert.equal(
    __translationPipelineInternals.shouldAttemptTranslationFallback(3, {
      batchAttempts: 1,
      batchJsonOk: 1,
      lastErrorKind: 'none'
    }),
    false
  );
});

test('translation model transport failures stop after three consecutive unavailable batches', async () => {
  resetEnv();
  process.env.LOCAL_MODEL_API_URL = 'http://127.0.0.1:9/v1';
  process.env.B_MODEL_TRANSPORT_RETRY_LIMIT = '0';
  process.env.B_MODEL_BATCH_SIZE = '1';
  process.env.B_MODEL_CONCURRENCY = '1';
  process.env.B_MODEL_BATCH_DELAY_MS = '0';
  process.env.B_MODEL_RETRANSLATE_ENABLED = '1';
  process.env.B_MODEL_VISION_SECOND_STAGE_ENABLED = '1';
  process.env.B_MODEL_CLI_FALLBACK_ENABLED = '0';
  process.env.TRANSLATION_MODEL_API_TIMEOUT_MS = '200';

  const segments = Array.from({ length: 10 }, (_, index) => ({
    id: `seg-${index + 1}`,
    text: `Source segment ${index + 1}`,
    pageNumber: 1,
    regionId: `region-${index + 1}`,
    extractionMeta: {
      sourceType: 'text_layer',
      layoutConfidence: 1,
      mergeConfidence: 1
    }
  }));

  const { map, stats } = await __translationPipelineInternals.translateSegmentsWithModelB(
    segments,
    segments.length,
    undefined,
    'mixed'
  );

  assert.equal(map.size, 0);
  assert.equal(stats.lastErrorKind, 'http');
  assert.equal(stats.batchAttempts, 3);
  assert.equal(stats.fallbackUsed, false);
  assert.equal(stats.retranslatePasses, 0);
  assert.equal(stats.visionSecondStagePasses, 0);
});
