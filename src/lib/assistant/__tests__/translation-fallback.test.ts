import assert from 'node:assert/strict';
import test from 'node:test';

import { __translationPipelineInternals } from '../translation-pipeline';

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
