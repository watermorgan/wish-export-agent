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

  const payload = await request.json();
  const bodySchema = z.object({
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

  const parsed = bodySchema.parse(payload);

  if (parsed.files.length > MAX_FILES) {
    throw new Error(`一次最多上传 ${MAX_FILES} 个文件。`);
  }

  return parsed;
}

export function readTaskPatch(payload: unknown) {
  return taskPatchSchema.parse(payload);
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
