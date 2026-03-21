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

export async function generateOpenAiCompatibleText({
  apiKey,
  baseUrl,
  model,
  system,
  user,
  timeoutMs = 120000,
  label
}: GenerateOpenAiCompatibleTextOptions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    if (!response.ok) {
      throw new Error(`${label} 请求失败：${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as OpenAiCompatibleResponse;
    const text = extractTextContent(payload.choices?.[0]?.message?.content);

    if (!text) {
      throw new Error(`${label} 未返回可用文本内容。`);
    }

    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} 请求超时（>${timeoutMs}ms）。`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
