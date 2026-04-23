import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractGlossaryCandidates,
  filterFeedbackCases,
  mergeGlossaryCandidates,
  resolveGlossaryOrigin,
} from '../review';
import type { FeedbackCase } from '../types';

function createFeedbackCase(overrides: Partial<FeedbackCase> = {}): FeedbackCase {
  return {
    id: 'fb-20260417-001',
    category: 'translation_error',
    priority: 'high',
    status: 'open',
    source: {
      fileName: 'M422123.pdf',
      sourceText: 'Back elasticated waistband',
      expectedTranslation: '后腰部橡筋',
    },
    reporter: 'workspace-user',
    reportedAt: '2026-04-17T00:00:00.000Z',
    tags: ['术语'],
    resolution: null,
    ...overrides,
  };
}

test('filterFeedbackCases applies status, priority, and category filters', () => {
  const items = [
    createFeedbackCase(),
    createFeedbackCase({
      id: 'fb-20260417-002',
      priority: 'medium',
      category: 'term_correction',
    }),
    createFeedbackCase({
      id: 'fb-20260417-003',
      status: 'resolved',
      category: 'layout_issue',
      priority: 'low',
    }),
  ];

  assert.deepEqual(
    filterFeedbackCases(items, { status: 'open', priority: 'high' }).map((item) => item.id),
    ['fb-20260417-001']
  );
  assert.deepEqual(
    filterFeedbackCases(items, { category: 'term_correction' }).map((item) => item.id),
    ['fb-20260417-002']
  );
  assert.equal(filterFeedbackCases(items).length, 3);
});

test('extractGlossaryCandidates only promotes term corrections and deduplicates by source text', () => {
  const candidates = extractGlossaryCandidates([
    createFeedbackCase({
      id: 'fb-20260417-001',
      category: 'term_correction',
      priority: 'high',
      source: {
        fileName: 'M422123.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰部橡筋',
      },
      reporter: 'workspace-user',
      reportedAt: '2026-04-17T00:00:00.000Z',
    }),
    createFeedbackCase({
      id: 'fb-20260417-002',
      category: 'term_correction',
      priority: 'medium',
      source: {
        fileName: 'M441083.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰部橡筋',
      },
      reporter: 'ting-user',
      reportedAt: '2026-04-17T01:00:00.000Z',
    }),
    createFeedbackCase({
      id: 'fb-20260417-003',
      category: 'translation_error',
      source: {
        fileName: 'translation.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰橡筋',
      },
    }),
    createFeedbackCase({
      id: 'fb-20260417-004',
      category: 'layout_issue',
      source: {
        fileName: 'layout.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰部橡筋',
      },
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].en, 'Back elasticated waistband');
  assert.equal(candidates[0].zh, '后腰部橡筋');
  assert.equal(candidates[0].source, 'feedback_extraction');
  assert.equal(candidates[0].origin, 'ai_feedback_mining');
  assert.equal(candidates[0].reviewStatus, 'pending');
  assert.equal(candidates[0].context, 'general');
  assert.equal(candidates[0].confidence, 0.8);
  assert.match(candidates[0].notes ?? '', /fb-20260417-001/);
  assert.match(candidates[0].notes ?? '', /fb-20260417-002/);
});

test('mergeGlossaryCandidates appends only unseen candidate pairs', () => {
  const merged = mergeGlossaryCandidates(
    [
      {
        en: 'Back elasticated waistband',
        zh: '后腰部橡筋',
        context: 'general',
        source: 'feedback_extraction',
        origin: 'ai_feedback_mining',
        confidence: 0.8,
        reviewStatus: 'pending',
        addedAt: '2026-04-17',
        notes: 'sourceFeedbackIds=fb-20260417-001',
      },
    ],
    [
      {
        en: 'back elasticated waistband',
        zh: '后腰部橡筋',
        context: 'general',
        source: 'feedback_extraction',
        origin: 'ai_feedback_mining',
        confidence: 0.8,
        reviewStatus: 'pending',
        addedAt: '2026-04-17',
      },
      {
        en: 'Side seam pockets',
        zh: '侧缝插袋',
        context: 'general',
        source: 'feedback_extraction',
        origin: 'ai_feedback_mining',
        confidence: 0.8,
        reviewStatus: 'pending',
        addedAt: '2026-04-17',
      },
    ]
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((item) => `${item.en}=>${item.zh}`),
    ['Back elasticated waistband=>后腰部橡筋', 'Side seam pockets=>侧缝插袋']
  );
});

test('resolveGlossaryOrigin falls back to manual for missing/unknown values', () => {
  assert.equal(resolveGlossaryOrigin('ai_feedback_mining'), 'ai_feedback_mining');
  assert.equal(resolveGlossaryOrigin('imported'), 'imported');
  assert.equal(resolveGlossaryOrigin('manual'), 'manual');
  assert.equal(resolveGlossaryOrigin(undefined), 'manual');
  assert.equal(resolveGlossaryOrigin(null), 'manual');
  assert.equal(resolveGlossaryOrigin('something_else'), 'manual');
});
