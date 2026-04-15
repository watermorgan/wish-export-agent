import {
  buildBlockedExecutionReply,
  buildValidatingExecutionReply,
  prepareAssistantExecution,
  runAssistant
} from '@/lib/assistant/execution';
import { buildTingPdfTranslationPayload } from '@/lib/assistant/pdf-translation-skill';
import {
  createTaskFromExecution,
  getTask,
  updateTaskFromExecution
} from '@/lib/assistant/task-store';
import type {
  AssistantRequest,
  AssistantReply,
  AssistantReplyMetadata,
  TaskRecord
} from '@/lib/assistant/types';

export class AssistantTaskServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AssistantTaskServiceError';
    this.status = status;
  }
}

export type AssistantTaskSnapshot = {
  task: TaskRecord;
  reply: AssistantReply;
};

const backgroundExecutions = new Map<string, Promise<void>>();

function buildAsyncProgress(
  phase: NonNullable<AssistantReplyMetadata['asyncProgress']>['phase'],
  submittedAt: string,
  overrides: Partial<NonNullable<AssistantReplyMetadata['asyncProgress']>> = {}
) {
  return {
    phase,
    submittedAt,
    ...overrides
  } satisfies NonNullable<AssistantReplyMetadata['asyncProgress']>;
}

export async function createAssistantTask(input: AssistantRequest) {
  const reply = await runAssistant(input);
  return createTaskFromExecution(input, reply);
}

async function runAssistantTaskInBackground(
  taskId: string,
  input: AssistantRequest,
  submittedAt: string
) {
  const startedAt = new Date().toISOString();

  const prepared = prepareAssistantExecution(input);
  const runningReply = buildValidatingExecutionReply(
    input,
    prepared,
    buildAsyncProgress('running', submittedAt, {
      stage: 'pipeline',
      startedAt,
      updatedAt: startedAt
    })
  );
  await updateTaskFromExecution(taskId, input, runningReply);

  const minDelayMs = Math.max(0, Number(process.env.ASSISTANT_ASYNC_MIN_DELAY_MS ?? '0'));
  if (minDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, minDelayMs));
  }

  try {
    const reply = await runAssistant(input);
    const completedAt = new Date().toISOString();
    const finalReply: AssistantReply = {
      ...reply,
      metadata: {
        needsHumanReview: reply.metadata?.needsHumanReview ?? true,
        ...(reply.metadata ?? {}),
        asyncProgress: buildAsyncProgress('completed', submittedAt, {
          stage: 'complete',
          startedAt,
          updatedAt: completedAt,
          completedAt
        })
      }
    };
    await updateTaskFromExecution(taskId, input, finalReply);
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failedReply: AssistantReply = {
      ...buildBlockedExecutionReply(input, prepared),
      status: 'failed',
      statusLabel: '执行失败',
      summary: '后台翻译执行失败，请查看错误信息后重试。',
      nextActions: ['检查模型服务与输入文件后重试当前任务。'],
      riskAlerts: [
        error instanceof Error ? error.message : String(error)
      ],
      auditTrail: [
        ...buildBlockedExecutionReply(input, prepared).auditTrail,
        {
          label: '异步执行失败',
          detail: error instanceof Error ? error.message : String(error)
        }
      ],
      metadata: {
        needsHumanReview: true,
        providerHits: [],
        modelHits: [],
        translationMode: 'real',
        asyncProgress: buildAsyncProgress('failed', submittedAt, {
          stage: 'failed',
          startedAt,
          updatedAt: failedAt,
          completedAt: failedAt
        })
      }
    };
    await updateTaskFromExecution(taskId, input, failedReply);
  } finally {
    backgroundExecutions.delete(taskId);
  }
}

export async function createAssistantTaskAsync(input: AssistantRequest) {
  const prepared = prepareAssistantExecution(input);
  const submittedAt = new Date().toISOString();

  if (prepared.blocked) {
    return createTaskFromExecution(input, buildBlockedExecutionReply(input, prepared));
  }

  const queuedReply = buildValidatingExecutionReply(
    input,
    prepared,
    buildAsyncProgress('queued', submittedAt, {
      stage: 'submit',
      updatedAt: submittedAt
    })
  );
  const snapshot = await createTaskFromExecution(input, queuedReply);
  const execution = runAssistantTaskInBackground(snapshot.task.id, input, submittedAt);
  backgroundExecutions.set(snapshot.task.id, execution);
  return snapshot;
}

export async function getAssistantTaskSnapshot(taskId: string): Promise<AssistantTaskSnapshot> {
  const task = await getTask(taskId);

  if (!task) {
    throw new AssistantTaskServiceError(404, '任务不存在。');
  }

  return {
    task: task.record,
    reply: task.reply
  };
}

export async function getTingPdfTranslationTaskPayload(taskId: string) {
  const task = await getTask(taskId);

  if (!task) {
    throw new AssistantTaskServiceError(404, '任务不存在。');
  }

  const payload = buildTingPdfTranslationPayload(task.record, task.reply);

  if (!payload) {
    throw new AssistantTaskServiceError(
      409,
      '当前任务尚未生成可供 skill/Ting 外贸助手复用的 PDF 结果协议。'
    );
  }

  return payload;
}
