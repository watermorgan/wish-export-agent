export type LlmRequest = {
  system: string;
  user: string;
  timeoutMs?: number;
  modelOverride?: string;
};

export type LlmProviderName =
  | 'dashscope'
  | 'modelscope'
  | 'glm'
  | 'local-openai'
  | 'gemini-cli'
  | 'anthropic'
  | 'claude-cli'
  | 'codex-cli';

export type LlmProviderResult = {
  provider: LlmProviderName;
  text: string;
  model?: string;
};

export type LlmProvider = {
  name: LlmProviderName;
  isAvailable: () => boolean;
  generate: (request: LlmRequest) => Promise<LlmProviderResult>;
};
