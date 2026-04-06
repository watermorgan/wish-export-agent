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

/** When `1`, prefer `OPENAI_*` / `QWEN_*` so local llama.cpp can be used without unsetting ModelScope. */
const OPENAI_COMPAT_FIRST = process.env.LLM_PREFER_OPENAI_COMPAT === '1';

const DEFAULT_MODEL = OPENAI_COMPAT_FIRST
  ? (process.env.QWEN_MODEL ??
    process.env.MODELSCOPE_MODEL ??
    process.env.OPENAI_MODEL ??
    'qwen3.5-35b-instruct')
  : (process.env.MODELSCOPE_MODEL ?? process.env.QWEN_MODEL ?? 'qwen3.5-35b-instruct');

const DEFAULT_BASE_URL = OPENAI_COMPAT_FIRST
  ? (process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    process.env.QWEN_BASE_URL ??
    process.env.MODELSCOPE_API_URL ??
    '')
  : (process.env.MODELSCOPE_API_URL ??
    process.env.QWEN_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    '');

const DEFAULT_API_KEY = OPENAI_COMPAT_FIRST
  ? (process.env.OPENAI_API_KEY ??
    process.env.QWEN_API_KEY ??
    process.env.MODELSCOPE_API_KEY ??
    '')
  : (process.env.MODELSCOPE_API_KEY ??
    process.env.QWEN_API_KEY ??
    process.env.OPENAI_API_KEY ??
    '');
const DEFAULT_TIMEOUT_MS = Number(process.env.MODEL_API_TIMEOUT_MS ?? '30000');

/** OpenAI-compatible multimodal parts (data URLs supported by most local OpenAI servers). */
export type QwenChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type QwenChatMessageWithParts = {
  role: 'system' | 'user' | 'assistant';
  content: string | QwenChatContentPart[];
};

export type QwenChatWithPartsInput = {
  messages: QwenChatMessageWithParts[];
  temperature?: number;
  maxTokens?: number;
};

function logModelDebug(event: string, payload: Record<string, unknown>) {
  if (!DEBUG_MODEL) return;
  console.log(`[assistant:model] ${event} ${JSON.stringify(payload)}`);
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

export function isQwenConfigured() {
  const configured = Boolean(DEFAULT_BASE_URL && DEFAULT_API_KEY);
  logModelDebug('config.check', {
    configured,
    hasBaseUrl: Boolean(DEFAULT_BASE_URL),
    hasApiKey: Boolean(DEFAULT_API_KEY),
    model: DEFAULT_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS
  });
  return configured;
}

async function postChatCompletions(
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<Response> {
  const chatCompletionsUrl = buildChatCompletionsUrl(DEFAULT_BASE_URL);
  if (!DEFAULT_API_KEY) {
    throw new Error(
      'Model API key is missing. Set MODELSCOPE_API_KEY or QWEN_API_KEY/OPENAI_API_KEY.'
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(chatCompletionsUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEFAULT_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function callQwenChat(input: QwenChatInput): Promise<QwenChatResult> {
  const requestId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  logModelDebug('request.start', {
    requestId,
    model: DEFAULT_MODEL,
    messageCount: input.messages.length,
    timeoutMs: DEFAULT_TIMEOUT_MS
  });

  let response: Response;
  try {
    response = await postChatCompletions(
      {
        model: DEFAULT_MODEL,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 1024
      },
      DEFAULT_TIMEOUT_MS
    );
  } catch (e) {
    logModelDebug('request.fetch_error', {
      requestId,
      message: e instanceof Error ? e.message : String(e)
    });
    throw e;
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
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Date.now() - startedAt,
      rawPreview: raw.slice(0, 240)
    });
    throw new Error(`Qwen request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) {
    logModelDebug('request.empty_content', {
      requestId,
      elapsedMs: Date.now() - startedAt
    });
    throw new Error('Qwen returned empty content.');
  }
  logModelDebug('request.success', {
    requestId,
    elapsedMs: Date.now() - startedAt,
    totalTokens: data.usage?.total_tokens ?? null
  });

  return {
    text,
    model: data.model ?? DEFAULT_MODEL,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens
    }
  };
}

/**
 * Multimodal chat (text + images). Uses `VISION_MODEL_API_TIMEOUT_MS` when set, else `MODEL_API_TIMEOUT_MS`.
 * Intended for local llama.cpp / OpenAI-compatible vision endpoints.
 */
export async function callQwenChatWithContentParts(
  input: QwenChatWithPartsInput
): Promise<QwenChatResult> {
  const visionTimeoutMs = Number(
    process.env.VISION_MODEL_API_TIMEOUT_MS ?? process.env.MODEL_API_TIMEOUT_MS ?? '30000'
  );
  const requestId = `mv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  logModelDebug('request.vision_start', {
    requestId,
    model: DEFAULT_MODEL,
    messageCount: input.messages.length,
    timeoutMs: visionTimeoutMs
  });

  let response: Response;
  try {
    response = await postChatCompletions(
      {
        model: DEFAULT_MODEL,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 1200
      },
      visionTimeoutMs
    );
  } catch (e) {
    logModelDebug('request.vision_fetch_error', {
      requestId,
      message: e instanceof Error ? e.message : String(e)
    });
    throw e;
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
      status: response.status,
      rawPreview: raw.slice(0, 240)
    });
    throw new Error(`Vision chat request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) {
    throw new Error('Vision chat returned empty content.');
  }

  return {
    text,
    model: data.model ?? DEFAULT_MODEL,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens
    }
  };
}
