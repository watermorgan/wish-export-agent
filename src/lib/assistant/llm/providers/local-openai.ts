import {
  generateOpenAiCompatibleText
} from '@/lib/assistant/openai-compatible-client';
import type { LlmProvider } from '@/lib/assistant/llm/types';

function isPrivateHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  );
}

function isApiKeyOptional(baseUrl: string) {
  try {
    return isPrivateHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function hasLocalConfig() {
  const baseUrl = firstNonEmpty(process.env.LOCAL_OPENAI_API_URL, process.env.LOCAL_MODEL_API_URL);
  if (!baseUrl) {
    return false;
  }

  return Boolean(
    process.env.LOCAL_OPENAI_API_KEY ||
      process.env.LOCAL_MODEL_API_KEY ||
      isApiKeyOptional(baseUrl)
  );
}

function getLocalModel(modelOverride?: string) {
  return (
    modelOverride?.trim() ||
    process.env.LOCAL_OPENAI_MODEL_NAME ||
    process.env.LOCAL_MODEL_NAME ||
    'Gemma-4-31B-it'
  );
}

export const localOpenAiProvider: LlmProvider = {
  name: 'local-openai',
  isAvailable: () => hasLocalConfig(),
  async generate(request) {
    const baseUrl = firstNonEmpty(
      process.env.LOCAL_OPENAI_API_URL,
      process.env.LOCAL_MODEL_API_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    if (!baseUrl) {
      throw new Error('Local OpenAI-compatible base URL is missing.');
    }

    return {
      provider: 'local-openai',
      model: getLocalModel(request.modelOverride),
      text: await generateOpenAiCompatibleText({
        apiKey: firstNonEmpty(process.env.LOCAL_OPENAI_API_KEY, process.env.LOCAL_MODEL_API_KEY),
        baseUrl: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        model: getLocalModel(request.modelOverride),
        system: request.system,
        user: request.user,
        timeoutMs: request.timeoutMs,
        label: 'Local OpenAI provider'
      })
    };
  }
};
