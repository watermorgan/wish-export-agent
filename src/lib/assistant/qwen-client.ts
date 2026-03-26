type QwenChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type QwenChatInput = {
  messages: QwenChatMessage[];
  temperature?: number;
  maxTokens?: number;
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

type ModelRuntimeConfig = {
  model: string;
  baseUrl: string;
  apiKey: string;
  label: string;
};

function shouldUseResponsesApi(config: ModelRuntimeConfig) {
  return /dashscope\.aliyuncs\.com/i.test(config.baseUrl) || config.model === 'qwen3.5-flash';
}

function logModelDebug(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_MODEL) return;
  console.log(`[assistant:model] ${event} ${JSON.stringify(payload)}`);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim()) ?? '';
}

function getRoleConfig(role: ModelRole): ModelRuntimeConfig {
  if (role === 'vision') {
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
      baseUrl: firstNonEmpty(
        process.env.A_MODEL_API_URL,
        process.env.VISION_API_URL,
        process.env.MODELSCOPE_VISION_API_URL,
        process.env.QWEN_VISION_BASE_URL,
        process.env.MODELSCOPE_API_URL,
        process.env.QWEN_BASE_URL,
        process.env.OPENAI_BASE_URL,
        process.env.OPENAI_API_BASE
      ),
      apiKey: firstNonEmpty(
        process.env.A_MODEL_API_KEY,
        process.env.VISION_API_KEY,
        process.env.MODELSCOPE_VISION_API_KEY,
        process.env.QWEN_VISION_API_KEY,
        process.env.MODELSCOPE_API_KEY,
        process.env.QWEN_API_KEY,
        process.env.OPENAI_API_KEY
      ),
      label: 'A-model'
    };
  }

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
    baseUrl: firstNonEmpty(
      process.env.B_MODEL_API_URL,
      process.env.TRANSLATION_API_URL,
      process.env.DASHSCOPE_API_URL,
      process.env.MODELSCOPE_TRANSLATION_API_URL,
      process.env.QWEN_TRANSLATION_BASE_URL,
      process.env.MODELSCOPE_API_URL,
      process.env.QWEN_BASE_URL,
      process.env.OPENAI_BASE_URL,
      process.env.OPENAI_API_BASE
    ),
    apiKey: firstNonEmpty(
      process.env.B_MODEL_API_KEY,
      process.env.TRANSLATION_API_KEY,
      process.env.DASHSCOPE_API_KEY,
      process.env.MODELSCOPE_TRANSLATION_API_KEY,
      process.env.QWEN_TRANSLATION_API_KEY,
      process.env.MODELSCOPE_API_KEY,
      process.env.QWEN_API_KEY,
      process.env.OPENAI_API_KEY
    ),
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

function isRoleConfigured(role: ModelRole) {
  const config = getRoleConfig(role);
  const configured = Boolean(config.baseUrl && config.apiKey);
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
  const config = getRoleConfig(role);
  const useResponsesApi = shouldUseResponsesApi(config);
  const endpointUrl = useResponsesApi
    ? buildResponsesUrl(config.baseUrl)
    : buildChatCompletionsUrl(config.baseUrl);
  if (!config.apiKey) {
    throw new Error(
      `Model API key is missing for ${config.label}.`
    );
  }
  const requestId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  logModelDebug('request.start', {
    requestId,
    role,
    url: endpointUrl,
    model: config.model,
    messageCount: input.messages.length,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    apiStyle: useResponsesApi ? 'responses' : 'chat_completions'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
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
              temperature: input.temperature ?? 0.2,
              max_tokens: input.maxTokens ?? 1024
            }
      )
    });
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
    throw new Error(`${config.label} request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = useResponsesApi
    ? (
        data.output_text?.trim() ??
        data.output?.flatMap((item) =>
          (item.content ?? []).map((contentItem) => contentItem.text?.trim() ?? '')
        ).filter(Boolean).join('\n').trim() ??
        ''
      )
    : (data.choices?.[0]?.message?.content?.trim() ?? '');
  if (!text) {
    logModelDebug('request.empty_content', {
      requestId,
      role,
      elapsedMs: Date.now() - startedAt
    });
    throw new Error(`${config.label} returned empty content.`);
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

export function isTranslationModelConfigured() {
  return isRoleConfigured('translation');
}

export async function callVisionModelChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callRoleChat('vision', input);
}

export async function callTranslationModelChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callRoleChat('translation', input);
}

export function getVisionModelName() {
  return getRoleConfig('vision').model;
}

export function getTranslationModelName() {
  return getRoleConfig('translation').model;
}

export function isQwenConfigured() {
  return isTranslationModelConfigured();
}

export async function callQwenChat(input: QwenChatInput): Promise<QwenChatResult> {
  return callTranslationModelChat(input);
}
