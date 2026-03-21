import { NextResponse } from 'next/server';
import {
  canSubmitTaskStatus,
  getTask,
  submitTaskForReview
} from '@/lib/assistant/task-store';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { taskId } = await context.params;

  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  if (!canSubmitTaskStatus(existingTask.record.status)) {
    return NextResponse.json(
      { error: '任务当前状态不允许提交审核。' },
      { status: 403 }
    );
  }

  const unconfirmedRequired = existingTask.reply.pendingConfirmations.filter(
    (c) => c.status === 'required'
  );

  if (unconfirmedRequired.length > 0) {
    return NextResponse.json(
      {
        error: '存在未处理的必须确认项，无法提交审核。',
        unconfirmedCount: unconfirmedRequired.length
      },
      { status: 400 }
    );
  }

  const updated = await submitTaskForReview(taskId);

  if (!updated) {
    return NextResponse.json(
      {
        error: '任务处理失败。'
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    task: updated.record,
    reply: updated.reply
  });
}
