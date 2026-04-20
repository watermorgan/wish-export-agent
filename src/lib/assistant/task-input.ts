import { z } from 'zod';
import {
  MAX_FILES,
  assistantRoleSchema,
  formQuestionSchema,
  selectedSkillIdsSchema,
  selectedTemplateSchema,
  taskTypeSchema,
  uploadedFileSchema
} from '@/lib/assistant/mock-agent';
import { enrichUploadedFile } from '@/lib/assistant/file-extractor';
import type { AssistantRequest, UploadedFile } from '@/lib/assistant/types';

const taskPatchSchema = z.object({
  question: formQuestionSchema.optional(),
  taskType: taskTypeSchema.optional(),
  selectedTemplateId: selectedTemplateSchema.nullable().optional(),
  selectedSkillIds: z.array(z.string().trim().min(1)).optional(),
  modelOverride: z.string().trim().min(1).nullable().optional(),
  visionModelOverride: z.string().trim().min(1).nullable().optional(),
  translationModelOverride: z.string().trim().min(1).nullable().optional()
});

const positiveIntSchema = z.number().int().min(1);

const pageDirectiveSchema = z.object({
  pageNumber: positiveIntSchema,
  action: z.enum(['force_vision', 'skip_translation', 'keep_original']),
  note: z.string().trim().max(200).optional()
});

const taskOverrideSchema = z.object({
  actor: z.enum(['sales', 'supervisor']).default('sales'),
  reason: z.string().trim().min(1).max(400),
  pageOverrides: z.object({
    forceVisionPages: z.array(positiveIntSchema).max(100).optional(),
    skipTranslationPages: z.array(positiveIntSchema).max(100).optional(),
    pageDirectives: z.array(pageDirectiveSchema).max(200).optional()
  })
});

const taskReworkSchema = z.object({
  actor: z.enum(['sales', 'supervisor']).default('sales'),
  reason: z.string().trim().min(1).max(400).optional(),
  scope: z.literal('pages'),
  pageNumbers: z.array(positiveIntSchema).max(100).optional(),
  instruction: z.string().trim().min(1).max(1000),
  note: z.string().trim().max(400).optional(),
  sourceFeedbackIds: z.array(z.string().trim().min(1).max(200)).max(100).optional()
});

function parseSelectedSkillIds(raw: FormDataEntryValue | null) {
  if (raw === null) {
    return [];
  }

  try {
    return selectedSkillIdsSchema.parse(JSON.parse(String(raw)));
  } catch {
    throw new Error('selectedSkillIds 格式不正确。');
  }
}

async function parseUploadedFiles(formData: FormData): Promise<UploadedFile[]> {
  const parsedFiles = await Promise.all(
    formData
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map((file) => enrichUploadedFile(file))
  );

  return parsedFiles.map((file) =>
    uploadedFileSchema.extend({
      contentText: z.string().optional()
    }).parse(file)
  );
}

function parseSelectedTemplateId(raw: FormDataEntryValue | null) {
  if (raw === null || String(raw).trim() === '') {
    return undefined;
  }

  return selectedTemplateSchema.parse(raw);
}

function parseModelOverride(raw: FormDataEntryValue | null) {
  if (raw === null || String(raw).trim() === '') {
    return undefined;
  }

  return String(raw).trim();
}

const assistantJsonBodySchema = z.object({
  channel: z.enum(['web', 'feishu', 'slack', 'wecom']).default('web'),
  role: assistantRoleSchema,
  question: formQuestionSchema,
  files: z.array(uploadedFileSchema).default([]),
  taskType: taskTypeSchema,
  selectedTemplateId: selectedTemplateSchema.nullable().optional(),
  selectedSkillIds: z.array(z.string().trim().min(1)).default([]),
  modelOverride: z.string().trim().min(1).optional(),
  visionModelOverride: z.string().trim().min(1).optional(),
  translationModelOverride: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  rawPayload: z.unknown().optional()
});

export function parseAssistantJsonPayload(payload: unknown): AssistantRequest {
  const parsed = assistantJsonBodySchema.parse(payload);

  if (parsed.files.length > MAX_FILES) {
    throw new Error(`一次最多上传 ${MAX_FILES} 个文件。`);
  }

  return parsed;
}

export async function readAssistantRequest(request: Request): Promise<AssistantRequest> {
  const contentType = request.headers.get('content-type') ?? '';

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    const formData = await request.formData();
    const files = await parseUploadedFiles(formData);

    if (files.length > MAX_FILES) {
      throw new Error(`一次最多上传 ${MAX_FILES} 个文件。`);
    }

    return {
      channel: 'web',
      role: assistantRoleSchema.parse(formData.get('role')),
      question: formQuestionSchema.parse(formData.get('question')),
      files,
      taskType: taskTypeSchema.parse(formData.get('taskType')),
      selectedTemplateId: parseSelectedTemplateId(formData.get('selectedTemplateId')),
      selectedSkillIds: parseSelectedSkillIds(formData.get('selectedSkillIds')),
      modelOverride: parseModelOverride(formData.get('translationModelOverride') ?? formData.get('modelOverride')),
      visionModelOverride: parseModelOverride(formData.get('visionModelOverride')),
      translationModelOverride: parseModelOverride(formData.get('translationModelOverride'))
    };
  }

  return parseAssistantJsonPayload(await request.json());
}

export function readTaskPatch(payload: unknown) {
  return taskPatchSchema.parse(payload);
}

export function readTaskOverride(payload: unknown) {
  const parsed = taskOverrideSchema.parse(payload);
  const forceVisionPages = new Set(parsed.pageOverrides.forceVisionPages ?? []);
  const skipTranslationPages = new Set(parsed.pageOverrides.skipTranslationPages ?? []);
  const directiveActions = new Map<number, Set<'force' | 'skip'>>();

  for (const pageNumber of forceVisionPages) {
    if (skipTranslationPages.has(pageNumber)) {
      throw new Error(`page ${pageNumber} 不能同时出现在 forceVisionPages 和 skipTranslationPages。`);
    }
  }

  for (const directive of parsed.pageOverrides.pageDirectives ?? []) {
    const bucket = directiveActions.get(directive.pageNumber) ?? new Set<'force' | 'skip'>();
    if (directive.action === 'force_vision') {
      bucket.add('force');
    }
    if (directive.action === 'skip_translation' || directive.action === 'keep_original') {
      bucket.add('skip');
    }
    directiveActions.set(directive.pageNumber, bucket);
  }

  for (const [pageNumber, actions] of directiveActions.entries()) {
    if (actions.has('force') && actions.has('skip')) {
      throw new Error(`pageDirectives 中 page ${pageNumber} 不能同时声明 force_vision 与 skip/keep_original。`);
    }
    if (actions.has('force') && skipTranslationPages.has(pageNumber)) {
      throw new Error(`page ${pageNumber} 不能同时通过数组和 directives 声明 force 与 skip。`);
    }
    if (actions.has('skip') && forceVisionPages.has(pageNumber)) {
      throw new Error(`page ${pageNumber} 不能同时通过数组和 directives 声明 force 与 skip。`);
    }
  }

  return parsed;
}

export function readTaskRework(payload: unknown) {
  const parsed = taskReworkSchema.parse(payload);
  if ((parsed.pageNumbers?.length ?? 0) === 0) {
    throw new Error('page-scoped rework 至少需要一个 pageNumber。');
  }

  return parsed;
}

export function applyTaskPatch(
  current: AssistantRequest,
  patch: ReturnType<typeof readTaskPatch>
): AssistantRequest {
  return {
    ...current,
    question: patch.question ?? current.question,
    taskType: patch.taskType ?? current.taskType,
    selectedTemplateId:
      patch.selectedTemplateId === undefined
        ? current.selectedTemplateId
        : patch.selectedTemplateId,
    selectedSkillIds: patch.selectedSkillIds ?? current.selectedSkillIds,
    modelOverride:
      patch.translationModelOverride !== undefined
        ? patch.translationModelOverride ?? undefined
        : patch.modelOverride === undefined
          ? current.modelOverride
          : patch.modelOverride ?? undefined,
    visionModelOverride:
      patch.visionModelOverride === undefined
        ? current.visionModelOverride
        : patch.visionModelOverride ?? undefined,
    translationModelOverride:
      patch.translationModelOverride === undefined
        ? current.translationModelOverride
        : patch.translationModelOverride ?? undefined
  };
}
