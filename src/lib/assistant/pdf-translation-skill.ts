import { buildAiDisclosure } from '@/lib/assistant/disclosure';
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

export function updatePdfTranslationSkillPayload(
  reply: AssistantReply,
  updater: (payload: PdfTranslationSkillPayload) => PdfTranslationSkillPayload
): AssistantReply {
  const nextMetadataPayload = isPdfTranslationSkillPayload(reply.metadata?.skillPayload)
    ? updater(reply.metadata.skillPayload)
    : null;

  return {
    ...reply,
    artifacts: reply.artifacts.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        isPdfTranslationSkillPayload(field.structuredData)
          ? {
              ...field,
              structuredData: updater(field.structuredData)
            }
          : field
      )
    })),
    metadata: nextMetadataPayload
      ? {
          ...(reply.metadata ?? { needsHumanReview: true }),
          skillPayload: nextMetadataPayload
        }
      : reply.metadata
  };
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
  // wrapper 层按外部可见的 task.reviewStatus 重建披露，保证未审任务对外披露为“不得直接使用”，
  // 已审任务降级为“请再次确认商务承诺”。payload 的 watermarkVersion 仍由构建侧负责。
  const disclosure = buildAiDisclosure({
    reviewStatus: task.reviewStatus,
    watermarkVersion: result.disclosure?.watermarkVersion ?? null
  });

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
      disclosure,
      deliveryPdfUrl,
      artifactLinks
    }
  };
}
