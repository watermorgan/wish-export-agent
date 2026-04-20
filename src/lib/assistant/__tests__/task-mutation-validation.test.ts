import assert from 'node:assert/strict';
import test from 'node:test';

import { readTaskOverride, readTaskRework } from '../task-input';
import { canEditTaskStatus } from '../task-store';
import type { TaskStatus } from '../types';

test('override accepts page-level controls', () => {
  const parsed = readTaskOverride({
    actor: 'sales',
    reason: '补翻清晰页',
    pageOverrides: {
      forceVisionPages: [10],
      skipTranslationPages: [8, 9]
    }
  });

  assert.deepEqual(parsed.pageOverrides.forceVisionPages, [10]);
  assert.deepEqual(parsed.pageOverrides.skipTranslationPages, [8, 9]);
});

test('override rejects overlapping force and skip pages', () => {
  assert.throws(
    () =>
      readTaskOverride({
        actor: 'sales',
        reason: '冲突测试',
        pageOverrides: {
          forceVisionPages: [10],
          skipTranslationPages: [10]
        }
      }),
    /不能同时出现在 forceVisionPages 和 skipTranslationPages/
  );
});

test('override rejects conflicting pageDirectives on the same page', () => {
  assert.throws(
    () =>
      readTaskOverride({
        actor: 'sales',
        reason: '冲突 directives',
        pageOverrides: {
          pageDirectives: [
            { pageNumber: 10, action: 'force_vision' },
            { pageNumber: 10, action: 'keep_original' }
          ]
        }
      }),
    /不能同时声明 force_vision 与 skip\/keep_original/
  );
});

test('rework requires at least one bounded target', () => {
  assert.throws(
    () =>
      readTaskRework({
        actor: 'sales',
        scope: 'pages',
        instruction: '重新处理'
      }),
    /至少需要一个 pageNumber/
  );
});

test('editable status guard matches override and rework policy', () => {
  const allowed: TaskStatus[] = [
    'draft',
    'validating',
    'blocked',
    'pending_user_confirmation',
    'returned'
  ];
  const blocked: TaskStatus[] = [
    'pending_supervisor_review',
    'approved',
    'exported',
    'archived',
    'failed'
  ];

  for (const status of allowed) {
    assert.equal(canEditTaskStatus(status), true, `${status} should be editable`);
  }

  for (const status of blocked) {
    assert.equal(canEditTaskStatus(status), false, `${status} should not be editable`);
  }
});
