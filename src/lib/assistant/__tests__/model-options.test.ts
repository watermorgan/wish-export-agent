import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultTranslationModelId,
  defaultVisionModelId,
  translationModelOptions,
  visionModelOptions
} from '../model-options';

test('local model is the default A/B entry point', () => {
  assert.equal(visionModelOptions[0]?.id, defaultVisionModelId);
  assert.equal(translationModelOptions[0]?.id, defaultTranslationModelId);
  assert.ok(defaultVisionModelId.length > 0);
  assert.ok(defaultTranslationModelId.length > 0);
});
