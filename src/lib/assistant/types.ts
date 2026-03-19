export type AssistantChannel = 'web' | 'feishu' | 'slack' | 'wecom';

export type UploadedFile = {
  name: string;
  size: number;
  type: string;
};

export type AssistantRequest = {
  channel: AssistantChannel;
  question: string;
  files: UploadedFile[];
  conversationId?: string;
  userId?: string;
  rawPayload?: unknown;
};

export type AssistantReply = {
  intent: 'summary' | 'reply' | 'quote' | 'handoff';
  intentLabel: string;
  summary: string;
  nextActions: string[];
  riskAlerts: string[];
  draftDirection: string;
};
