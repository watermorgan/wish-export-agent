import { generateResponsesCompatibleText } from '@/lib/assistant/openai-compatible-client';

const DASHSCOPE_API_URL =
  process.env.DASHSCOPE_API_URL ??
  'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1';
const DASHSCOPE_MODEL = process.env.DASHSCOPE_MODEL ?? 'qwen3.5-flash';

export function getDashScopeModel(modelOverride?: string) {
  return modelOverride?.trim() || DASHSCOPE_MODEL;
}

export function hasDashScopeConfig() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

export async function generateDashScopeText(
  system: string,
  user: string,
  timeoutMs?: number,
  modelOverride?: string
) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法调用 DashScope。');
  }

  return generateResponsesCompatibleText({
    apiKey,
    baseUrl: DASHSCOPE_API_URL,
    model: getDashScopeModel(modelOverride),
    system,
    user,
    timeoutMs,
    label: 'DashScope'
  });
}
