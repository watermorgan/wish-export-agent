import test from 'node:test';
import assert from 'node:assert/strict';

import { __translationPipelineInternals } from '../translation-pipeline';

test('mergeBModelBatchExecutionResult matches serial merge semantics', () => {
  const translated = new Map<string, string>();
  const stats = {
    configured: true,
    batchAttempts: 0,
    batchJsonOk: 0,
    lastErrorKind: 'none' as const,
    providerHits: [] as string[],
    fallbackConfigured: false,
    fallbackUsed: false,
    activeModel: 'model-a',
    retranslatePasses: 0,
    retranslatedSegmentCount: 0,
    visionSecondStagePasses: 0,
    visionSecondStageSegmentCount: 0,
    modelUnavailable: false
  };

  __translationPipelineInternals.mergeBModelBatchExecutionResult(translated, stats, {
    translated: new Map([
      ['seg-1', '中文1'],
      ['seg-2', '中文2']
    ]),
    attempts: 2,
    jsonOk: 1,
    lastErrorKind: 'none',
    providerHits: ['translation-model'],
    activeModel: 'model-b',
    stopDueRateLimit: false,
    stopDueModelUnavailable: false
  });

  assert.equal(translated.get('seg-1'), '中文1');
  assert.equal(translated.get('seg-2'), '中文2');
  assert.equal(stats.batchAttempts, 2);
  assert.equal(stats.batchJsonOk, 1);
  assert.equal(stats.lastErrorKind, 'none');
  assert.deepEqual(stats.providerHits, ['translation-model']);
  assert.equal(stats.activeModel, 'model-b');
});

test('delayWithSignal stops early after abort', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(), 20);
  const completed = await __translationPipelineInternals.delayWithSignal(1000, controller.signal);
  assert.equal(completed, false);
  assert.ok(Date.now() - startedAt < 300);
});

test('computeAdaptiveBatchSize falls back to 1 when parse failures are high', () => {
  assert.equal(
    __translationPipelineInternals.computeAdaptiveBatchSize(4, 10, 5, 0.4),
    1
  );
  assert.equal(
    __translationPipelineInternals.computeAdaptiveBatchSize(4, 10, 8, 0.4),
    4
  );
});

test('computeDefaultBModelMaxTokens tracks batch size without exceeding cap', () => {
  assert.equal(
    __translationPipelineInternals.computeDefaultBModelMaxTokens(4, false),
    900
  );
  assert.equal(
    __translationPipelineInternals.computeDefaultBModelMaxTokens(20, false),
    4000
  );
  assert.equal(
    __translationPipelineInternals.computeDefaultBModelMaxTokens(2, true),
    1600
  );
});
