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
  const parsed = await adapter.parseWebhook(payload, request.headers);

  // 1. Handle special platform events (like URL verification challenges)
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

  // 2. Handle Message events
  if (parsed.kind === 'message') {
    // Note: In a production environment with strict timeout (like Feishu 3s),
    // we should acknowledge the message here and move assistant logic to a background worker.
    // For V1 MVP, we process sequentially but use the new adapter contract.
    await runAssistant(toAssistantRequest(parsed.inbound));
    
    // In async mode, we would use:
    // const message = await adapter.formatReply(reply);
    // await adapter.send(parsed.inbound.conversation!, message);
    
    // For the sync HTTP response:
    const syncRes = adapter.formatSyncResponse(parsed);
    return NextResponse.json(syncRes.body, { status: syncRes.status ?? 200 });
  }

  // 3. Handle Action events (e.g. card button clicks)
  if (parsed.kind === 'action') {
    // Logic for handling interactive button clicks
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
