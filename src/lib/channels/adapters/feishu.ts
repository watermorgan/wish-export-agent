import type {
  ChannelAdapter,
  ChannelWebhookResponse,
  NormalizedInboundMessage,
  ParsedChannelWebhook
} from '@/lib/channels/types';
import { formatReplyAsPlainText } from '@/lib/channels/formatters';

type FeishuEventHeader = {
  event_type?: string;
};

type FeishuEventMessage = {
  chat_id?: string;
  message_type?: string;
  content?: string;
};

type FeishuEventPayload = {
  type?: string;
  challenge?: string;
  header?: FeishuEventHeader;
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
      };
    };
    message?: FeishuEventMessage;
  };
};

function parseFeishuText(content: string | undefined) {
  if (!content) {
    return '';
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? '';
  } catch {
    return content.trim();
  }
}

function buildUnsupported(reason: string): ParsedChannelWebhook {
  return {
    kind: 'unsupported',
    reason
  };
}

function parseFeishuWebhook(payload: unknown): ParsedChannelWebhook {
  const body = (payload ?? {}) as FeishuEventPayload;

  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return {
      kind: 'challenge',
      body: {
        challenge: body.challenge
      }
    };
  }

  if (body.header?.event_type !== 'im.message.receive_v1') {
    return buildUnsupported('unsupported_event_type');
  }

  if (body.event?.message?.message_type !== 'text') {
    return buildUnsupported('only_text_message_is_supported_for_now');
  }

  const messageText = parseFeishuText(body.event.message.content);

  if (!messageText) {
    return buildUnsupported('empty_text_message');
  }

  const sender = body.event.sender?.sender_id;
  const chatId = body.event.message.chat_id;

  return {
    kind: 'message',
    inbound: {
      channel: 'feishu',
      messageText,
      files: [],
      user: {
        id: sender?.open_id ?? sender?.user_id ?? sender?.union_id
      },
      conversation: {
        id: chatId,
        threadId: chatId
      },
      rawPayload: payload
    }
  };
}

function buildFeishuResponse(
  reply: Parameters<ChannelAdapter['formatWebhookResponse']>[0],
  inbound: NormalizedInboundMessage
): ChannelWebhookResponse {
  return {
    status: 200,
    body: {
      ok: true,
      channel: 'feishu',
      delivery: 'out_of_band',
      conversationId: inbound.conversation?.id ?? null,
      preview: {
        msg_type: 'text',
        content: {
          text: formatReplyAsPlainText(reply)
        }
      },
      note: 'Feishu event callbacks should ack quickly. Send the preview via Feishu send-message API or bot webhook in an async worker later.'
    }
  };
}

export const feishuAdapter: ChannelAdapter = {
  channel: 'feishu',
  parseWebhook: (payload) => parseFeishuWebhook(payload),
  formatWebhookResponse: (reply, inbound) => buildFeishuResponse(reply, inbound)
};
