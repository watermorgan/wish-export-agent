import { generateAnthropicText, hasAnthropicConfig } from '@/lib/assistant/anthropic-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

export const anthropicProvider: LlmProvider = {
  name: 'anthropic',
  isAvailable: () => hasAnthropicConfig(),
  async generate(request) {
    return {
      provider: 'anthropic',
      text: await generateAnthropicText(request.system, request.user)
    };
  }
};
