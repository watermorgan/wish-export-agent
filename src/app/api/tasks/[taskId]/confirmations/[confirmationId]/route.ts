import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  canUpdateConfirmationStatus,
  getTask,
  updateTaskConfirmation
} from '@/lib/assistant/task-store';

const confirmationPatchSchema = z.object({
  status: z.enum(['required', 'recommended', 'confirmed', 'returned'])
});

type RouteContext = {
  params: Promise<{
    taskId: string;
    confirmationId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { taskId, confirmationId } = await context.params;

  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  if (!canUpdateConfirmationStatus(existingTask.record.status)) {
    return NextResponse.json(
      { error: '任务当前状态不允许修改待确认项。' },
      { status: 403 }
    );
  }

  const existingConfirmation = existingTask.reply.pendingConfirmations.find(
    (item) => item.id === confirmationId
  );

  if (!existingConfirmation) {
    return NextResponse.json({ error: '待确认项不存在。' }, { status: 404 });
  }

  try {
    const payload = confirmationPatchSchema.parse(await request.json());
    const updated = await updateTaskConfirmation(taskId, confirmationId, {
      status: payload.status
    });

    if (!updated) {
      return NextResponse.json({ error: '更新失败。' }, { status: 500 });
    }

    return NextResponse.json({
      task: updated.record,
      reply: updated.reply
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新待确认项失败。' },
      { status: 400 }
    );
  }
}
