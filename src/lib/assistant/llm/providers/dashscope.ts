import {
  generateDashScopeText,
  getDashScopeModel,
  hasDashScopeConfig
} from '@/lib/assistant/dashscope-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

export const dashScopeProvider: LlmProvider = {
  name: 'dashscope',
  isAvailable: () => hasDashScopeConfig(),
  async generate(request) {
    return {
      provider: 'dashscope',
      model: getDashScopeModel(request.modelOverride),
      text: await generateDashScopeText(
        request.system,
        request.user,
        request.timeoutMs,
        request.modelOverride
      )
    };
  }
};
