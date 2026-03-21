import { generateModelScopeText, hasModelScopeConfig } from '@/lib/assistant/modelscope-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

export const modelScopeProvider: LlmProvider = {
  name: 'modelscope',
  isAvailable: () => hasModelScopeConfig(),
  async generate(request) {
    return {
      provider: 'modelscope',
      text: await generateModelScopeText(request.system, request.user, request.timeoutMs)
    };
  }
};
