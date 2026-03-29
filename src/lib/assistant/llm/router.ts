import { anthropicProvider } from '@/lib/assistant/llm/providers/anthropic';
import { claudeCliProvider } from '@/lib/assistant/llm/providers/claude-cli';
import { codexCliProvider } from '@/lib/assistant/llm/providers/codex-cli';
import { dashScopeProvider } from '@/lib/assistant/llm/providers/dashscope';
import { geminiCliProvider } from '@/lib/assistant/llm/providers/gemini-cli';
import { glmProvider } from '@/lib/assistant/llm/providers/glm';
import { modelScopeProvider } from '@/lib/assistant/llm/providers/modelscope';
import type { LlmProvider, LlmProviderName, LlmRequest } from '@/lib/assistant/llm/types';

const providers: Record<LlmProviderName, LlmProvider> = {
  dashscope: dashScopeProvider,
  modelscope: modelScopeProvider,
  glm: glmProvider,
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
    : ['dashscope', 'modelscope', 'glm', 'codex-cli', 'claude-cli', 'gemini-cli', 'anthropic'];
}

function resolveProviderFromModel(modelOverride: string): LlmProviderName {
  const normalized = modelOverride.trim().toLowerCase();

  if (normalized === 'qwen3.5-flash' || normalized.startsWith('qwen3.5-flash')) {
    return 'dashscope';
  }

  if (normalized === 'minimax/minimax-m2.1') {
    return 'modelscope';
  }

  if (normalized.startsWith('minimax/')) {
    return 'modelscope';
  }

  if (normalized.startsWith('glm-')) {
    return 'glm';
  }

  return 'modelscope';
}

function resolveRequestedProvider(request: LlmRequest): LlmProviderName {
  if (request.modelOverride?.trim()) {
    return resolveProviderFromModel(request.modelOverride);
  }

  return getProviderOrder()[0] ?? 'modelscope';
}

export async function generateWithAvailableProvider(request: LlmRequest) {
  const providerName = resolveRequestedProvider(request);
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`未识别的模型 provider：${providerName}`);
  }

  if (!provider.isAvailable()) {
    if (providerName === 'dashscope') {
      throw new Error(
        '指定的 DashScope provider 当前不可用。请检查 `DASHSCOPE_API_KEY` / `.env.local` 是否生效，并重启当前 Next 服务后重试。'
      );
    }

    if (providerName === 'modelscope') {
      throw new Error(
        '指定的 ModelScope provider 当前不可用。请检查 `MODELSCOPE_API_KEY` / `.env.local` 是否生效，并重启当前 Next 服务后重试。'
      );
    }

    if (providerName === 'glm') {
      throw new Error(
        '指定的 GLM provider 当前不可用。请检查 `GLM_API_KEY` / `.env.local` 是否生效，并重启当前 Next 服务后重试。'
      );
    }

    throw new Error(`指定的 provider ${providerName} 当前不可用。`);
  }

  try {
    return await provider.generate(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown provider error';
    throw new Error(`${provider.name}: ${message}`);
  }
}
