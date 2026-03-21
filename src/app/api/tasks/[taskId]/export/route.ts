import { NextResponse } from 'next/server';
import {
  canExportTaskStatus,
  exportTask,
  getTask
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

  if (!canExportTaskStatus(existingTask.record.status)) {
    return NextResponse.json(
      { error: '任务未通过审核，无法生成正式导出产物。' },
      { status: 403 }
    );
  }

  const updated = await exportTask(taskId);

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
