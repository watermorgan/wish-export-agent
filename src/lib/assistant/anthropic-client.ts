const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest';

type AnthropicTextBlock = {
  type: 'text';
  text: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
};

export function hasAnthropicConfig() {
  return Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

export async function generateAnthropicText(system: string, user: string) {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('未配置可用的模型鉴权，无法执行真实翻译。');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      system,
      messages: [
        {
          role: 'user',
          content: user
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`模型请求失败：${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as AnthropicResponse;
  const text = payload.content?.find((item) => item.type === 'text')?.text?.trim();

  if (!text) {
    throw new Error('模型未返回可用文本内容。');
  }

  return text;
}
