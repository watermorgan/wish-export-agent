import { NextResponse } from 'next/server';
import { createAssistantTask } from '@/lib/assistant/service';
import { readAssistantRequest } from '@/lib/assistant/task-input';

function isDebugEnabled() {
  return process.env.ASSISTANT_DEBUG_DB === '1';
}

function logDebug(stage: string, meta?: Record<string, unknown>) {
  if (!isDebugEnabled()) {
    return;
  }

  if (meta) {
    console.log(`[api/assistant] ${stage}`, meta);
    return;
  }

  console.log(`[api/assistant] ${stage}`);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const traceId = `assist_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    logDebug('request.start', { traceId });
    const input = await readAssistantRequest(request);
    logDebug('request.input_ready', { traceId, elapsedMs: Date.now() - startedAt });
    const snapshot = await createAssistantTask(input);
    logDebug('request.task_saved', { traceId, elapsedMs: Date.now() - startedAt });

    return NextResponse.json({
      ...snapshot.reply,
      task: snapshot.task,
      recentTasks: snapshot.recentTasks
    });
  } catch (error) {
    logDebug('request.failed', {
      traceId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown error'
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '请求失败，请稍后再试。'
      },
      { status: 400 }
    );
  }
}
