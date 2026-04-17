import type { FeedbackCase } from './types';

export type FeedbackCaseFilters = {
  status?: string;
  priority?: string;
  category?: string;
};

export type GlossaryCandidateEntry = {
  en: string;
  zh: string;
  context: 'general';
  source: 'feedback_extraction';
  confidence: number;
  reviewStatus: 'pending';
  addedAt: string;
  notes?: string;
};

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
