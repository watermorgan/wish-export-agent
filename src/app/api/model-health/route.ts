import { NextResponse } from 'next/server';

type ProviderHealth = {
  provider: 'local-openai' | 'dashscope' | 'modelscope';
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
};

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim())?.trim() ?? '';
}

function buildLocalModelsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions')
    ? trimmed.replace(/\/chat\/completions$/i, '/models')
    : `${trimmed}/models`;
}

async function checkLocalOpenAi(): Promise<ProviderHealth> {
  const baseUrl = firstNonEmpty(process.env.LOCAL_OPENAI_API_URL, process.env.LOCAL_MODEL_API_URL);
  const localLabel =
    firstNonEmpty(
      process.env.LOCAL_OPENAI_MODEL_NAME,
      process.env.LOCAL_MODEL_NAME,
      process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL_NAME
    ) || 'Local OpenAI-compatible';

  if (!baseUrl) {
    return {
      provider: 'local-openai',
      label: localLabel,
      status: 'warning',
      detail: '未配置本地模型地址。'
    };
  }

  try {
    const response = await fetch(buildLocalModelsUrl(baseUrl), {
      headers: {
        ...(firstNonEmpty(process.env.LOCAL_OPENAI_API_KEY, process.env.LOCAL_MODEL_API_KEY)
          ? {
              Authorization: `Bearer ${firstNonEmpty(
                process.env.LOCAL_OPENAI_API_KEY,
                process.env.LOCAL_MODEL_API_KEY
              )}`
            }
          : {})
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        provider: 'local-openai',
        label: localLabel,
        status: 'error',
        detail: `本地模型服务返回 ${response.status}。`
      };
    }

    return {
      provider: 'local-openai',
      label: localLabel,
      status: 'ok',
      detail: '本地模型服务可连接。'
    };
  } catch {
    return {
      provider: 'local-openai',
      label: localLabel,
      status: 'error',
      detail: '无法连接本地模型服务，请检查 VPN 或服务进程。'
    };
  }
}

async function checkDashScope(): Promise<ProviderHealth> {
  if (!process.env.DASHSCOPE_API_KEY) {
    return {
      provider: 'dashscope',
      label: 'Qwen 3.5 Flash',
      status: 'warning',
      detail: '未配置 DashScope API Key。'
    };
  }

  try {
    const response = await fetch(
      firstNonEmpty(
        process.env.DASHSCOPE_API_URL,
        'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1'
      ).replace(/\/+$/, '') + '/responses',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.DASHSCOPE_MODEL ?? 'qwen3.5-flash',
          input: [
            { role: 'system', content: 'You are a health check.' },
            { role: 'user', content: 'reply with ok' }
          ],
          max_output_tokens: 8
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (response.ok) {
      return {
        provider: 'dashscope',
        label: 'Qwen 3.5 Flash',
        status: 'ok',
        detail: 'DashScope 当前可用。'
      };
    }

    const raw = await response.text();
    return {
      provider: 'dashscope',
      label: 'Qwen 3.5 Flash',
      status: 'error',
      detail: raw.includes('AllocationQuota.FreeTierOnly')
        ? 'DashScope 免费额度已耗尽。'
        : `DashScope 返回 ${response.status}。`
    };
  } catch {
    return {
      provider: 'dashscope',
      label: 'Qwen 3.5 Flash',
      status: 'error',
      detail: 'DashScope 连接失败。'
    };
  }
}

async function checkModelScope(): Promise<ProviderHealth> {
  if (!process.env.MODELSCOPE_API_KEY) {
    return {
      provider: 'modelscope',
      label: 'Qwen 3.5 397B A17B',
      status: 'warning',
      detail: '未配置 ModelScope API Key。'
    };
  }

  try {
    const response = await fetch(
      firstNonEmpty(
        process.env.MODELSCOPE_API_URL,
        'https://api-inference.modelscope.cn/v1/chat/completions'
      ),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.MODELSCOPE_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.MODELSCOPE_MODEL ?? 'Qwen/Qwen3.5-397B-A17B',
          messages: [
            { role: 'system', content: 'You are a health check.' },
            { role: 'user', content: 'reply with ok' }
          ],
          max_tokens: 8
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (response.ok) {
      return {
        provider: 'modelscope',
        label: 'Qwen 3.5 397B A17B',
        status: 'ok',
        detail: 'ModelScope 当前可用。'
      };
    }

    const raw = await response.text();
    return {
      provider: 'modelscope',
      label: 'Qwen 3.5 397B A17B',
      status: 'error',
      detail: raw.includes('Authentication failed')
        ? 'ModelScope token 无效。'
        : `ModelScope 返回 ${response.status}。`
    };
  } catch {
    return {
      provider: 'modelscope',
      label: 'Qwen 3.5 397B A17B',
      status: 'error',
      detail: 'ModelScope 连接失败。'
    };
  }
}

export async function GET() {
  const providers = await Promise.all([
    checkLocalOpenAi(),
    checkDashScope(),
    checkModelScope()
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    providers
  });
}
