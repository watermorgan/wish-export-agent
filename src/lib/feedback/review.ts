import type { FeedbackCase } from './types';

export type FeedbackCaseFilters = {
  status?: string;
  priority?: string;
  category?: string;
};

export type GlossaryOrigin = 'manual' | 'ai_feedback_mining' | 'imported';

export type GlossaryCandidateEntry = {
  en: string;
  zh: string;
  context: 'general';
  source: 'feedback_extraction';
  /**
   * 粗粒度来源标签。从反馈自动挖出的候选固定为 'ai_feedback_mining'，
   * 便于主管在审核界面/命令行里一眼看到 AI 是否参与了这条术语的引入。
   * 历史未带该字段的条目在读取侧视为 'manual'（见 resolveGlossaryOrigin）。
   */
  origin: GlossaryOrigin;
  confidence: number;
  reviewStatus: 'pending';
  addedAt: string;
  notes?: string;
};

/**
 * 对外部/历史条目做 origin 兜底：没有字段或字段非法时一律视为 manual，
 * 保证下游脚本不需要关心 schema 升级前的数据。
 */
export function resolveGlossaryOrigin(value: unknown): GlossaryOrigin {
  if (value === 'ai_feedback_mining' || value === 'imported' || value === 'manual') {
    return value;
  }
  return 'manual';
}

function buildGlossaryCandidateKey(en: string, zh: string) {
  return `${en.trim().toLowerCase()}::${zh.trim()}`;
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function filterFeedbackCases(items: FeedbackCase[], filters: FeedbackCaseFilters = {}) {
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) {
      return false;
    }

    if (filters.priority && item.priority !== filters.priority) {
      return false;
    }

    if (filters.category && item.category !== filters.category) {
      return false;
    }

    return true;
  });
}

export function extractGlossaryCandidates(items: FeedbackCase[]): GlossaryCandidateEntry[] {
  const byKey = new Map<
    string,
    {
      candidate: GlossaryCandidateEntry;
      feedbackIds: string[];
    }
  >();

  for (const item of items) {
    if (item.category !== 'term_correction') {
      continue;
    }

    const en = item.source.sourceText?.trim();
    const zh = item.source.expectedTranslation?.trim();

    if (!en || !zh) {
      continue;
    }

    const key = buildGlossaryCandidateKey(en, zh);
    const existing = byKey.get(key);

    if (existing) {
      if (!existing.feedbackIds.includes(item.id)) {
        existing.feedbackIds.push(item.id);
        existing.candidate.notes = `sourceFeedbackIds=${existing.feedbackIds.join(',')}`;
      }
      continue;
    }

    byKey.set(key, {
      candidate: {
        en,
        zh,
        context: 'general',
        source: 'feedback_extraction',
        origin: 'ai_feedback_mining',
        confidence: 0.8,
        reviewStatus: 'pending',
        addedAt: getTodayDate(),
        notes: `sourceFeedbackIds=${item.id}`,
      },
      feedbackIds: [item.id],
    });
  }

  return [...byKey.values()]
    .map(({ candidate }) => candidate)
    .sort((left, right) => left.en.localeCompare(right.en));
}

export function mergeGlossaryCandidates(
  existingEntries: GlossaryCandidateEntry[],
  nextEntries: GlossaryCandidateEntry[]
) {
  const mergedEntries = [...existingEntries];

  for (const candidate of nextEntries) {
    const seen = mergedEntries.some(
      (entry) => buildGlossaryCandidateKey(entry.en, entry.zh) === buildGlossaryCandidateKey(candidate.en, candidate.zh)
    );

    if (!seen) {
      mergedEntries.push(candidate);
    }
  }

  return mergedEntries;
}
