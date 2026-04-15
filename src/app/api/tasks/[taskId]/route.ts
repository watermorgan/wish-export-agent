import { NextResponse } from 'next/server';
import {
  AssistantTaskServiceError,
  getAssistantTaskSnapshot,
  runAssistant
} from '@/lib/assistant/service';
import { applyTaskPatch, readTaskPatch } from '@/lib/assistant/task-input';
import {
  canEditTaskStatus,
  deleteTask,
  getTask,
  updateTaskFromExecution
} from '@/lib/assistant/task-store';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { taskId } = await context.params;
  try {
    return NextResponse.json(await getAssistantTaskSnapshot(taskId));
  } catch (error) {
    if (error instanceof AssistantTaskServiceError) {
      return NextResponse.json(
        {
          error: error.message
        },
        { status: error.status }
      );
    }

    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const existing = await getTask(taskId);

  if (!existing) {
    return NextResponse.json(
      {
        error: '任务不存在。'
      },
      { status: 404 }
    );
  }

  if (!canEditTaskStatus(existing.record.status)) {
    return NextResponse.json(
      {
        error: '任务当前状态不允许编辑。'
      },
      { status: 403 }
    );
  }

  try {
    const patch = readTaskPatch(await request.json());
    const input = applyTaskPatch(existing.request, patch);
    const reply = await runAssistant(input);
    const snapshot = await updateTaskFromExecution(taskId, input, reply);

    if (!snapshot) {
      return NextResponse.json(
        {
          error: '任务不存在。'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      task: snapshot.task,
      reply: snapshot.reply,
      recentTasks: snapshot.recentTasks
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '更新任务失败。'
      },
      { status: 400 }
    );
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const deleted = await deleteTask(taskId);

  if (!deleted) {
    return NextResponse.json(
      {
        error: '任务不存在。'
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true
  });
}
