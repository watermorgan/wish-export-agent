import type {
  AssistantChannel,
  AssistantReply,
  AssistantRequest
} from '@/lib/assistant/types';

export type ChannelUser = {
  id?: string;
  name?: string;
};

export type ChannelConversation = {
  id?: string;
  threadId?: string;
};

export type NormalizedInboundMessage = {
  channel: AssistantChannel;
  messageText: string;
  files: AssistantRequest['files'];
  user?: ChannelUser;
  conversation?: ChannelConversation;
  rawPayload: unknown;
};

export type ChallengeResult = {
  kind: 'challenge';
  body: Record<string, unknown>;
};

export type UnsupportedResult = {
  kind: 'unsupported';
  reason: string;
};

export type MessageResult = {
  kind: 'message';
  inbound: NormalizedInboundMessage;
};

export type ParsedChannelWebhook =
  | ChallengeResult
  | UnsupportedResult
  | MessageResult;

export type ChannelWebhookResponse = {
  status?: number;
  body: Record<string, unknown>;
};

export type ChannelAdapter = {
  channel: AssistantChannel;
  parseWebhook: (payload: unknown, headers: Headers) => ParsedChannelWebhook;
  formatWebhookResponse: (
    reply: AssistantReply,
    inbound: NormalizedInboundMessage
  ) => ChannelWebhookResponse;
};
