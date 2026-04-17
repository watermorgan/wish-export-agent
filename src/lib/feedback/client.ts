import type { WorkspaceFeedbackDraft, WorkspaceFeedbackSource } from '@/lib/assistant/types';
import type { FeedbackCategory } from './types';

type BuildFeedbackDraftInput = WorkspaceFeedbackSource & {
  category: FeedbackCategory;
  expectedTranslation?: string;
};

function trimOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildFeedbackDraft(input: BuildFeedbackDraftInput): WorkspaceFeedbackDraft {
  return {
    category: input.category,
    priority: input.category === 'translation_error' ? 'high' : 'medium',
    source: {
      taskId: trimOptional(input.taskId ?? undefined),
      fileName: input.fileName,
      pageNumber: input.pageNumber,
      segmentId: trimOptional(input.segmentId),
      sourceText: trimOptional(input.sourceText),
      currentTranslation: trimOptional(input.currentTranslation),
      expectedTranslation: trimOptional(input.expectedTranslation),
    },
    reporter: 'workspace-user',
    tags: [],
  };
}
