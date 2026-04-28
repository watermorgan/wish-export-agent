import type { TranslationSnapshot } from '@/lib/assistant/translation-pipeline';
import type {
  AssistantReply,
  AssistantRequest,
  AssistantRole,
  TaskExecutionControl,
  TaskPageOverrides,
  TaskRecord,
  TaskRevision,
  TaskReworkRequest
} from '@/lib/assistant/types';

type TaskIterationState = {
  currentRevisionId: string;
  baseRevisionId: string;
  revisionCount: number;
  currentControl?: TaskExecutionControl | null;
  baselineSnapshot?: TranslationSnapshot | null;
  revisions: TaskRevision[];
};

type RawPayloadWithIteration = Record<string, unknown> & {
  taskIteration?: TaskIterationState;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRawPayload(rawPayload: unknown): RawPayloadWithIteration {
  return isObject(rawPayload) ? { ...rawPayload } : {};
}

function createRevisionId() {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isTranslationSnapshot(value: unknown): value is TranslationSnapshot {
  return (
    isObject(value) &&
    value.version === 'translation_snapshot_v1' &&
    Array.isArray(value.items)
  );
}

function parseIterationState(rawPayload: unknown): TaskIterationState | null {
  if (!isObject(rawPayload) || !isObject(rawPayload.taskIteration)) {
    return null;
  }

  const state = rawPayload.taskIteration;
  if (
    typeof state.currentRevisionId !== 'string' ||
    typeof state.baseRevisionId !== 'string' ||
    !Array.isArray(state.revisions)
  ) {
    return null;
  }

  return state as TaskIterationState;
}

function writeIterationState(
  request: AssistantRequest,
  updater: (state: TaskIterationState | null) => TaskIterationState
): AssistantRequest {
  const rawPayload = cloneRawPayload(request.rawPayload);
  rawPayload.taskIteration = updater(parseIterationState(rawPayload));

  return {
    ...request,
    rawPayload
  };
}

function collectTargetPages(
  pageOverrides?: TaskPageOverrides,
  rework?: TaskReworkRequest | null
) {
  const pages = new Set<number>();
  for (const pageNumber of pageOverrides?.forceVisionPages ?? []) {
    if (Number.isInteger(pageNumber) && pageNumber > 0) {
      pages.add(pageNumber);
    }
  }
  for (const directive of pageOverrides?.pageDirectives ?? []) {
    if (directive.action === 'force_vision' && Number.isInteger(directive.pageNumber) && directive.pageNumber > 0) {
      pages.add(directive.pageNumber);
    }
  }
  for (const pageNumber of rework?.pageNumbers ?? []) {
    if (Number.isInteger(pageNumber) && pageNumber > 0) {
      pages.add(pageNumber);
    }
  }
  return [...pages].sort((left, right) => left - right);
}

function mergePageOverrides(
  existing: TaskPageOverrides | undefined,
  incoming: TaskPageOverrides | undefined
): TaskPageOverrides | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  const forceVisionPages = Array.from(
    new Set([...(existing?.forceVisionPages ?? []), ...(incoming?.forceVisionPages ?? [])])
  ).sort((left, right) => left - right);
  const skipTranslationPages = Array.from(
    new Set([...(existing?.skipTranslationPages ?? []), ...(incoming?.skipTranslationPages ?? [])])
  ).sort((left, right) => left - right);
  const pageDirectives = [...(existing?.pageDirectives ?? []), ...(incoming?.pageDirectives ?? [])];

  return {
    ...(forceVisionPages.length > 0 ? { forceVisionPages } : {}),
    ...(skipTranslationPages.length > 0 ? { skipTranslationPages } : {}),
    ...(pageDirectives.length > 0 ? { pageDirectives } : {})
  };
}

export function findTranslationSnapshot(reply: AssistantReply): TranslationSnapshot | null {
  for (const section of reply.artifacts) {
    for (const field of section.fields) {
      if (isTranslationSnapshot(field.structuredData)) {
        return field.structuredData;
      }
    }
  }

  return null;
}

type RawPayloadCarrier = {
  rawPayload?: unknown;
};

export function getTaskIterationState(request: RawPayloadCarrier) {
  return parseIterationState(request.rawPayload);
}

export function buildTaskRevisionSummary(request: RawPayloadCarrier) {
  const state = getTaskIterationState(request);
  if (!state) {
    return undefined;
  }

  const latestRevision =
    state.revisions.find((revision) => revision.id === state.currentRevisionId) ??
    state.revisions[state.revisions.length - 1];

  return {
    currentRevisionId: state.currentRevisionId,
    baseRevisionId: state.baseRevisionId,
    revisionCount: state.revisionCount,
    currentControl: state.currentControl ?? null,
    latestRevision
  };
}

export function applyTaskRevisionSummaryToRecord(
  record: TaskRecord,
  request: RawPayloadCarrier
): TaskRecord {
  const summary = buildTaskRevisionSummary(request);
  if (!summary) {
    return record;
  }

  return {
    ...record,
    currentRevisionId: summary.currentRevisionId,
    baseRevisionId: summary.baseRevisionId,
    revisionCount: summary.revisionCount,
    lineageMode: 'in_task_revision'
  };
}

export function ensureBaseTaskRevision(
  request: AssistantRequest,
  taskId: string,
  actor: AssistantRole | 'external_agent' = request.role
) {
  return writeIterationState(request, (existing) => {
    if (existing) {
      return existing;
    }

    const createdAt = nowIso();
    const baseRevision: TaskRevision = {
      id: createRevisionId(),
      taskId,
      kind: 'base',
      createdAt,
      createdBy: actor,
      state: 'ready'
    };

    return {
      currentRevisionId: baseRevision.id,
      baseRevisionId: baseRevision.id,
      revisionCount: 1,
      currentControl: null,
      baselineSnapshot: null,
      revisions: [baseRevision]
    };
  });
}

export function createOverrideRevisionRequest(
  request: AssistantRequest,
  taskId: string,
  actor: AssistantRole | 'external_agent',
  reason: string,
  pageOverrides: TaskPageOverrides
) {
  const baseRequest = ensureBaseTaskRevision(request, taskId, actor);
  return writeIterationState(baseRequest, (existing) => {
    if (!existing) {
      throw new Error('task iteration state missing after base initialization');
    }

    // Override is render-only: targetPages only includes skip/keep pages, never force_vision
    const targetPages = Array.from(
      new Set([
        ...(pageOverrides.skipTranslationPages ?? []),
        ...(pageOverrides.pageDirectives ?? [])
          .filter((d) => d.action === 'skip_translation' || d.action === 'keep_original')
          .map((d) => d.pageNumber)
      ])
    ).sort((left, right) => left - right);

    const revision: TaskRevision = {
      id: createRevisionId(),
      taskId,
      parentRevisionId: existing.currentRevisionId,
      kind: 'override',
      createdAt: nowIso(),
      createdBy: actor,
      state: 'running',
      reason,
      control: {
        pageOverrides
      },
      targetPages
    };

    return {
      ...existing,
      currentRevisionId: revision.id,
      revisionCount: existing.revisions.length + 1,
      currentControl: {
        pageOverrides
      },
      baselineSnapshot: null,
      revisions: [...existing.revisions, revision]
    };
  });
}

export function createReworkRevisionRequest(
  request: AssistantRequest,
  taskId: string,
  actor: AssistantRole | 'external_agent',
  reason: string,
  rework: TaskReworkRequest,
  baselineSnapshot: TranslationSnapshot | null
) {
  const baseRequest = ensureBaseTaskRevision(request, taskId, actor);
  return writeIterationState(baseRequest, (existing) => {
    if (!existing) {
      throw new Error('task iteration state missing after base initialization');
    }

    const targetPages = collectTargetPages(undefined, rework);
    const mergedPageOverrides = mergePageOverrides(existing.currentControl?.pageOverrides, {
      forceVisionPages: rework.mode === 'revise' ? targetPages : []
    });
    const control: TaskExecutionControl = {
      pageOverrides: mergedPageOverrides,
      rework
    };

    const revision: TaskRevision = {
      id: createRevisionId(),
      taskId,
      parentRevisionId: existing.currentRevisionId,
      kind: 'rework',
      createdAt: nowIso(),
      createdBy: actor,
      state: 'running',
      reason,
      control,
      targetPages,
      sourceFeedbackIds: rework.sourceFeedbackIds
    };

    return {
      ...existing,
      currentRevisionId: revision.id,
      revisionCount: existing.revisions.length + 1,
      currentControl: control,
      baselineSnapshot,
      revisions: [...existing.revisions, revision]
    };
  });
}

export function finalizeLatestTaskRevision(
  request: AssistantRequest,
  state: 'ready' | 'failed'
) {
  return writeIterationState(request, (existing) => {
    if (!existing || existing.revisions.length === 0) {
      return existing ?? {
        currentRevisionId: '',
        baseRevisionId: '',
        revisionCount: 0,
        currentControl: null,
        baselineSnapshot: null,
        revisions: []
      };
    }

    const latestRevision =
      existing.revisions.find((revision) => revision.id === existing.currentRevisionId) ??
      existing.revisions[existing.revisions.length - 1];
    const revisions = existing.revisions.map((revision) =>
      revision.id === existing.currentRevisionId
        ? {
            ...revision,
            state
          }
        : revision
    );

    return {
      ...existing,
      currentRevisionId:
        state === 'failed' ? latestRevision.parentRevisionId ?? existing.baseRevisionId : existing.currentRevisionId,
      currentControl:
        state === 'failed'
          ? revisions.find(
              (revision) =>
                revision.id === (latestRevision.parentRevisionId ?? existing.baseRevisionId)
            )?.control ?? null
          : existing.currentControl,
      baselineSnapshot: state === 'failed' ? null : existing.baselineSnapshot,
      revisions
    };
  });
}

export function getActiveTaskExecutionControl(request: AssistantRequest): TaskExecutionControl | null {
  return getTaskIterationState(request)?.currentControl ?? null;
}

export function getTaskRevisionById(request: AssistantRequest, revisionId: string) {
  const state = getTaskIterationState(request);
  if (!state) {
    return null;
  }

  return (
    state.revisions.find((revision) => revision.id === revisionId) ?? null
  );
}

export function replaceReworkTargetPages(rework: TaskReworkRequest, targetPages: number[]): TaskReworkRequest {
  return {
    ...rework,
    pageNumbers: targetPages
  };
}

export function buildRevisionResponse(
  request: AssistantRequest,
  reply: AssistantReply,
  revisionId: string
) {
  const state = getTaskIterationState(request);
  if (!state) {
    return null;
  }

  const revision = getTaskRevisionById(request, revisionId);
  if (!revision) {
    return null;
  }

  return {
    revision,
    current: revision.id === state.currentRevisionId,
    revisionCount: state.revisionCount,
    currentControl: state.currentControl ?? null,
    result: {
      deliveryPdfUrl: `/api/tasks/${encodeURIComponent(reply.task?.id ?? revision.taskId)}/translation-pdf?download=1`,
      skillPayloadUrl: `/api/tasks/${encodeURIComponent(reply.task?.id ?? revision.taskId)}/skill-payload`
    }
  };
}
