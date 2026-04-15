import { generateOpenAiCompatibleText } from '@/lib/assistant/openai-compatible-client';

const MODELSCOPE_API_URL =
  process.env.MODELSCOPE_API_URL ?? 'https://api-inference.modelscope.cn/v1/chat/completions';
const MODELSCOPE_MODEL = process.env.MODELSCOPE_MODEL ?? 'Qwen/Qwen3.5-35B-A3B';

export function getModelScopeModel(modelOverride?: string) {
  return modelOverride?.trim() || MODELSCOPE_MODEL;
}

export function hasModelScopeConfig() {
  return Boolean(process.env.MODELSCOPE_API_KEY);
}

export async function generateModelScopeText(
  system: string,
  user: string,
  timeoutMs?: number,
  modelOverride?: string
) {
  const apiKey = process.env.MODELSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 MODELSCOPE_API_KEY，无法调用 ModelScope。');
  }

  return generateOpenAiCompatibleText({
    apiKey,
    baseUrl: MODELSCOPE_API_URL,
    model: getModelScopeModel(modelOverride),
    system,
    user,
    timeoutMs,
    label: 'ModelScope'
  });
}
