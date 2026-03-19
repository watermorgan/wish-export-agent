import type {
  ChannelAdapter,
  ChannelWebhookResponse
} from '@/lib/channels/types';

export const webAdapter: ChannelAdapter = {
  channel: 'web',
  parseWebhook: () => ({
    kind: 'unsupported',
    reason: 'web_channel_uses_form_post_route'
  }),
  formatWebhookResponse: (
    reply,
    inbound
  ): ChannelWebhookResponse => ({
    status: 200,
    body: {
      ok: true,
      channel: 'web',
      conversationId: inbound.conversation?.id ?? null,
      reply
    }
  })
};
