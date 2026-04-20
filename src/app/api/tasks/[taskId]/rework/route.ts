import { NextResponse } from 'next/server';
import { runAssistant } from '@/lib/assistant/service';
import { readTaskRework } from '@/lib/assistant/task-input';
import {
  buildTaskRevisionSummary,
  createReworkRevisionRequest,
  finalizeLatestTaskRevision,
  findTranslationSnapshot,
  replaceReworkTargetPages
} from '@/lib/assistant/task-iteration';
import {
  canEditTaskStatus,
  getTask,
  updateTaskFromExecution
} from '@/lib/assistant/task-store';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const existing = await getTask(taskId);

  if (!existing) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  if (!canEditTaskStatus(existing.record.status)) {
    return NextResponse.json({ error: '任务当前状态不允许提交返工。' }, { status: 403 });
  }

  try {
    const payload = readTaskRework(await request.json());
    const baselineSnapshot = findTranslationSnapshot(existing.reply);
    const targetPages = [...new Set(payload.pageNumbers ?? [])].sort((left, right) => left - right);
    if (payload.scope === 'pages' && targetPages.length === 0) {
      return NextResponse.json({ error: 'page-scoped rework 至少需要一个有效页码。' }, { status: 400 });
    }

    const nextRequest = createReworkRevisionRequest(
      existing.request,
      taskId,
      payload.actor,
      payload.reason ?? payload.instruction,
      replaceReworkTargetPages(payload, targetPages),
      baselineSnapshot
    );

    try {
      const reply = await runAssistant(nextRequest);
      const finalizedRequest = finalizeLatestTaskRevision(nextRequest, 'ready');
      const snapshot = await updateTaskFromExecution(taskId, finalizedRequest, reply);

      if (!snapshot) {
        return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
      }

      return NextResponse.json({
        task: snapshot.task,
        reply: snapshot.reply,
        revision:
          snapshot.reply.metadata?.taskIteration?.latestRevision ??
          snapshot.reply.metadata?.taskIteration
      });
    } catch (error) {
      const failedRevisionId = buildTaskRevisionSummary(nextRequest)?.currentRevisionId;
      const failedRequest = finalizeLatestTaskRevision(nextRequest, 'failed');
      await updateTaskFromExecution(taskId, failedRequest, existing.reply);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : '返工执行失败。',
          failedRevisionId,
          revisionLookupUrl: failedRevisionId
            ? `/api/tasks/${encodeURIComponent(taskId)}/revisions/${encodeURIComponent(failedRevisionId)}`
            : null
        },
        { status: 409 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交返工失败。' },
      { status: 400 }
    );
  }
}
