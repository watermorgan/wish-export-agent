type OpenAiCompatibleMessageContent =
  | string
  | Array<{
      type: 'text';
      text: string;
    }>;

type OpenAiCompatibleMessage = {
  role: 'system' | 'user' | 'assistant';
  content: OpenAiCompatibleMessageContent;
};

type OpenAiCompatibleChoice = {
  finish_reason?: string;
  reasoning_content?: string;
  delta?: {
    content?:
      | string
      | Array<{
          type?: 'text';
          text?: string;
        }>;
    reasoning_content?:
      | string
      | Array<{
          type?: 'text';
          text?: string;
        }>;
  };
  message?: {
    content?:
      | string
      | Array<{
          type?: 'text';
          text?: string;
        }>;
    reasoning_content?:
      | string
      | Array<{
          type?: 'text';
          text?: string;
        }>;
  };
};

type OpenAiCompatibleResponse = {
  choices?: OpenAiCompatibleChoice[];
};

type GenerateOpenAiCompatibleTextOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
  label: string;
};

type GenerateResponsesCompatibleTextOptions = GenerateOpenAiCompatibleTextOptions;

type ResponsesCompatibleResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const EMPTY_TEXT_RETRY_LIMIT = Number(process.env.OPENAI_COMPAT_EMPTY_TEXT_RETRY_LIMIT ?? '2');
const EMPTY_TEXT_RETRY_BACKOFF_MS = Number(
  process.env.OPENAI_COMPAT_EMPTY_TEXT_RETRY_BACKOFF_MS ?? '1200'
);

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

function maybeWrapVpnError(baseUrl: string, error: unknown) {
  if (!isApiKeyOptional(baseUrl)) {
    return error;
  }
  return new Error(
    `无法连接本地模型服务 ${baseUrl}。请先连接 VPN，并确认对应模型服务可用后重试。`
  );
}

function extractTextContent(
  content: unknown
) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function describeEmptyChatResponse(payload: OpenAiCompatibleResponse) {
  const choice = payload.choices?.[0];
  const finishReason = choice?.finish_reason?.trim();
  const reasoning =
    extractTextContent(choice?.message?.reasoning_content) ||
    extractTextContent(choice?.delta?.reasoning_content) ||
    extractTextContent(choice?.reasoning_content);

  if (finishReason === 'length') {
    return '返回被 finish_reason=length 截断，需提高 max_tokens 或降低单次输出规模。';
  }

  if (reasoning) {
    return '仅返回 reasoning_content / thinking，没有稳定的 assistant content；请在 llama.cpp 部署侧确保最终答案写入 message.content。';
  }

  return '响应中未找到可用的 assistant content。';
}

function normalizeResponsesEndpoint(baseUrlOrEndpoint: string) {
  const trimmed = baseUrlOrEndpoint.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Responses API URL is missing.');
  }
  if (/\/responses$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/responses`;
}

function extractResponsesText(payload: ResponsesCompatibleResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks =
    payload.output?.flatMap((item) =>
      (item.content ?? [])
        .map((contentItem) => contentItem.text?.trim() ?? '')
        .filter(Boolean)
    ) ?? [];

  return chunks.join('\n').trim();
}

export async function generateOpenAiCompatibleText({
  apiKey,
  baseUrl,
  model,
  system,
  user,
  timeoutMs = 120000,
  label
}: GenerateOpenAiCompatibleTextOptions) {
  const messages: OpenAiCompatibleMessage[] = [
    {
      role: 'system',
      content: system
    },
    {
      role: 'user',
      content: user
    }
  ];

  if (!apiKey && !isApiKeyOptional(baseUrl)) {
    throw new Error(`${label} 缺少 API Key。`);
  }

  for (let attempt = 0; attempt <= EMPTY_TEXT_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          stream: false,
          messages
        }),
        signal: controller.signal
      });

      const raw = await response.text();

      if (!response.ok) {
        throw new Error(`${label} 请求失败：${response.status} ${raw}`);
      }

      const payload = JSON.parse(raw) as OpenAiCompatibleResponse;
      const text =
        extractTextContent(payload.choices?.[0]?.message?.content) ||
        extractTextContent(payload.choices?.[0]?.delta?.content);

      if (text) {
        return text;
      }

      if (attempt < EMPTY_TEXT_RETRY_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, EMPTY_TEXT_RETRY_BACKOFF_MS));
        continue;
      }

      const issue = describeEmptyChatResponse(payload);
      throw new Error(`${label} 未返回可用文本内容。${issue} 原始响应：${raw.slice(0, 800)}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${label} 请求超时（>${timeoutMs}ms）。`);
      }

      throw maybeWrapVpnError(baseUrl, error);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${label} 未返回可用文本内容。`);
}

export async function generateResponsesCompatibleText({
  apiKey,
  baseUrl,
  model,
  system,
  user,
  timeoutMs = 120000,
  label
}: GenerateResponsesCompatibleTextOptions) {
  const input = [
    {
      role: 'system',
      content: system
    },
    {
      role: 'user',
      content: user
    }
  ];

  if (!apiKey && !isApiKeyOptional(baseUrl)) {
    throw new Error(`${label} 缺少 API Key。`);
  }

  for (let attempt = 0; attempt <= EMPTY_TEXT_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(normalizeResponsesEndpoint(baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          input
        }),
        signal: controller.signal
      });

      const raw = await response.text();

      if (!response.ok) {
        throw new Error(`${label} 请求失败：${response.status} ${raw}`);
      }

      const payload = JSON.parse(raw) as ResponsesCompatibleResponse;
      const text = extractResponsesText(payload);

      if (text) {
        return text;
      }

      if (attempt < EMPTY_TEXT_RETRY_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, EMPTY_TEXT_RETRY_BACKOFF_MS));
        continue;
      }

      throw new Error(`${label} 未返回可用文本内容。原始响应：${raw.slice(0, 800)}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${label} 请求超时（>${timeoutMs}ms）。`);
      }

      throw maybeWrapVpnError(baseUrl, error);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${label} 未返回可用文本内容。`);
}
