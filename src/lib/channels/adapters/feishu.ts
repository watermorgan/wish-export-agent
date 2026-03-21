import type {
  ChannelAdapter,
  ChannelWebhookResponse,
  ParsedChannelWebhook,
  ChannelConversation
} from '@/lib/channels/types';
import type { AssistantReply, ChannelMessage } from '@/lib/assistant/types';
import { formatReplyAsPlainText } from '@/lib/channels/formatters';

type FeishuEventHeader = {
  event_type?: string;
};

type FeishuEventMessage = {
  chat_id?: string;
  message_id?: string;
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

async function parseFeishuWebhook(payload: unknown): Promise<ParsedChannelWebhook> {
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
        threadId: chatId,
        type: chatId?.startsWith('oc_') ? 'group' : 'p2p'
      },
      rawPayload: payload
    }
  };
}

function buildFeishuSyncResponse(
  parsed: ParsedChannelWebhook
): ChannelWebhookResponse {
  if (parsed.kind === 'challenge') {
    return {
      status: 200,
      body: parsed.body
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      channel: 'feishu',
      note: 'Feishu events should be acknowledged quickly. Use the async send() method for the actual reply.'
    }
  };
}

export const feishuAdapter: ChannelAdapter = {
  channel: 'feishu' as const,

  parseWebhook: async (payload) => parseFeishuWebhook(payload),

  formatSyncResponse: (parsed) => buildFeishuSyncResponse(parsed),

  formatReply: async (reply: AssistantReply): Promise<ChannelMessage> => {
    // V1 Default: Format as plain text for maximum compatibility
    return {
      kind: 'text',
      content: formatReplyAsPlainText(reply)
    };
  },

  send: async (conversation: ChannelConversation, message: ChannelMessage): Promise<void> => {
    console.log(`[FeishuAdapter] Sending async message to ${conversation.id}:`, message.content.slice(0, 50));
    // Implementation: Call Feishu OpenAPI with BOT_TOKEN
    return Promise.resolve();
  }
};
