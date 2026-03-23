import {
  generateModelScopeText,
  getModelScopeModel,
  hasModelScopeConfig
} from '@/lib/assistant/modelscope-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

export const modelScopeProvider: LlmProvider = {
  name: 'modelscope',
  isAvailable: () => hasModelScopeConfig(),
  async generate(request) {
    return {
      provider: 'modelscope',
      model: getModelScopeModel(request.modelOverride),
      text: await generateModelScopeText(
        request.system,
        request.user,
        request.timeoutMs,
        request.modelOverride
      )
    };
  }
};
