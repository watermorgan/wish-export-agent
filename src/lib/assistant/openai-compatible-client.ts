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
  delta?: {
    content?:
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

function extractTextContent(
  content:
    | string
    | Array<{
        type?: 'text';
        text?: string;
      }>
    | undefined
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

  for (let attempt = 0; attempt <= EMPTY_TEXT_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
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

      throw new Error(`${label} 未返回可用文本内容。原始响应：${raw.slice(0, 800)}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${label} 请求超时（>${timeoutMs}ms）。`);
      }

      throw error;
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

  for (let attempt = 0; attempt <= EMPTY_TEXT_RETRY_LIMIT; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(normalizeResponsesEndpoint(baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
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

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${label} 未返回可用文本内容。`);
}
