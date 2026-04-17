export const FEEDBACK_CATEGORIES = [
  'translation_error',
  'term_correction',
  'layout_issue',
  'missing_content',
  'noise_content',
  'general_quality',
] as const;

export const FEEDBACK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export const FEEDBACK_STATUSES = [
  'open',
  'triaged',
  'in_progress',
  'resolved',
  'wont_fix',
] as const;

export const FEEDBACK_RESOLUTION_ACTIONS = [
  'glossary_update',
  'normalize_rule_update',
  'suppress_rule_update',
  'layout_param_update',
  'prompt_update',
  'wont_fix',
  'duplicate',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackResolutionAction = (typeof FEEDBACK_RESOLUTION_ACTIONS)[number];

export type FeedbackSource = {
  taskId?: string;
  fileName: string;
  pageNumber?: number;
  segmentId?: string;
  sourceText?: string;
  currentTranslation?: string;
  expectedTranslation?: string;
};

export type FeedbackResolution = {
  action: FeedbackResolutionAction;
  detail: string;
  commitRef?: string;
  resolvedAt: string;
  resolvedBy: string;
};

export type FeedbackCase = {
  id: string;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  source: FeedbackSource;
  reporter: string;
  reportedAt: string;
  tags: string[];
  resolution: FeedbackResolution | null;
};

export type PendingFeedbackCase = Omit<FeedbackCase, 'id'>;

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}

export function isFeedbackPriority(value: unknown): value is FeedbackPriority {
  return typeof value === 'string' && FEEDBACK_PRIORITIES.includes(value as FeedbackPriority);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && FEEDBACK_STATUSES.includes(value as FeedbackStatus);
}

export function isFeedbackResolutionAction(value: unknown): value is FeedbackResolutionAction {
  return (
    typeof value === 'string' &&
    FEEDBACK_RESOLUTION_ACTIONS.includes(value as FeedbackResolutionAction)
  );
}
