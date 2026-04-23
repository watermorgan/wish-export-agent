import { NextResponse } from 'next/server';
import { updatePdfTranslationSkillPayload } from '@/lib/assistant/pdf-translation-skill';
import { readTaskOverride } from '@/lib/assistant/task-input';
import {
  buildTaskRevisionSummary,
  createOverrideRevisionRequest,
  finalizeLatestTaskRevision
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
    return NextResponse.json({ error: '任务当前状态不允许提交页面覆盖。' }, { status: 403 });
  }

  try {
    const rawBody = await request.json();

    // Pre-zod deep check: reject forceVisionPages / force_vision anywhere in pageOverrides
    const rawOverrides = rawBody?.pageOverrides;
    if (rawOverrides && typeof rawOverrides === 'object') {
      const jsonStr = JSON.stringify(rawOverrides);
      if (jsonStr.includes('forceVisionPages') || jsonStr.includes('force_vision')) {
        return NextResponse.json(
          { error: 'forceVisionPages / force_vision 不允许在 override 中使用，请改用 rework。' },
          { status: 400 }
        );
      }
    }

    const payload = readTaskOverride(rawBody);
    const nextRequest = createOverrideRevisionRequest(
      existing.request,
      taskId,
      payload.actor,
      payload.reason,
      payload.pageOverrides
    );



    {
      const finalizedRequest = finalizeLatestTaskRevision(nextRequest, 'ready');
      const revisionSummary = buildTaskRevisionSummary(finalizedRequest);
      const skippedTranslationPages = Array.from(
        new Set([
          ...(revisionSummary?.currentControl?.pageOverrides?.skipTranslationPages ?? []),
          ...((revisionSummary?.currentControl?.pageOverrides?.pageDirectives ?? [])
            .filter(
              (directive) =>
                directive.action === 'skip_translation' || directive.action === 'keep_original'
            )
            .map((directive) => directive.pageNumber))
        ])
      ).sort((left, right) => left - right);
      const updatedReply = updatePdfTranslationSkillPayload({
        ...existing.reply,
        metadata: {
          ...existing.reply.metadata,
          needsHumanReview: existing.reply.metadata?.needsHumanReview ?? true,
          taskIteration: revisionSummary
        }
      }, (skillPayload) => ({
        ...skillPayload,
        revision: revisionSummary
          ? {
              id: revisionSummary.currentRevisionId,
              kind: revisionSummary.latestRevision?.kind ?? 'base',
              parentRevisionId: revisionSummary.latestRevision?.parentRevisionId ?? null,
              revisionCount: revisionSummary.revisionCount,
              currentControl: revisionSummary.currentControl ?? null
            }
          : skillPayload.revision,
        diagnostics: {
          ...skillPayload.diagnostics,
          skippedTranslationPages
        }
      }));
      const snapshot = await updateTaskFromExecution(taskId, finalizedRequest, updatedReply);

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
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交页面覆盖失败。' },
      { status: 400 }
    );
  }
}
