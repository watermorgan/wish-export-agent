import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeIncomingFeedback } from '../normalize';
import { createFeedbackCase, resolveFeedbackCase, updateFeedbackCase } from '../store';

test('normalizeIncomingFeedback trims strings, defaults priority/status, and rejects unsafe file names', () => {
  const normalized = normalizeIncomingFeedback({
    category: 'term_correction',
    source: {
      fileName: 'M422123.pdf',
      sourceText: ' Back elasticated waistband ',
      expectedTranslation: ' 后腰部橡筋 ',
    },
    reporter: ' ting-user ',
    tags: [' 术语 ', '', 'M422123', 42],
  });

  assert.equal(normalized.priority, 'medium');
  assert.equal(normalized.status, 'open');
  assert.equal(normalized.source.fileName, 'M422123.pdf');
  assert.equal(normalized.source.sourceText, 'Back elasticated waistband');
  assert.equal(normalized.source.expectedTranslation, '后腰部橡筋');
  assert.equal(normalized.reporter, 'ting-user');
  assert.deepEqual(normalized.tags, ['术语', 'M422123']);
  assert.equal(normalized.resolution, null);
  assert.match(normalized.reportedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.throws(
    () =>
      normalizeIncomingFeedback({
        category: 'translation_error',
        source: { fileName: '../secret.pdf' },
        reporter: 'bad-input',
      }),
    /source\.fileName/
  );
});

test('normalizeIncomingFeedback validates category and explicit priority values', () => {
  const normalized = normalizeIncomingFeedback({
    category: 'translation_error',
    priority: 'high',
    source: {
      fileName: 'layout-issue.pdf',
      pageNumber: 2,
      currentTranslation: ' current copy ',
    },
  });

  assert.equal(normalized.priority, 'high');
  assert.equal(normalized.source.pageNumber, 2);
  assert.equal(normalized.source.currentTranslation, 'current copy');
  assert.equal(normalized.reporter, 'unknown');
  assert.deepEqual(normalized.tags, []);

  assert.throws(
    () =>
      normalizeIncomingFeedback({
        category: 'not_real',
        source: { fileName: 'sample.pdf' },
      }),
    /category/
  );

  assert.throws(
    () =>
      normalizeIncomingFeedback({
        category: 'translation_error',
        priority: 'urgent',
        source: { fileName: 'sample.pdf' },
      }),
    /priority/
  );
});

test('createFeedbackCase reserves a unique id and writes a JSON file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
  const created = await createFeedbackCase(dir, {
    category: 'translation_error',
    priority: 'high',
    status: 'open',
    source: { fileName: 'M422123.pdf', sourceText: 'Back elasticated waistband' },
    reporter: 'workspace-user',
    reportedAt: '2026-04-17T00:00:00.000Z',
    tags: ['术语'],
    resolution: null,
  });

  assert.match(created.id, /^fb-\d{8}-\d{3}$/);

  const saved = JSON.parse(await readFile(created.path, 'utf8'));
  assert.equal(saved.id, created.id);
  assert.equal(saved.priority, 'high');
});

test('resolveFeedbackCase writes resolution metadata and persists the updated status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
  const created = await createFeedbackCase(dir, {
    category: 'translation_error',
    priority: 'high',
    status: 'open',
    source: { fileName: 'M422123.pdf', sourceText: 'Back elasticated waistband' },
    reporter: 'workspace-user',
    reportedAt: '2026-04-17T00:00:00.000Z',
    tags: ['术语'],
    resolution: null,
  });

  const updated = await resolveFeedbackCase(dir, created.id, {
    status: 'resolved',
    action: 'normalize_rule_update',
    detail: 'Aligned waistband wording with approved glossary phrasing.',
    commitRef: 'abc1234',
    resolvedBy: 'dev-user',
    resolvedAt: '2026-04-17T01:02:03.000Z',
  });

  assert.equal(updated.record.id, created.id);
  assert.equal(updated.record.status, 'resolved');
  assert.deepEqual(updated.record.resolution, {
    action: 'normalize_rule_update',
    detail: 'Aligned waistband wording with approved glossary phrasing.',
    commitRef: 'abc1234',
    resolvedAt: '2026-04-17T01:02:03.000Z',
    resolvedBy: 'dev-user',
  });

  const savedText = await readFile(updated.path, 'utf8');
  const saved = JSON.parse(savedText);

  assert.equal(saved.status, 'resolved');
  assert.equal(saved.resolution.action, 'normalize_rule_update');
  assert.equal(saved.resolution.resolvedBy, 'dev-user');
  assert.ok(savedText.endsWith('\n'));
});

test('updateFeedbackCase rejects attempts to mutate the feedback id', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
  const created = await createFeedbackCase(dir, {
    category: 'layout_issue',
    priority: 'medium',
    status: 'open',
    source: { fileName: 'layout-issue.pdf' },
    reporter: 'workspace-user',
    reportedAt: '2026-04-17T00:00:00.000Z',
    tags: [],
    resolution: null,
  });

  await assert.rejects(
    () =>
      updateFeedbackCase(dir, created.id, (current) => ({
        ...current,
        id: 'fb-20260417-999',
      })),
    /must not change the case id/
  );
});
