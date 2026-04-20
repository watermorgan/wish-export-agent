import { NextResponse } from 'next/server';
import { buildRevisionResponse } from '@/lib/assistant/task-iteration';
import { getTask } from '@/lib/assistant/task-store';

type RouteContext = {
  params: Promise<{
    taskId: string;
    revisionId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { taskId, revisionId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  const response = buildRevisionResponse(task.request, task.reply, revisionId);
  if (!response) {
    return NextResponse.json({ error: 'revision 不存在。' }, { status: 404 });
  }

  return NextResponse.json({
    taskId,
    ...response
  });
}
