import type { AssistantRequest } from '@/lib/assistant/types';
import { feishuAdapter } from '@/lib/channels/adapters/feishu';
import { webAdapter } from '@/lib/channels/adapters/web';
import type { ChannelAdapter, NormalizedInboundMessage } from '@/lib/channels/types';

const adapters: Record<string, ChannelAdapter> = {
  web: webAdapter,
  feishu: feishuAdapter
};

export function getChannelAdapter(channel: string) {
  return adapters[channel] ?? null;
}

export function toAssistantRequest(
  inbound: NormalizedInboundMessage
): AssistantRequest {
  return {
    channel: inbound.channel,
    question: inbound.messageText,
    files: inbound.files,
    conversationId: inbound.conversation?.threadId ?? inbound.conversation?.id,
    userId: inbound.user?.id,
    rawPayload: inbound.rawPayload
  };
}
