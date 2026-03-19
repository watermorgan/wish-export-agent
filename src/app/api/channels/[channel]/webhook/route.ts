import { NextResponse } from 'next/server';
import { runAssistant } from '@/lib/assistant/service';
import { getChannelAdapter, toAssistantRequest } from '@/lib/channels/registry';

type RouteContext = {
  params: Promise<{
    channel: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { channel } = await context.params;
  const adapter = getChannelAdapter(channel);

  if (!adapter) {
    return NextResponse.json(
      {
        error: `Unsupported channel: ${channel}`
      },
      { status: 404 }
    );
  }

  const payload = await request.json().catch(() => null);
  const parsed = adapter.parseWebhook(payload, request.headers);

  if (parsed.kind === 'challenge') {
    return NextResponse.json(parsed.body, { status: 200 });
  }

  if (parsed.kind === 'unsupported') {
    return NextResponse.json(
      {
        ok: true,
        ignored: true,
        reason: parsed.reason
      },
      { status: 200 }
    );
  }

  const reply = await runAssistant(toAssistantRequest(parsed.inbound));
  const response = adapter.formatWebhookResponse(reply, parsed.inbound);

  return NextResponse.json(response.body, {
    status: response.status ?? 200
  });
}
