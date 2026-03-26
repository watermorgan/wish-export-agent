import { generateGlmText, getGlmModel, hasGlmConfig } from '@/lib/assistant/glm-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

export const glmProvider: LlmProvider = {
  name: 'glm',
  isAvailable: () => hasGlmConfig(),
  async generate(request) {
    return {
      provider: 'glm',
      model: getGlmModel(request.modelOverride),
      text: await generateGlmText(
        request.system,
        request.user,
        request.timeoutMs,
        request.modelOverride
      )
    };
  }
};
