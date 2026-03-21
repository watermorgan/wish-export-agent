import { anthropicProvider } from '@/lib/assistant/llm/providers/anthropic';
import { claudeCliProvider } from '@/lib/assistant/llm/providers/claude-cli';
import { codexCliProvider } from '@/lib/assistant/llm/providers/codex-cli';
import { geminiCliProvider } from '@/lib/assistant/llm/providers/gemini-cli';
import { modelScopeProvider } from '@/lib/assistant/llm/providers/modelscope';
import type { LlmProvider, LlmProviderName, LlmRequest } from '@/lib/assistant/llm/types';

const providers: Record<LlmProviderName, LlmProvider> = {
  modelscope: modelScopeProvider,
  'gemini-cli': geminiCliProvider,
  anthropic: anthropicProvider,
  'claude-cli': claudeCliProvider,
  'codex-cli': codexCliProvider
};

function getProviderOrder(): LlmProviderName[] {
  const configured = process.env.ASSISTANT_LLM_PROVIDERS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) as LlmProviderName[] | undefined;

  return configured && configured.length > 0
    ? configured
    : ['modelscope', 'codex-cli', 'claude-cli', 'gemini-cli', 'anthropic'];
}

export async function generateWithAvailableProvider(request: LlmRequest) {
  const errors: string[] = [];

  for (const providerName of getProviderOrder()) {
    const provider = providers[providerName];
    if (!provider || !provider.isAvailable()) {
      continue;
    }

    try {
      return await provider.generate(request);
    } catch (error) {
      errors.push(
        `${provider.name}: ${error instanceof Error ? error.message : 'unknown provider error'}`
      );
    }
  }

  throw new Error(errors.length > 0 ? errors.join(' | ') : '没有可用的模型 provider。');
}
