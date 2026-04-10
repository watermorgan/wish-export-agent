import { NextResponse } from 'next/server';
import { getTask } from '@/lib/assistant/task-store';
import { buildOpenClawPdfTranslationPayload } from '@/lib/assistant/pdf-translation-skill';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  const payload = buildOpenClawPdfTranslationPayload(task.record, task.reply);

  if (!payload) {
    return NextResponse.json(
      { error: '当前任务尚未生成可供 skill/OpenClaw 复用的 PDF 结果协议。' },
      { status: 409 }
    );
  }

  return NextResponse.json(payload);
}
