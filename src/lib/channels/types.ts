import type {
  AssistantChannel,
  AssistantReply,
  AssistantRequest,
  ChannelMessage
} from '@/lib/assistant/types';

export type ChannelUser = {
  id?: string;
  name?: string;
  email?: string;
};

export type ChannelConversation = {
  id?: string;
  threadId?: string;
  type?: 'p2p' | 'group';
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

export type ActionEventResult = {
  kind: 'action';
  actionId: string;
  taskId: string;
  value?: string;
  inbound: NormalizedInboundMessage;
};

export type ParsedChannelWebhook =
  | ChallengeResult
  | UnsupportedResult
  | MessageResult
  | ActionEventResult;

export type ChannelWebhookResponse = {
  status?: number;
  body: Record<string, unknown>;
};

/**
 * ChannelAdapter is the contract for each platform-specific integration.
 * It handles the conversion between raw platform events and normalized
 * assistant requests/replies.
 */
export interface ChannelAdapter {
  readonly channel: AssistantChannel;

  // 1. Inbound: Parsing platform webhooks (sync)
  parseWebhook(payload: unknown, headers: Headers): Promise<ParsedChannelWebhook>;

  // 2. Outbound (Sync): Immediate response to a webhook (e.g. challenge or quick ACK)
  formatSyncResponse(parsed: ParsedChannelWebhook): ChannelWebhookResponse;

  // 3. Outbound (Async): Preparing a rich message from a reply snapshot
  formatReply(reply: AssistantReply): Promise<ChannelMessage>;

  // 4. Delivery: Sending a message to the specific conversation (e.g. via Bot API)
  send(conversation: ChannelConversation, message: ChannelMessage): Promise<void>;

  // 5. Update: Updating an existing message (if supported by channel)
  update?(messageId: string, message: ChannelMessage): Promise<void>;
}

