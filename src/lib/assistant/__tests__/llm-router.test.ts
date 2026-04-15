import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PROVIDER_ORDER, getProviderOrder } from '../llm/router';

test('default provider order is local-first', () => {
  assert.equal(DEFAULT_PROVIDER_ORDER[0], 'local-openai');
});

test('configured provider order keeps only supported providers', () => {
  const previous = process.env.ASSISTANT_LLM_PROVIDERS;
  process.env.ASSISTANT_LLM_PROVIDERS = 'invalid-provider,local-openai,claude-cli';

  try {
    assert.deepEqual(getProviderOrder(), ['local-openai', 'claude-cli']);
  } finally {
    if (previous === undefined) {
      delete process.env.ASSISTANT_LLM_PROVIDERS;
    } else {
      process.env.ASSISTANT_LLM_PROVIDERS = previous;
    }
  }
});
