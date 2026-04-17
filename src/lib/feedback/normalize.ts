import type { PendingFeedbackCase } from './types';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  isFeedbackCategory,
  isFeedbackPriority,
} from './types';

function trimOptional(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function assertFeedbackCategory(value: unknown) {
  if (!isFeedbackCategory(value)) {
    throw new Error(`category 必填且必须是以下之一：${FEEDBACK_CATEGORIES.join(', ')}`);
  }

  return value;
}

function normalizePriority(value: unknown) {
  if (value === undefined) {
    return 'medium' as const;
  }

  if (!isFeedbackPriority(value)) {
    throw new Error(`priority 必须是以下之一：${FEEDBACK_PRIORITIES.join(', ')}`);
  }

  return value;
}

function assertSafeFileName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || /[/\\]|\.\./.test(value)) {
    throw new Error('source.fileName 必填，且不能包含路径分隔符或 ".."。');
  }

  return value.trim();
}

function normalizePageNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

export function normalizeIncomingFeedback(input: Record<string, unknown>): PendingFeedbackCase {
  const source =
    typeof input.source === 'object' && input.source !== null
      ? (input.source as Record<string, unknown>)
      : {};

  return {
    category: assertFeedbackCategory(input.category),
    priority: normalizePriority(input.priority),
    status: 'open',
    source: {
      taskId: trimOptional(source.taskId),
      fileName: assertSafeFileName(source.fileName),
      pageNumber: normalizePageNumber(source.pageNumber),
      segmentId: trimOptional(source.segmentId),
      sourceText: trimOptional(source.sourceText),
      currentTranslation: trimOptional(source.currentTranslation),
      expectedTranslation: trimOptional(source.expectedTranslation),
    },
    reporter: trimOptional(input.reporter) ?? 'unknown',
    reportedAt: new Date().toISOString(),
    tags: normalizeTags(input.tags),
    resolution: null,
  };
}
