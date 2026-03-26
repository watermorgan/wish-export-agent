import { generateOpenAiCompatibleText } from '@/lib/assistant/openai-compatible-client';

const GLM_API_URL = process.env.GLM_API_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
const GLM_MODEL = process.env.GLM_MODEL ?? 'glm-4.5v-flash';

function normalizeGlmEndpoint(baseUrlOrEndpoint: string) {
  const trimmed = baseUrlOrEndpoint.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('未配置 GLM_API_URL，无法调用 GLM。');
  }

  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

export function getGlmModel(modelOverride?: string) {
  return modelOverride?.trim() || GLM_MODEL;
}

export function hasGlmConfig() {
  return Boolean(process.env.GLM_API_KEY);
}

export async function generateGlmText(
  system: string,
  user: string,
  timeoutMs?: number,
  modelOverride?: string
) {
  const apiKey = process.env.GLM_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 GLM_API_KEY，无法调用 GLM。');
  }

  return generateOpenAiCompatibleText({
    apiKey,
    baseUrl: normalizeGlmEndpoint(GLM_API_URL),
    model: getGlmModel(modelOverride),
    system,
    user,
    timeoutMs,
    label: 'GLM'
  });
}
