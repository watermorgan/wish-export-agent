import { NextResponse } from 'next/server';
import { runAssistant } from '@/lib/assistant/service';
import { readAssistantRequest } from '@/lib/assistant/task-input';
import { createTaskFromExecution, listTasks } from '@/lib/assistant/task-store';

export async function GET() {
  return NextResponse.json({
    tasks: await listTasks()
  });
}

export async function POST(request: Request) {
  try {
    const input = await readAssistantRequest(request);
    const reply = await runAssistant(input);
    const snapshot = await createTaskFromExecution(input, reply);

    return NextResponse.json({
      task: snapshot.task,
      reply: snapshot.reply,
      recentTasks: snapshot.recentTasks
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '创建任务失败。'
      },
      { status: 400 }
    );
  }
}
