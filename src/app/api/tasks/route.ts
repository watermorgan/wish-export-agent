import { NextResponse } from 'next/server';
import { createAssistantTaskAsync } from '@/lib/assistant/service';
import { readAssistantRequest } from '@/lib/assistant/task-input';
import {
  deleteTasks,
  listTasks
} from '@/lib/assistant/task-store';

export async function GET() {
  return NextResponse.json({
    tasks: await listTasks()
  });
}

export async function POST(request: Request) {
  try {
    const input = await readAssistantRequest(request);
    const snapshot = await createAssistantTaskAsync(input);

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

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as {
      taskIds?: unknown;
    };
    const taskIds = Array.isArray(payload.taskIds)
      ? payload.taskIds.filter((item): item is string => typeof item === 'string')
      : [];

    if (taskIds.length === 0) {
      return NextResponse.json(
        {
          error: '请提供要删除的任务。'
        },
        { status: 400 }
      );
    }

    const result = await deleteTasks(taskIds);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '批量删除任务失败。'
      },
      { status: 400 }
    );
  }
}
