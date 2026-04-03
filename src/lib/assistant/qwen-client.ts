type QwenChatContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

type QwenChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | QwenChatContentPart[];
};

type QwenChatInput = {
  messages: QwenChatMessage[];
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  runtimeConfigOverride?: ModelRuntimeConfig;
};

type QwenChatResult = {
  text: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

const DEBUG_MODEL = process.env.ASSISTANT_DEBUG_MODEL === '1';
const DEFAULT_TIMEOUT_MS = Number(process.env.MODEL_API_TIMEOUT_MS ?? '30000');
type ModelRole = 'vision' | 'translation';

export type ModelRuntimeConfig = {
  model: string;
  baseUrl: string;
  apiKey: string;
  label: string;
};

function isPrivateHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
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

function isVpnHintTarget(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === '172.16.71.201' || isPrivateHost(hostname);
  } catch {
    return false;
  }
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextParts(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.text,
    record.output_text,
    record.content
  ];

  return candidates.flatMap((candidate) => extractTextParts(candidate));
}

function extractPrimaryText(value: unknown) {
  return extractTextParts(value).join('\n').trim();
}

function extractReasoningText(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  return extractPrimaryText(
    record.reasoning_content ??
      record.reasoning ??
      record.reasoning_text ??
      record.thinking ??
      record.thinking_content
  );
}

function describeEmptyContentIssue(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '响应体不是 JSON object。';
  }

  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice =
    choices.length > 0 && choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as Record<string, unknown>)
      : null;
  const message =
    firstChoice?.message && typeof firstChoice.message === 'object'
      ? (firstChoice.message as Record<string, unknown>)
      : null;
  const delta =
    firstChoice?.delta && typeof firstChoice.delta === 'object'
      ? (firstChoice.delta as Record<string, unknown>)
      : null;
  const finishReason =
    typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : '';
  const reasoning =
    extractReasoningText(message) ||
    extractReasoningText(delta) ||
    extractReasoningText(firstChoice);

  if (finishReason === 'length') {
    return '返回被 finish_reason=length 截断，需提高 max_tokens 或降低单次输出规模。';
  }

  if (reasoning) {
    return '仅返回 reasoning_content / thinking，没有稳定的 assistant content；请在 llama.cpp 部署侧确保最终答案写入 message.content。';
  }

  return '响应中未找到可用的 assistant content。';
}

function shouldUseResponsesApi(config: ModelRuntimeConfig) {
  return (
    /dashscope\.aliyuncs\.com/i.test(config.baseUrl) &&
    !/compatible-mode/i.test(config.baseUrl)
  );
}

function shouldDisableThinking(config: ModelRuntimeConfig) {
  return (
    isPrivateHostSafe(config.baseUrl) ||
    /qwen3\.5-(27b|35b-a3b)/i.test(config.model)
  );
}

function isPrivateHostSafe(baseUrl: string) {
  try {
    return isPrivateHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function logModelDebug(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_MODEL) return;
  console.log(`[assistant:model] ${event} ${JSON.stringify(payload)}`);
}

function isAbortError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

function getRoleTimeoutMs(role: ModelRole) {
  const requested =
    role === 'vision'
      ? Number(process.env.VISION_MODEL_API_TIMEOUT_MS ?? process.env.MODEL_API_TIMEOUT_MS ?? '30000')
      : Number(
    process.env.TRANSLATION_MODEL_API_TIMEOUT_MS ?? process.env.MODEL_API_TIMEOUT_MS ?? '30000'
        );
  return Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_TIMEOUT_MS;
}

function resolveRequestTimeoutMs(role: ModelRole, config: ModelRuntimeConfig) {
  const timeoutMs = getRoleTimeoutMs(role);
  if (role === 'vision' && isPrivateHostSafe(config.baseUrl)) {
    return Math.max(timeoutMs, Number(process.env.VISION_LOCAL_MIN_TIMEOUT_MS ?? '20000'));
  }
  return timeoutMs;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim()) ?? '';
}

function pickApiKey(
  baseUrl: string,
  primaryCandidates: Array<string | undefined>,
  fallbackCandidates: Array<string | undefined> = []
) {
  const primary = firstNonEmpty(...primaryCandidates);
  if (primary) {
    return primary;
  }
  if (isApiKeyOptional(baseUrl)) {
    return '';
  }
  return firstNonEmpty(...fallbackCandidates);
}

function isRuntimeConfigUsable(config: ModelRuntimeConfig | null) {
  if (!config) {
    return false;
  }
  return Boolean(config.baseUrl && (config.apiKey || isApiKeyOptional(config.baseUrl)));
}

function hasLocalFallbackTransport() {
  return Boolean(
    firstNonEmpty(process.env.LOCAL_OPENAI_API_URL, process.env.LOCAL_MODEL_API_URL) &&
      (firstNonEmpty(process.env.LOCAL_OPENAI_API_KEY, process.env.LOCAL_MODEL_API_KEY) ||
        isApiKeyOptional(firstNonEmpty(process.env.LOCAL_OPENAI_API_URL, process.env.LOCAL_MODEL_API_URL)!))
  );
}

function getDefaultLocalFallbackModel() {
  return firstNonEmpty(
    process.env.LOCAL_OPENAI_MODEL_NAME,
    process.env.LOCAL_MODEL_NAME,
    'Qwen3.5-9B-Q8_0.gguf'
  );
}

export function getTranslationFallbackRuntimeConfig(): ModelRuntimeConfig | null {
  const model = firstNonEmpty(
    process.env.B_MODEL_FALLBACK_NAME,
    process.env.TRANSLATION_MODEL_FALLBACK,
    hasLocalFallbackTransport() ? getDefaultLocalFallbackModel() : ''
  );
  const baseUrl = firstNonEmpty(
    process.env.B_MODEL_FALLBACK_API_URL,
    process.env.TRANSLATION_FALLBACK_API_URL,
    process.env.LOCAL_OPENAI_API_URL,
    process.env.LOCAL_MODEL_API_URL
  );
  if (!model || !baseUrl) {
    return null;
  }
  const config: ModelRuntimeConfig = {
    model,
    baseUrl,
    apiKey: pickApiKey(
      baseUrl,
      [
        process.env.B_MODEL_FALLBACK_API_KEY,
        process.env.TRANSLATION_FALLBACK_API_KEY,
        process.env.LOCAL_OPENAI_API_KEY,
        process.env.LOCAL_MODEL_API_KEY
      ],
      [process.env.OPENAI_API_KEY]
    ),
    label: 'B-model-fallback'
  };
  return isRuntimeConfigUsable(config) ? config : null;
}

export function getVisionFallbackRuntimeConfig(): ModelRuntimeConfig | null {
  const model = firstNonEmpty(
    process.env.A_MODEL_FALLBACK_NAME,
    process.env.VISION_FALLBACK_MODEL,
    process.env.LOCAL_OPENAI_VISION_MODEL,
    process.env.LOCAL_MODEL_VISION_NAME,
    hasLocalFallbackTransport() ? getDefaultLocalFallbackModel() : ''
  );
  const baseUrl = firstNonEmpty(
    process.env.A_MODEL_FALLBACK_API_URL,
    process.env.VISION_FALLBACK_API_URL,
    process.env.LOCAL_OPENAI_API_URL,
    process.env.LOCAL_MODEL_API_URL
  );
  if (!model || !baseUrl) {
    return null;
  }
  const config: ModelRuntimeConfig = {
    model,
    baseUrl,
    apiKey: pickApiKey(
      baseUrl,
      [
        process.env.A_MODEL_FALLBACK_API_KEY,
        process.env.VISION_FALLBACK_API_KEY,
        process.env.LOCAL_OPENAI_API_KEY,
        process.env.LOCAL_MODEL_API_KEY
      ],
      [process.env.OPENAI_API_KEY]
    ),
    label: 'A-model-fallback'
  };
  return isRuntimeConfigUsable(config) ? config : null;
}

function getTranslationOverrideConfig(modelOverride?: string): ModelRuntimeConfig | null {
  const normalized = modelOverride?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('/') && !normalized.startsWith('http')) {
    const baseUrl = firstNonEmpty(
      process.env.MODELSCOPE_TRANSLATION_API_URL,
      process.env.MODELSCOPE_API_URL,
      process.env.TRANSLATION_API_URL,
      process.env.QWEN_TRANSLATION_BASE_URL,
      process.env.QWEN_BASE_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    return {
      model: modelOverride!.trim(),
      baseUrl,
      apiKey: pickApiKey(baseUrl, [
        process.env.MODELSCOPE_TRANSLATION_API_KEY,
        process.env.MODELSCOPE_API_KEY,
        process.env.TRANSLATION_API_KEY,
        process.env.QWEN_TRANSLATION_API_KEY,
        process.env.QWEN_API_KEY
      ], [process.env.OPENAI_API_KEY]),
      label: 'B-model'
    };
  }

  if (normalized === 'qwen3.5-35b-a3b' || normalized.startsWith('qwen3.5-35b-a3b')) {
    const baseUrl = firstNonEmpty(
      process.env.LOCAL_OPENAI_API_URL,
      process.env.LOCAL_MODEL_API_URL,
      process.env.B_MODEL_API_URL,
      process.env.TRANSLATION_API_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    return {
      model: modelOverride!.trim(),
      baseUrl,
      apiKey: pickApiKey(baseUrl, [
        process.env.LOCAL_OPENAI_API_KEY,
        process.env.LOCAL_MODEL_API_KEY,
        process.env.B_MODEL_API_KEY
      ], [
        process.env.TRANSLATION_API_KEY,
        process.env.OPENAI_API_KEY
      ]),
      label: 'B-model'
    };
  }

  if (normalized === 'qwen3.5-flash' || normalized.startsWith('qwen3.5-flash')) {
    const baseUrl = firstNonEmpty(
      process.env.DASHSCOPE_API_URL,
      process.env.TRANSLATION_API_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    return {
      model: modelOverride!.trim(),
      baseUrl,
      apiKey: pickApiKey(baseUrl, [
        process.env.DASHSCOPE_API_KEY,
        process.env.TRANSLATION_API_KEY
      ], [process.env.OPENAI_API_KEY]),
      label: 'B-model'
    };
  }

  if (normalized.startsWith('minimax/')) {
    const baseUrl = firstNonEmpty(
      process.env.MODELSCOPE_TRANSLATION_API_URL,
      process.env.MODELSCOPE_API_URL,
      process.env.TRANSLATION_API_URL,
      process.env.QWEN_TRANSLATION_BASE_URL,
      process.env.QWEN_BASE_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    return {
      model: modelOverride!.trim(),
      baseUrl,
      apiKey: pickApiKey(baseUrl, [
        process.env.MODELSCOPE_TRANSLATION_API_KEY,
        process.env.MODELSCOPE_API_KEY,
        process.env.TRANSLATION_API_KEY,
        process.env.QWEN_TRANSLATION_API_KEY,
        process.env.QWEN_API_KEY
      ], [process.env.OPENAI_API_KEY]),
      label: 'B-model'
    };
  }

  const baseUrl = firstNonEmpty(
    process.env.TRANSLATION_API_URL,
    process.env.MODELSCOPE_TRANSLATION_API_URL,
    process.env.DASHSCOPE_API_URL,
    process.env.MODELSCOPE_API_URL,
    process.env.QWEN_TRANSLATION_BASE_URL,
    process.env.QWEN_BASE_URL,
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE
  );
  return {
    model: modelOverride!.trim(),
    baseUrl,
    apiKey: pickApiKey(baseUrl, [
      process.env.TRANSLATION_API_KEY,
      process.env.MODELSCOPE_TRANSLATION_API_KEY,
      process.env.DASHSCOPE_API_KEY,
      process.env.MODELSCOPE_API_KEY,
      process.env.QWEN_TRANSLATION_API_KEY,
      process.env.QWEN_API_KEY
    ], [process.env.OPENAI_API_KEY]),
    label: 'B-model'
  };
}

function getRoleConfig(role: ModelRole, modelOverride?: string): ModelRuntimeConfig {
  if (role === 'vision') {
    const baseUrl = firstNonEmpty(
      process.env.A_MODEL_API_URL,
      process.env.VISION_API_URL,
      process.env.MODELSCOPE_VISION_API_URL,
      process.env.QWEN_VISION_BASE_URL,
      process.env.MODELSCOPE_API_URL,
      process.env.QWEN_BASE_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    );
    return {
      model: firstNonEmpty(
        process.env.A_MODEL_NAME,
        process.env.VISION_MODEL,
        process.env.MODELSCOPE_VISION_MODEL,
        process.env.QWEN_VISION_MODEL,
        process.env.MODELSCOPE_MODEL,
        process.env.QWEN_MODEL,
        'qwen3.5-35b-instruct'
      ),
      baseUrl,
      apiKey: pickApiKey(baseUrl, [
        process.env.A_MODEL_API_KEY,
        process.env.VISION_API_KEY,
        process.env.MODELSCOPE_VISION_API_KEY,
        process.env.QWEN_VISION_API_KEY,
        process.env.MODELSCOPE_API_KEY,
        process.env.QWEN_API_KEY
      ], [process.env.OPENAI_API_KEY]),
      label: 'A-model'
    };
  }

  const overrideConfig = getTranslationOverrideConfig(modelOverride);
  if (overrideConfig) {
    return overrideConfig;
  }

  const baseUrl = firstNonEmpty(
    process.env.B_MODEL_API_URL,
    process.env.TRANSLATION_API_URL,
    process.env.DASHSCOPE_API_URL,
    process.env.MODELSCOPE_TRANSLATION_API_URL,
    process.env.QWEN_TRANSLATION_BASE_URL,
    process.env.MODELSCOPE_API_URL,
    process.env.QWEN_BASE_URL,
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE
  );
  return {
    model: firstNonEmpty(
      process.env.B_MODEL_NAME,
      process.env.TRANSLATION_MODEL,
      process.env.DASHSCOPE_MODEL,
      process.env.MODELSCOPE_TRANSLATION_MODEL,
      process.env.QWEN_TRANSLATION_MODEL,
      process.env.MODELSCOPE_MODEL,
      process.env.QWEN_MODEL,
      'qwen3.5-35b-instruct'
    ),
    baseUrl,
    apiKey: pickApiKey(baseUrl, [
      process.env.B_MODEL_API_KEY,
      process.env.TRANSLATION_API_KEY,
      process.env.DASHSCOPE_API_KEY,
      process.env.MODELSCOPE_TRANSLATION_API_KEY,
      process.env.QWEN_TRANSLATION_API_KEY,
      process.env.MODELSCOPE_API_KEY,
      process.env.QWEN_API_KEY
    ], [process.env.OPENAI_API_KEY]),
    label: 'B-model'
  };
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error(
      'Model API URL is missing. Set MODELSCOPE_API_URL or QWEN_BASE_URL/OPENAI_BASE_URL.'
    );
  }
  return trimmed.replace(/\/+$/, '');
}

function buildChatCompletionsUrl(baseUrlOrEndpoint: string) {
  const normalized = normalizeBaseUrl(baseUrlOrEndpoint);
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function buildResponsesUrl(baseUrlOrEndpoint: string) {
  const normalized = normalizeBaseUrl(baseUrlOrEndpoint);
  if (/\/responses$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/responses`;
}

function isRoleConfigured(role: ModelRole, modelOverride?: string) {
  const config = getRoleConfig(role, modelOverride);
  const configured = isRuntimeConfigUsable(config);
  logModelDebug('config.check', {
    role,
    configured,
    hasBaseUrl: Boolean(config.baseUrl),
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    timeoutMs: DEFAULT_TIMEOUT_MS
  });
  return configured;
}

async function callRoleChat(role: ModelRole, input: QwenChatInput): Promise<QwenChatResult> {
  const config = input.runtimeConfigOverride ?? getRoleConfig(role, input.modelOverride);
  const useResponsesApi = shouldUseResponsesApi(config);
  const endpointUrl = useResponsesApi
    ? buildResponsesUrl(config.baseUrl)
    : buildChatCompletionsUrl(config.baseUrl);
  if (!config.apiKey && !isApiKeyOptional(config.baseUrl)) {
    throw new Error(
      `Model API key is missing for ${config.label}.`
    );
  }
  const requestId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const timeoutMs = resolveRequestTimeoutMs(role, config);
  logModelDebug('request.start', {
    requestId,
    role,
    url: endpointUrl,
    model: config.model,
    messageCount: input.messages.length,
    timeoutMs,
    apiStyle: useResponsesApi ? 'responses' : 'chat_completions'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(
        useResponsesApi
          ? {
              model: config.model,
              input: input.messages
            }
          : {
              model: config.model,
              messages: input.messages,
              stream: false,
              temperature: input.temperature ?? 0.2,
              max_tokens: input.maxTokens ?? 1024,
              ...(shouldDisableThinking(config) ? { enable_thinking: false } : {})
            }
      )
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (isVpnHintTarget(config.baseUrl)) {
      throw new Error(
        `无法连接本地模型服务 ${config.baseUrl}。请先连接 VPN，并确认 ${config.model} 服务可用后重试。`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  logModelDebug('request.http_done', {
    requestId,
    status: response.status,
    elapsedMs: Date.now() - startedAt
  });

  if (!response.ok) {
    const raw = await response.text();
    logModelDebug('request.failed', {
      requestId,
      role,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Date.now() - startedAt,
      rawPreview: raw.slice(0, 240)
    });
    const rawPreview = raw.replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(
      `${config.label} request failed: ${response.status} ${response.statusText}${
        rawPreview ? ` :: ${rawPreview}` : ''
      }`
    );
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: unknown;
    choices?: Array<{
      message?: { content?: unknown; reasoning_content?: unknown; thinking?: unknown };
      delta?: { content?: unknown; reasoning_content?: unknown; thinking?: unknown };
      finish_reason?: string;
      reasoning_content?: unknown;
    }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = useResponsesApi
    ? extractPrimaryText(data.output_text) || extractPrimaryText(data.output)
    : extractPrimaryText(data.choices?.[0]?.message?.content) ||
      extractPrimaryText(data.choices?.[0]?.delta?.content);
  if (!text) {
    const issue = describeEmptyContentIssue(data);
    logModelDebug('request.empty_content', {
      requestId,
      role,
      elapsedMs: Date.now() - startedAt,
      responseKeys: Object.keys(data),
      issue,
      rawPreview: JSON.stringify(data).slice(0, 600)
    });
    throw new Error(`${config.label} returned empty content. ${issue}`);
  }
  logModelDebug('request.success', {
    requestId,
    role,
    elapsedMs: Date.now() - startedAt,
    totalTokens: data.usage?.total_tokens ?? null
  });

  return {
    text,
    model: data.model ?? config.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens
    }
  };
}

export function isVisionModelConfigured() {
  return isRoleConfigured('vision');
}

export function isTranslationModelConfigured(modelOverride?: string) {
  return isRoleConfigured('translation', modelOverride);
}

export async function callVisionModelChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callRoleChat('vision', input);
}

export async function callTranslationModelChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callRoleChat('translation', input);
}

export function getVisionModelName(runtimeConfigOverride?: ModelRuntimeConfig) {
  return (runtimeConfigOverride ?? getRoleConfig('vision')).model;
}

export function getTranslationModelName(modelOverride?: string) {
  return getRoleConfig('translation', modelOverride).model;
}

export function isQwenConfigured() {
  return isTranslationModelConfigured();
}

export async function callQwenChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callTranslationModelChat(input);
}
