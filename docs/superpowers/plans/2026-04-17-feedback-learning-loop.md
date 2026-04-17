# Feedback Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable Phase 1 feedback loop so translation users can report mistakes, export-agent can persist structured feedback, and developers can turn high-value corrections into glossary/rule improvement work.

**Architecture:** Keep feedback collection inside export-agent and expose it through the existing HTTP boundary used by Web/Ting. Store raw feedback as immutable case files under `data/feedback-cases/`, add a shared domain layer for validation and normalization, then add developer-side scripts that turn open feedback into review queues and glossary candidates. Do not auto-fix translations in this phase.

**Tech Stack:** Next.js App Router, TypeScript, Node `node:test`, JSON schema files, repo-local JSON persistence, existing glossary JSON files.

---

## Scope Check

This user request actually spans three subsystems:

1. feedback-driven improvement loop
2. user-selectable rendering/delivery mode
3. external-solution research / benchmark intake

This plan covers only **Subsystem 1: feedback-driven improvement loop**. Write separate plans for rendering-mode selection and external-solution benchmarking after this lands.

## File Structure

**Create**

- `src/lib/feedback/types.ts`
  Purpose: shared feedback record types, enums, and small type guards used by route, UI helpers, and scripts.
- `src/lib/feedback/normalize.ts`
  Purpose: normalize/validate incoming feedback payloads into a stable record shape before persistence.
- `src/lib/feedback/store.ts`
  Purpose: file-based persistence helpers for reserving IDs, writing case files, and reading case directories.
- `src/lib/feedback/client.ts`
  Purpose: browser-safe helper for building feedback submission payloads from task/reply state.
- `src/lib/feedback/review.ts`
  Purpose: grouping, filtering, and glossary-candidate extraction logic used by CLI scripts.
- `src/lib/feedback/__tests__/normalize.test.ts`
  Purpose: unit coverage for validation, filename safety, defaults, and payload normalization.
- `src/lib/feedback/__tests__/review.test.ts`
  Purpose: unit coverage for triage filtering and glossary-candidate extraction.
- `scripts/review-feedback-cases.ts`
  Purpose: developer CLI to list/filter feedback cases and print a triage summary.
- `scripts/promote-feedback-terms.ts`
  Purpose: developer CLI to extract term corrections into `data/glossary/candidates.json` without touching `core.json`.
- `src/components/feedback/feedback-capture.tsx`
  Purpose: compact feedback form for the workspace result area.
- `docs/project/feedback-learning-runbook.md`
  Purpose: operator guide for collecting, reviewing, and promoting feedback.

**Modify**

- `src/app/api/feedback/route.ts`
  Purpose: replace inline validation/persistence with shared feedback domain helpers and persist richer source context.
- `src/components/workspace.tsx`
  Purpose: mount the feedback capture UI near translation outputs and human review guidance.
- `src/lib/assistant/types.ts`
  Purpose: add lightweight UI-facing feedback payload types if the component needs shared typing.
- `data/feedback-cases/schema.json`
  Purpose: align JSON schema with the actual record shape used by the route and scripts.
- `data/glossary/candidates.json`
  Purpose: receive deduplicated term suggestions derived from feedback.
- `package.json`
  Purpose: add repeatable scripts for feedback review, term promotion, and test runs.
- `docs/project/feedback-loop.md`
  Purpose: update the design doc so implementation, API shape, and developer workflow match.

## Execution Preconditions

- Work in a dedicated worktree under `.worktrees/` if the implementation will run long-lived services or UI verification in parallel with other pipeline work.
- Keep Ting/OpenCloud integration out of this plan. Ting should continue calling `POST /api/feedback`; no direct filesystem writebacks outside this repo.
- Treat `term_correction` and `translation_error` as human-reviewed signals, not automatic rule writes.

### Task 1: Extract a Shared Feedback Domain Layer

**Files:**
- Create: `src/lib/feedback/types.ts`
- Create: `src/lib/feedback/normalize.ts`
- Create: `src/lib/feedback/__tests__/normalize.test.ts`
- Modify: `data/feedback-cases/schema.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing normalization test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeIncomingFeedback } from '../normalize';

test('normalizeIncomingFeedback trims strings, defaults priority/status, and rejects unsafe file names', () => {
  const normalized = normalizeIncomingFeedback({
    category: 'term_correction',
    source: {
      fileName: 'M422123.pdf',
      sourceText: ' Back elasticated waistband ',
      expectedTranslation: ' 后腰部橡筋 '
    },
    reporter: 'ting-user'
  });

  assert.equal(normalized.priority, 'medium');
  assert.equal(normalized.status, 'open');
  assert.equal(normalized.source.sourceText, 'Back elasticated waistband');
  assert.equal(normalized.source.expectedTranslation, '后腰部橡筋');

  assert.throws(() =>
    normalizeIncomingFeedback({
      category: 'translation_error',
      source: { fileName: '../secret.pdf' },
      reporter: 'bad-input'
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/feedback/__tests__/normalize.test.ts`
Expected: FAIL with `Cannot find module '../normalize'` or missing export errors.

- [ ] **Step 3: Write the shared types**

```ts
export const FEEDBACK_CATEGORIES = [
  'translation_error',
  'term_correction',
  'layout_issue',
  'missing_content',
  'noise_content',
  'general_quality'
] as const;

export const FEEDBACK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const FEEDBACK_STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'wont_fix'] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackCase = {
  id: string;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  source: {
    taskId?: string;
    fileName: string;
    pageNumber?: number;
    segmentId?: string;
    sourceText?: string;
    currentTranslation?: string;
    expectedTranslation?: string;
  };
  reporter: string;
  reportedAt: string;
  tags: string[];
  resolution: null | {
    action: 'glossary_update' | 'normalize_rule_update' | 'suppress_rule_update' | 'layout_param_update' | 'prompt_update' | 'wont_fix' | 'duplicate';
    detail: string;
    commitRef?: string;
    resolvedAt: string;
    resolvedBy: string;
  };
};
```

- [ ] **Step 4: Write the normalization helper**

```ts
import type { FeedbackCase, FeedbackCategory, FeedbackPriority } from './types';

function trimOptional(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function assertSafeFileName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || /[/\\]|\.\./.test(value)) {
    throw new Error('source.fileName 必填，且不能包含路径分隔符或 ".."。');
  }
  return value.trim();
}

export function normalizeIncomingFeedback(input: Record<string, unknown>) {
  const source = typeof input.source === 'object' && input.source !== null
    ? (input.source as Record<string, unknown>)
    : {};

  const category = input.category as FeedbackCategory;
  const priority = (input.priority as FeedbackPriority) ?? 'medium';

  return {
    category,
    priority,
    status: 'open' as const,
    source: {
      taskId: trimOptional(source.taskId),
      fileName: assertSafeFileName(source.fileName),
      pageNumber: typeof source.pageNumber === 'number' ? source.pageNumber : undefined,
      segmentId: trimOptional(source.segmentId),
      sourceText: trimOptional(source.sourceText),
      currentTranslation: trimOptional(source.currentTranslation),
      expectedTranslation: trimOptional(source.expectedTranslation)
    },
    reporter: trimOptional(input.reporter) ?? 'unknown',
    reportedAt: new Date().toISOString(),
    tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim()) : [],
    resolution: null
  } satisfies Omit<FeedbackCase, 'id'>;
}
```

- [ ] **Step 5: Align the JSON schema and add a focused test script**

```json
{
  "scripts": {
    "test:feedback": "PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx --test src/lib/feedback/__tests__/*.test.ts"
  }
}
```

Update `data/feedback-cases/schema.json` so required properties and enums match the shared types exactly.

- [ ] **Step 6: Run tests to verify the shared domain passes**

Run: `npm run test:feedback`
Expected: PASS with `normalizeIncomingFeedback` tests green.

- [ ] **Step 7: Commit**

```bash
git add package.json data/feedback-cases/schema.json src/lib/feedback/types.ts src/lib/feedback/normalize.ts src/lib/feedback/__tests__/normalize.test.ts
git commit -F - <<'EOF'
Define a shared feedback case contract before expanding the loop

The repo already accepts feedback over HTTP, but validation and record
shape are embedded in the route. Extracting a shared contract first keeps
the route, UI helpers, and future CLI tools aligned on one schema.

Constraint: Feedback must stay file-backed in-repo for this phase
Rejected: Add a database-backed feedback queue first | expands scope before the loop is usable
Confidence: high
Scope-risk: narrow
Directive: Keep feedback record shape centralized; do not reintroduce route-local enums
Tested: npm run test:feedback
Not-tested: Browser submission flow
EOF
```

### Task 2: Harden `POST /api/feedback` Around Shared Helpers

**Files:**
- Create: `src/lib/feedback/store.ts`
- Modify: `src/app/api/feedback/route.ts`
- Modify: `src/lib/feedback/__tests__/normalize.test.ts`

- [ ] **Step 1: Write the failing persistence test**

```ts
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFeedbackCase } from '../store';

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
    resolution: null
  });

  assert.match(created.id, /^fb-\d{8}-\d{3}$/);
  const saved = JSON.parse(await readFile(created.path, 'utf8'));
  assert.equal(saved.id, created.id);
  assert.equal(saved.priority, 'high');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/feedback/__tests__/normalize.test.ts`
Expected: FAIL with `Cannot find module '../store'`.

- [ ] **Step 3: Implement the file-backed store**

```ts
import path from 'node:path';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';

import type { FeedbackCase } from './types';

export async function reserveUniqueFeedbackFile(dir: string) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let count = 1; count <= 9999; count += 1) {
    const id = `fb-${today}-${String(count).padStart(3, '0')}`;
    const filePath = path.join(dir, `${id}.json`);
    try {
      const handle = await open(filePath, 'wx');
      return { id, filePath, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to reserve a unique feedback ID for today.');
}

export async function createFeedbackCase(dir: string, record: Omit<FeedbackCase, 'id'>) {
  await mkdir(dir, { recursive: true });
  const { id, filePath, handle } = await reserveUniqueFeedbackFile(dir);
  const completeRecord: FeedbackCase = { id, ...record };
  try {
    await handle.writeFile(JSON.stringify(completeRecord, null, 2), 'utf8');
  } finally {
    await handle.close();
  }
  return { id, path: filePath, record: completeRecord };
}

export async function listFeedbackCases(dir: string) {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const items = await Promise.all(
    files.map(async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8')) as FeedbackCase)
  );
  return items.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}
```

- [ ] **Step 4: Refactor the route to use normalization + store helpers**

```ts
import { NextResponse } from 'next/server';
import path from 'node:path';

import { normalizeIncomingFeedback } from '@/lib/feedback/normalize';
import { createFeedbackCase } from '@/lib/feedback/store';

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1024 * 1024) {
    return NextResponse.json({ error: '请求体过大（最大 1 MB）。' }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }

  try {
    const normalized = normalizeIncomingFeedback(body);
    const created = await createFeedbackCase(
      path.join(process.cwd(), 'data', 'feedback-cases'),
      normalized
    );
    return NextResponse.json(
      { id: created.id, path: `data/feedback-cases/${created.id}.json` },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '反馈写入失败。' },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 5: Re-run the feedback tests**

Run: `npm run test:feedback`
Expected: PASS with store creation and normalization coverage green.

- [ ] **Step 6: Manually verify the route**

Run:

```bash
curl -s -X POST http://localhost:3000/api/feedback \
  -H 'content-type: application/json' \
  -d '{
    "category":"term_correction",
    "priority":"high",
    "source":{
      "taskId":"task_demo",
      "fileName":"M422123.pdf",
      "pageNumber":1,
      "segmentId":"seg-p1-003",
      "sourceText":"Back elasticated waistband",
      "currentTranslation":"后部弹性腰带",
      "expectedTranslation":"后腰部橡筋"
    },
    "reporter":"workspace-user",
    "tags":["术语","M422123"]
  }'
```

Expected: `201` with a JSON payload containing `id` and `path`, plus a new `data/feedback-cases/fb-*.json` file.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/feedback/route.ts src/lib/feedback/store.ts src/lib/feedback/__tests__/normalize.test.ts
git commit -F - <<'EOF'
Make feedback intake reuse the shared domain and file store

Phase 1 depends on trustworthy raw feedback capture. Moving route behavior
onto shared helpers reduces drift and makes the CLI workflow consume the
same normalized record shape that the API writes.

Constraint: Keep the existing HTTP contract available to Ting/OpenCloud callers
Rejected: Keep validation inline inside the route | guarantees future drift once scripts and UI appear
Confidence: high
Scope-risk: narrow
Directive: Preserve immutable raw feedback records; follow-up tooling should read and derive, not rewrite
Tested: npm run test:feedback; manual curl POST /api/feedback
Not-tested: Concurrent writes under production load
EOF
```

### Task 3: Add a Workspace Feedback Capture Entry Point

**Files:**
- Create: `src/lib/feedback/client.ts`
- Create: `src/components/feedback/feedback-capture.tsx`
- Modify: `src/components/workspace.tsx`
- Modify: `src/lib/assistant/types.ts`

- [ ] **Step 1: Write the failing client payload test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFeedbackDraft } from '../client';

test('buildFeedbackDraft pre-fills translation context from active task state', () => {
  const draft = buildFeedbackDraft({
    taskId: 'task_123',
    fileName: 'M422123.pdf',
    category: 'term_correction',
    sourceText: 'Back elasticated waistband',
    currentTranslation: '后部弹性腰带'
  });

  assert.equal(draft.category, 'term_correction');
  assert.equal(draft.source.taskId, 'task_123');
  assert.equal(draft.source.fileName, 'M422123.pdf');
  assert.equal(draft.source.sourceText, 'Back elasticated waistband');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:feedback`
Expected: FAIL with `Cannot find module '../client'`.

- [ ] **Step 3: Add a browser-safe payload builder**

```ts
import type { FeedbackCategory } from './types';

export function buildFeedbackDraft(input: {
  taskId?: string;
  fileName: string;
  category: FeedbackCategory;
  sourceText?: string;
  currentTranslation?: string;
}) {
  return {
    category: input.category,
    priority: 'medium' as const,
    source: {
      taskId: input.taskId,
      fileName: input.fileName,
      sourceText: input.sourceText,
      currentTranslation: input.currentTranslation
    },
    reporter: 'workspace-user',
    tags: []
  };
}
```

- [ ] **Step 4: Create the feedback capture component**

```tsx
'use client';

import { useState, useTransition } from 'react';

type Props = {
  taskId?: string | null;
  fileName: string;
  sourceText?: string;
  currentTranslation?: string;
};

export function FeedbackCapture({ taskId, fileName, sourceText, currentTranslation }: Props) {
  const [category, setCategory] = useState<'term_correction' | 'translation_error' | 'layout_issue'>('translation_error');
  const [expectedTranslation, setExpectedTranslation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit() {
    startTransition(async () => {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          priority: category === 'translation_error' ? 'high' : 'medium',
          source: {
            taskId,
            fileName,
            sourceText,
            currentTranslation,
            expectedTranslation
          },
          reporter: 'workspace-user'
        })
      });
      const payload = await response.json();
      setMessage(response.ok ? `已记录反馈：${payload.id}` : payload.error ?? '提交失败');
    });
  }

  return (
    <section className="answer-card">
      <h3>反馈这次翻译</h3>
      <p className="meta-note">把错译、术语建议或版式问题记下来，后续进入统一复盘和规则收敛。</p>
      <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
        <option value="translation_error">错翻 / 表达不准</option>
        <option value="term_correction">术语纠正</option>
        <option value="layout_issue">版式问题</option>
      </select>
      <textarea value={expectedTranslation} onChange={(event) => setExpectedTranslation(event.target.value)} placeholder="期望译法或问题描述" />
      <button type="button" onClick={submit} disabled={isPending || expectedTranslation.trim().length === 0}>
        {isPending ? '提交中…' : '记录反馈'}
      </button>
      {message ? <p className="meta-note">{message}</p> : null}
    </section>
  );
}
```

- [ ] **Step 5: Mount the component in the workspace result area**

```tsx
const sourceName = reply?.task?.files?.[0]?.name ?? files[0]?.name ?? 'unknown.pdf';
const firstTranslationField = reply?.artifacts
  .flatMap((section) => section.fields)
  .find((field) => typeof field.value === 'string' && field.value.trim().length > 0);

{reply ? (
  <FeedbackCapture
    taskId={activeTaskId}
    fileName={sourceName}
    sourceText={firstTranslationField?.citation}
    currentTranslation={firstTranslationField?.value}
  />
) : null}
```

Import the new component into `src/components/workspace.tsx` and add any minimal shared feedback types to `src/lib/assistant/types.ts` only if they are reused by the UI.

- [ ] **Step 6: Re-run feedback unit tests**

Run: `npm run test:feedback`
Expected: PASS with the client helper included.

- [ ] **Step 7: Manually verify the UI flow**

Run:

```bash
npm run dev
```

Expected:
- Upload a feedback PDF in the workspace
- Generate a result
- See a `反馈这次翻译` card below the result area
- Submit one `term_correction`
- Observe a success message with the new feedback ID

- [ ] **Step 8: Commit**

```bash
git add src/lib/feedback/client.ts src/components/feedback/feedback-capture.tsx src/components/workspace.tsx src/lib/assistant/types.ts
git commit -F - <<'EOF'
Add a workspace entry point for structured translation feedback

The loop is not useful unless users can report concrete translation problems
from the result they just saw. This adds the minimum UI needed to turn
translation dissatisfaction into structured feedback cases.

Constraint: Avoid introducing a new frontend test stack in this phase
Rejected: Add feedback UI to every page immediately | broadens scope before the core loop is proven
Confidence: medium
Scope-risk: moderate
Directive: Keep capture UI compact and structured; freeform comments alone are not enough for later triage
Tested: npm run test:feedback; manual workspace submission in dev
Not-tested: Ting/OpenCloud caller UX
EOF
```

### Task 4: Add Developer Triage and Glossary-Promotion Tooling

**Files:**
- Create: `src/lib/feedback/review.ts`
- Create: `src/lib/feedback/__tests__/review.test.ts`
- Create: `scripts/review-feedback-cases.ts`
- Create: `scripts/promote-feedback-terms.ts`
- Modify: `data/glossary/candidates.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing review test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { extractGlossaryCandidates, filterFeedbackCases } from '../review';

test('extractGlossaryCandidates deduplicates term corrections by source text', () => {
  const candidates = extractGlossaryCandidates([
    {
      id: 'fb-20260417-001',
      category: 'term_correction',
      priority: 'high',
      status: 'open',
      source: {
        fileName: 'M422123.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰部橡筋'
      },
      reporter: 'workspace-user',
      reportedAt: '2026-04-17T00:00:00.000Z',
      tags: ['术语'],
      resolution: null
    },
    {
      id: 'fb-20260417-002',
      category: 'term_correction',
      priority: 'medium',
      status: 'open',
      source: {
        fileName: 'M441083.pdf',
        sourceText: 'Back elasticated waistband',
        expectedTranslation: '后腰部橡筋'
      },
      reporter: 'ting-user',
      reportedAt: '2026-04-17T01:00:00.000Z',
      tags: ['术语'],
      resolution: null
    }
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].en, 'Back elasticated waistband');
  assert.equal(candidates[0].zh, '后腰部橡筋');
  assert.equal(candidates[0].source, 'feedback_extraction');
  assert.equal(candidates[0].reviewStatus, 'pending');
  assert.match(candidates[0].notes ?? '', /fb-20260417-001/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:feedback`
Expected: FAIL with `Cannot find module '../review'`.

- [ ] **Step 3: Implement review helpers**

```ts
import type { FeedbackCase } from './types';

export function filterFeedbackCases(
  items: FeedbackCase[],
  filters: { status?: string; priority?: string; category?: string }
) {
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.category && item.category !== filters.category) return false;
    return true;
  });
}

export function extractGlossaryCandidates(items: FeedbackCase[]) {
  const map = new Map<string, {
    en: string;
    zh: string;
    context: 'general';
    source: 'feedback_extraction';
    confidence: number;
    reviewStatus: 'pending';
    addedAt: string;
    notes: string;
  }>();

  for (const item of items) {
    const en = item.source.sourceText?.trim();
    const zh = item.source.expectedTranslation?.trim();
    if (!en || !zh) continue;
    if (item.category !== 'term_correction' && item.category !== 'translation_error') continue;

    const key = `${en.toLowerCase()}::${zh}`;
    const current = map.get(key) ?? {
      en,
      zh,
      context: 'general' as const,
      source: 'feedback_extraction' as const,
      confidence: 0.8,
      reviewStatus: 'pending' as const,
      addedAt: new Date().toISOString().slice(0, 10),
      notes: `sourceFeedbackIds=${item.id}`
    };
    if (!current.notes.includes(item.id)) {
      current.notes = `${current.notes},${item.id}`;
    }
    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => a.en.localeCompare(b.en));
}
```

- [ ] **Step 4: Create the developer review CLI**

```ts
#!/usr/bin/env tsx
import path from 'node:path';

import { listFeedbackCases } from '@/lib/feedback/store';
import { filterFeedbackCases } from '@/lib/feedback/review';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.split('=');
  return [key.replace(/^--/, ''), value ?? ''];
}));

const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
const items = await listFeedbackCases(feedbackDir);
const filtered = filterFeedbackCases(items, {
  status: args.get('status'),
  priority: args.get('priority'),
  category: args.get('category')
});

for (const item of filtered) {
  console.log(`[${item.priority}] ${item.id} ${item.category} ${item.source.fileName} ${item.source.sourceText ?? ''}`);
}
console.log(`total=${filtered.length}`);
```

- [ ] **Step 5: Create the glossary-promotion CLI**

```ts
#!/usr/bin/env tsx
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { listFeedbackCases } from '@/lib/feedback/store';
import { extractGlossaryCandidates } from '@/lib/feedback/review';

const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
const glossaryPath = path.join(process.cwd(), 'data', 'glossary', 'candidates.json');

const existing = JSON.parse(await readFile(glossaryPath, 'utf8')) as {
  version: string;
  updatedAt: string;
  entries: Array<{
    en: string;
    zh: string;
    context: string;
    source: string;
    confidence?: number;
    reviewStatus: string;
    addedAt?: string;
    notes?: string;
  }>;
};

const openCases = (await listFeedbackCases(feedbackDir)).filter((item) => item.status === 'open');
const nextCandidates = extractGlossaryCandidates(openCases);
const mergedEntries = [...existing.entries];

for (const candidate of nextCandidates) {
  const seen = mergedEntries.some((entry) => entry.en === candidate.en && entry.zh === candidate.zh);
  if (!seen) {
    mergedEntries.push(candidate);
  }
}

await writeFile(
  glossaryPath,
  JSON.stringify(
    { ...existing, updatedAt: new Date().toISOString().slice(0, 10), entries: mergedEntries },
    null,
    2
  ),
  'utf8'
);
```

- [ ] **Step 6: Add package scripts**

```json
{
  "scripts": {
    "feedback:review": "PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npx tsx scripts/review-feedback-cases.ts",
    "feedback:promote-terms": "PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npx tsx scripts/promote-feedback-terms.ts"
  }
}
```

- [ ] **Step 7: Verify scripts and tests**

Run:

```bash
npm run test:feedback
npm run feedback:review -- --status=open
npm run feedback:promote-terms
```

Expected:
- tests pass
- review command prints filtered items
- term-promotion command appends new deduplicated entries into `data/glossary/candidates.json`
- promoted entries remain compatible with `data/glossary/schema.json`

- [ ] **Step 8: Commit**

```bash
git add package.json data/glossary/candidates.json src/lib/feedback/review.ts src/lib/feedback/__tests__/review.test.ts scripts/review-feedback-cases.ts scripts/promote-feedback-terms.ts
git commit -F - <<'EOF'
Add developer tooling to review feedback and promote glossary candidates

Capturing feedback is only half the loop. This adds the minimum developer
tooling required to triage open cases and turn repeated term corrections
into structured candidate glossary entries for later review.

Constraint: Do not auto-write approved terms into glossary core.json
Rejected: Make the API auto-promote term corrections on write | removes human review from the improvement path
Confidence: high
Scope-risk: moderate
Directive: Candidates are review inputs, not production truth; keep core.json human-gated
Tested: npm run test:feedback; npm run feedback:review -- --status=open; npm run feedback:promote-terms
Not-tested: Large-volume feedback directories
EOF
```

### Task 5: Document the Operating Loop and Verify End-to-End Behavior

**Files:**
- Create: `docs/project/feedback-learning-runbook.md`
- Modify: `docs/project/feedback-loop.md`

- [ ] **Step 1: Write the runbook**

```md
# Feedback Learning Runbook

## Daily / per-batch routine

1. Review new cases:
   `npm run feedback:review -- --status=open`
2. Pull term suggestions:
   `npm run feedback:promote-terms`
3. Manually inspect `data/glossary/candidates.json`
4. Decide whether each case becomes:
   - glossary update
   - normalize rule update
   - suppress rule update
   - layout parameter tweak
5. After code changes land, mark the originating feedback cases with a `resolution`
```

- [ ] **Step 2: Update the design doc to match reality**

Add to `docs/project/feedback-loop.md`:

```md
- Raw feedback is written via `POST /api/feedback`
- Workspace now exposes a compact feedback capture entry point
- Developer-side loop uses:
  - `npm run feedback:review -- --status=open`
  - `npm run feedback:promote-terms`
- `data/glossary/candidates.json` is the staging area for human-reviewed term promotion
```

- [ ] **Step 3: Run an end-to-end smoke check**

Run:

```bash
npm run dev
npm run test:feedback
curl -s http://localhost:3000/api/tasks
curl -s -X POST http://localhost:3000/api/feedback \
  -H 'content-type: application/json' \
  -d '{
    "category":"term_correction",
    "source":{
      "fileName":"M422123.pdf",
      "sourceText":"Back elasticated waistband",
      "expectedTranslation":"后腰部橡筋"
    },
    "reporter":"smoke"
  }'
npm run feedback:review -- --status=open --category=term_correction
```

Expected:
- dev server runs
- feedback tests pass
- `/api/tasks` returns a JSON object with a `tasks` array
- feedback route accepts a new case
- review CLI can immediately see the newly written record

- [ ] **Step 4: Commit**

```bash
git add docs/project/feedback-loop.md docs/project/feedback-learning-runbook.md
git commit -F - <<'EOF'
Document the feedback loop as an operational workflow

The feedback loop now spans capture, triage, and promotion tooling. The
docs need to describe the real operator path so future work improves the
system instead of reinterpreting it from chat history.

Constraint: Keep feedback handling inside export-agent's existing repo-local workflow
Rejected: Leave workflow knowledge in ad-hoc chat notes | creates repeatability gaps
Confidence: high
Scope-risk: narrow
Directive: Update this runbook whenever the loop adds a new review or promotion step
Tested: npm run test:feedback; manual end-to-end smoke check
Not-tested: Multi-user concurrent operator workflow
EOF
```

## Plan Self-Review

### Spec coverage

- feedback capture from users: covered in Task 3
- structured persistence and stable schema: covered in Tasks 1-2
- developer review workflow: covered in Task 4
- glossary candidate promotion: covered in Task 4
- operator docs and end-to-end verification: covered in Task 5

### Placeholder scan

- No `TODO` / `TBD`
- every code step includes concrete snippets
- every verification step includes exact commands and expected outcomes

### Type consistency

- shared enums and `FeedbackCase` live in `src/lib/feedback/types.ts`
- route, UI helpers, and review scripts all consume the same normalized record shape

## Deferred Follow-Up Plans

- `rendering-mode-selection`: let users choose inline-annotated vs side-panel/list delivery mode when the pipeline has enough content to support both.
- `translation-benchmark-intake`: research external document-translation approaches, define comparison criteria, and import a benchmark harness instead of relying only on local iterative tuning.
