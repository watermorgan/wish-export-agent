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

// DESIGN DEBT: "Ting" prefix is historical. This is a generic external consumption
// wrapper, not Ting-specific. Rename to ExternalPdfTranslationPayload / ext_pdf_*
// when a second consumer appears. See AGENTS.md "Deployment Boundary".
export type TingPdfTranslationPayload = {
  kind: 'ting_pdf_translation_v1';
  task: {
    id: string;
    taskType: string;
    status: string;
    reviewStatus: string;
    fileName: string;
  };
  result: PdfTranslationSkillPayload;
};

export function buildTingPdfTranslationPayload(
  task: TaskRecord,
  reply: AssistantReply
): TingPdfTranslationPayload | null {
  const result = getPdfTranslationSkillPayload(reply);

  if (!result) {
    return null;
  }

  const annotatedPdfUrl = `/api/tasks/${encodeURIComponent(task.id)}/translation-pdf?download=1`;
  const artifactLinks = result.artifactLinks.map((link) => ({
    ...link,
    annotatedPdfUrl
  }));
  const deliveryPdfUrl = annotatedPdfUrl;

  return {
    kind: 'ting_pdf_translation_v1',
    task: {
      id: task.id,
      taskType: task.taskType,
      status: task.status,
      reviewStatus: task.reviewStatus,
      fileName: result.fileName
    },
    result: {
      ...result,
      deliveryPdfUrl,
      artifactLinks
    }
  };
}
