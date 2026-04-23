import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevisionResponse,
  buildTaskRevisionSummary,
  createOverrideRevisionRequest,
  createReworkRevisionRequest,
  ensureBaseTaskRevision,
  finalizeLatestTaskRevision,
  replaceReworkTargetPages
} from '../task-iteration';
import type { AssistantReply, AssistantRequest } from '../types';
import type { TranslationSnapshot } from '../translation-pipeline';

function makeRequest(): AssistantRequest {
  return {
    channel: 'web',
    role: 'sales',
    question: '测试翻译任务',
    files: [],
    selectedSkillIds: ['comment-translator'],
    selectedTemplateId: 'translation-merge',
    taskType: 'feedback'
  };
}

function makeReply(taskId = 'task-test'): AssistantReply {
  return {
    intent: 'feedback',
    intentLabel: '意见翻译',
    role: 'sales',
    status: 'pending_user_confirmation',
    statusLabel: '待人工确认',
    reviewStatus: 'not_submitted',
    reviewStatusLabel: '未提交审核',
    summary: 'ready',
    nextActions: [],
    riskAlerts: [],
    draftDirection: 'test',
    taskType: 'feedback',
    taskTypeLabel: '意见翻译',
    skillCatalog: [],
    templates: [],
    selectedSkills: [],
    selectedTemplate: null,
    executionPlan: [],
    pendingConfirmations: [],
    blockingIssues: [],
    validationIssues: [],
    artifacts: [],
    auditTrail: [],
    task: {
      id: taskId,
      title: 'task',
      role: 'sales',
      taskType: 'feedback',
      taskTypeLabel: '意见翻译',
      question: 'q',
      files: [],
      selectedSkillIds: ['comment-translator'],
      selectedTemplateId: 'translation-merge',
      status: 'pending_user_confirmation',
      reviewStatus: 'not_submitted',
      summary: 'ready',
      pendingConfirmationCount: 0,
      blockingIssueCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    recentTasks: []
  };
}

function makeSnapshot(): TranslationSnapshot {
  return {
    version: 'translation_snapshot_v1',
    generatedAt: new Date().toISOString(),
    fileName: 'demo.pdf',
    documentMainType: 'sketch_comment',
    outputStrategy: 'annotated_pdf',
    diagnostics: {
      translatedSegmentCount: 1,
      translationCoveragePct: 100,
      aModelExecuted: false,
      bModelExecuted: true
    },
    items: [
      {
        id: 'seg-1',
        pageNumber: 10,
        regionId: 'p10_r1',
        en: 'Pocket',
        zh: '口袋',
        renderMode: 'footnote',
        sourceType: 'vision',
        confidence: 1
      }
    ]
  };
}

test('creating a task initializes base revision metadata', () => {
  const request = ensureBaseTaskRevision(makeRequest(), 'task-1');
  const summary = buildTaskRevisionSummary(request);

  assert(summary);
  assert.equal(summary.baseRevisionId, summary.currentRevisionId);
  assert.equal(summary.revisionCount, 1);
  assert.equal(summary.latestRevision?.kind, 'base');
});

test('successful override creates child revision and advances current revision', () => {
  const baseRequest = ensureBaseTaskRevision(makeRequest(), 'task-1');
  const nextRequest = createOverrideRevisionRequest(baseRequest, 'task-1', 'sales', '补翻第10页', {
    forceVisionPages: [10]
  });
  const readyRequest = finalizeLatestTaskRevision(nextRequest, 'ready');
  const summary = buildTaskRevisionSummary(readyRequest);

  assert(summary);
  assert.equal(summary.revisionCount, 2);
  assert.equal(summary.latestRevision?.kind, 'override');
  assert.equal(summary.latestRevision?.parentRevisionId, summary.baseRevisionId);
  assert.deepEqual(summary.currentControl?.pageOverrides?.forceVisionPages, [10]);
});

test('failed rework preserves previous current revision and keeps failed revision in history', () => {
  const baseRequest = ensureBaseTaskRevision(makeRequest(), 'task-1');
  const overrideRequest = finalizeLatestTaskRevision(
    createOverrideRevisionRequest(baseRequest, 'task-1', 'sales', '补翻第10页', {
      forceVisionPages: [10]
    }),
    'ready'
  );
  const overrideSummary = buildTaskRevisionSummary(overrideRequest);
  assert(overrideSummary);
  const rework = replaceReworkTargetPages(
    {
      scope: 'pages',
      instruction: '重做指定区域',
      pageNumbers: [10]
    },
    [10]
  );
  const reworkRequest = createReworkRevisionRequest(
    overrideRequest,
    'task-1',
    'sales',
    '重做口袋区域',
    rework,
    makeSnapshot()
  );
  const failedRequest = finalizeLatestTaskRevision(reworkRequest, 'failed');
  const summary = buildTaskRevisionSummary(failedRequest);

  assert(summary);
  assert.equal(summary.currentRevisionId, overrideSummary.currentRevisionId);
  assert.equal(summary.latestRevision?.kind, 'override');
  const reworkSummary = buildTaskRevisionSummary(reworkRequest);
  assert(reworkSummary);
  const failedRevision = buildRevisionResponse(
    failedRequest,
    makeReply(),
    reworkSummary.currentRevisionId
  );
  assert(failedRevision);
  assert.equal(failedRevision.revision.state, 'failed');
});

test('revision lookup returns historical revision instead of only current snapshot', () => {
  const baseRequest = ensureBaseTaskRevision(makeRequest(), 'task-1');
  const overrideRequest = finalizeLatestTaskRevision(
    createOverrideRevisionRequest(baseRequest, 'task-1', 'sales', '补翻第10页', {
      forceVisionPages: [10]
    }),
    'ready'
  );
  const summary = buildTaskRevisionSummary(overrideRequest);
  assert(summary);
  const historical = buildRevisionResponse(overrideRequest, makeReply(), summary.baseRevisionId);
  assert(historical);
  assert.equal(historical.current, false);
  assert.equal(historical.revision.kind, 'base');
  assert.equal(historical.result.deliveryPdfUrl, '/api/tasks/task-test/translation-pdf?download=1');
});
