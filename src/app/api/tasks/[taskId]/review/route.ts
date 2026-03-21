import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  canReviewTaskStatus,
  getTask,
  reviewTask
} from '@/lib/assistant/task-store';

const reviewPayloadSchema = z.object({
  decision: z.enum(['approved', 'returned']),
  reviewer: z.enum(['sales', 'supervisor']).default('supervisor'),
  comment: z.string().trim().max(400).optional()
});

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;

  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return NextResponse.json(
      {
        error: '任务不存在。'
      },
      { status: 404 }
    );
  }

  if (!canReviewTaskStatus(existingTask.record.status)) {
    return NextResponse.json(
      {
        error: '任务当前状态不允许审核。'
      },
      { status: 403 }
    );
  }

  try {
    const payload = reviewPayloadSchema.parse(await request.json());
    const updated = await reviewTask(
      taskId,
      payload.decision,
      payload.reviewer,
      payload.comment
    );

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
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '审核请求失败。'
      },
      { status: 400 }
    );
  }
}
