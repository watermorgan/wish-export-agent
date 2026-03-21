import type {
  ChannelAdapter,
  ChannelConversation
} from '@/lib/channels/types';
import type { AssistantReply, ChannelMessage } from '@/lib/assistant/types';

export const webAdapter: ChannelAdapter = {
  channel: 'web' as const,

  parseWebhook: async () => ({
    kind: 'unsupported',
    reason: 'web_channel_uses_form_post_route'
  }),

  formatSyncResponse: () => ({
    status: 200,
    body: { ok: true }
  }),

  formatReply: async (reply: AssistantReply): Promise<ChannelMessage> => {
    return {
      kind: 'card', // Web workspace handles the rich object as a 'card'
      content: reply.summary,
      metadata: { reply }
    };
  },

  send: async (conversation: ChannelConversation): Promise<void> => {
    // Web channel is usually handled via direct API response,
    // but we could use Server-Sent Events or WebSockets here in the future.
    console.log(`[WebAdapter] Logic for pushing async message to ${conversation.id}`);
    return Promise.resolve();
  }
};
