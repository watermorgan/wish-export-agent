import type {
  AssistantReply,
  PdfTranslationSkillPayload,
  TaskRecord
} from '@/lib/assistant/types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPdfTranslationSkillPayload(value: unknown): value is PdfTranslationSkillPayload {
  return isObject(value) && value.kind === 'pdf_translation_skill_v1';
}

export function getPdfTranslationSkillPayload(
  reply: AssistantReply
): PdfTranslationSkillPayload | null {
  if (isPdfTranslationSkillPayload(reply.metadata?.skillPayload)) {
    return reply.metadata.skillPayload;
  }

  for (const section of reply.artifacts) {
    for (const field of section.fields) {
      if (isPdfTranslationSkillPayload(field.structuredData)) {
        return field.structuredData;
      }
    }
  }

  return null;
}

export type OpenClawPdfTranslationPayload = {
  kind: 'openclaw_pdf_translation_v1';
  task: {
    id: string;
    taskType: string;
    status: string;
    reviewStatus: string;
    fileName: string;
  };
  result: PdfTranslationSkillPayload;
};

export function buildOpenClawPdfTranslationPayload(
  task: TaskRecord,
  reply: AssistantReply
): OpenClawPdfTranslationPayload | null {
  const result = getPdfTranslationSkillPayload(reply);

  if (!result) {
    return null;
  }

  return {
    kind: 'openclaw_pdf_translation_v1',
    task: {
      id: task.id,
      taskType: task.taskType,
      status: task.status,
      reviewStatus: task.reviewStatus,
      fileName: result.fileName
    },
    result
  };
}
