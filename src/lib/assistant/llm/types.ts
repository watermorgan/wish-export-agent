export type LlmRequest = {
  system: string;
  user: string;
  timeoutMs?: number;
};

export type LlmProviderName =
  | 'modelscope'
  | 'gemini-cli'
  | 'anthropic'
  | 'claude-cli'
  | 'codex-cli';

export type LlmProviderResult = {
  provider: LlmProviderName;
  text: string;
};

export type LlmProvider = {
  name: LlmProviderName;
  isAvailable: () => boolean;
  generate: (request: LlmRequest) => Promise<LlmProviderResult>;
};
