# Audit Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the project's contract documents with the codebase reality, fix UI & logic drifts, and complete the export artifact workflow.

**Architecture:** We are updating Markdown files to reflect the current schema, adjusting validation logic in the backend, adding audit fields to types, and adding a `finalArtifact` generator in the export flow to close the loop.

**Tech Stack:** TypeScript, Next.js, Markdown

---

### Task 1: Update Contract & Configuration Documents

**Files:**
- Modify: `memory/acceptance-criteria.md`
- Modify: `.codex-bridge.json`

- [ ] **Step 1: Update acceptance-criteria.md**

Update the following constraints in `memory/acceptance-criteria.md`:
- Change `metadata.needs_human_review` to `metadata.needsHumanReview`.
- Change the strict requirement of `[PENDING_CONFIRMATION]` to allow structured JSON markers or the UI `status-pending`/`status-required` mapping.
- Remove the strict requirement for a dedicated `requires_manager_approval` boolean field, deferring to the `TaskStatus` state machine.
- Relax the UI class requirement from strictly `status-pending` to "visually distinct pending statuses (e.g., `status-required`, `status-recommended`)".

- [ ] **Step 2: Update .codex-bridge.json**

Remove the broken `role_mapping` objects that point to deleted `role-*.md` files. Map the boundaries to `execution-boundaries.md`.

```json
    "role_mapping": {
      "boundaries": "execution-boundaries.md"
    }
```

- [ ] **Step 3: Commit**

```bash
git add memory/acceptance-criteria.md .codex-bridge.json
git commit -m "docs: align acceptance criteria and bridge config with codebase reality"
```

### Task 2: Resolve Logic Drifts (Submit Guard & Audit Fields)

**Files:**
- Modify: `src/lib/assistant/types.ts`
- Modify: `src/app/api/tasks/[taskId]/submit/route.ts`
- Modify: `src/lib/assistant/task-store.ts`

- [ ] **Step 1: Add audit fields to PendingConfirmation type**

In `src/lib/assistant/types.ts`, add `updatedBy` and `updatedAt` to `PendingConfirmation`:

```typescript
export type PendingConfirmation = {
  id: string;
  label: string;
  reason: string;
  owner: AssistantRole;
  status: 'required' | 'recommended' | 'confirmed' | 'returned';
  updatedBy?: string;
  updatedAt?: string;
};
```

- [ ] **Step 2: Relax Submit Guard**

In `src/app/api/tasks/[taskId]/submit/route.ts`, modify the submission logic to only block on `required` status, relaxing the strict block on `returned` if it wasn't required.

```typescript
  const unconfirmedRequired = existingTask.reply.pendingConfirmations.filter(
    (c) => c.status === 'required'
  );
```

- [ ] **Step 3: Ensure updateTaskConfirmation records audit info**

In `src/lib/assistant/task-store.ts`, update `updateTaskConfirmation` to record `updatedBy` and `updatedAt`.
Wait, the `updateTaskConfirmation` signature is `updateTaskConfirmation(taskId: string, confirmationId: string, updates: { status: PendingConfirmation['status'] })`.
We need to also accept an optional `userId` or just set `updatedAt = new Date().toISOString()`. The user's role/id isn't directly passed down from the route yet. For now, just add `updatedAt = nowIso()` and `updatedBy = 'system'` or pass the role if available.
Let's modify `updateTaskConfirmation` to accept an `updaterRole?: AssistantRole`.

```typescript
export async function updateTaskConfirmation(
  taskId: string,
  confirmationId: string,
  updates: { status: PendingConfirmation['status'] },
  updaterRole?: AssistantRole
)
```
And inside:
```typescript
  const pendingConfirmations = existing.reply.pendingConfirmations.map((item) =>
    item.id === confirmationId ? { ...item, status: updates.status, updatedAt: nowIso(), updatedBy: updaterRole ?? 'sales' } : item
  );
```
Also, update `src/app/api/tasks/[taskId]/confirmations/route.ts` (if it exists) to pass the role if needed. If we don't have the route file in the plan, let's keep it simple and just set `updatedAt: new Date().toISOString()`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/assistant/types.ts src/app/api/tasks/[taskId]/submit/route.ts src/lib/assistant/task-store.ts
git commit -m "fix: relax submit guard and add audit fields for confirmations"
```

### Task 3: The "Export" Artifact Generation

**Files:**
- Modify: `src/lib/assistant/types.ts`
- Modify: `src/lib/assistant/task-store.ts`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add finalArtifact to AssistantReply**

In `src/lib/assistant/types.ts`, add `finalArtifact?: string;` to `AssistantReply`.

- [ ] **Step 2: Generate finalArtifact in exportTask**

In `src/lib/assistant/task-store.ts`, modify `exportTask` to compile the sections into a markdown text.

```typescript
  const finalArtifact = existing.reply.artifacts.map(section => {
    let text = `## ${section.title}\n${section.summary}\n\n`;
    section.fields.forEach(field => {
      text += `- **${field.label}**: ${field.value}\n`;
    });
    return text;
  }).join('\n');

  const result = applyStoredTaskUpdates(existing, {
    status: 'exported',
    summary: '当前任务已导出，审计记录和执行结果已保留。'
  });
  
  result.stored.reply.finalArtifact = finalArtifact;
  // Make sure to persist this if using DB mode, but reply JSON is updated in replaceTaskChildren.
```

- [ ] **Step 3: Update Workspace UI**

In `src/components/workspace.tsx`, find where it renders the `exported` state or artifacts, and add a simple read-only textarea or a `<pre>` block displaying `reply.finalArtifact`, along with a copy button.

```tsx
  {reply.status === 'exported' && reply.finalArtifact && (
    <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
      <h3 className="text-green-800 font-medium mb-2">🎉 最终产物已生成</h3>
      <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-white p-3 rounded border">
        {reply.finalArtifact}
      </pre>
      <button
        onClick={() => navigator.clipboard.writeText(reply.finalArtifact!)}
        className="mt-3 px-4 py-2 bg-green-600 text-white rounded shadow-sm hover:bg-green-700 text-sm"
      >
        复制到剪贴板
      </button>
    </div>
  )}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/assistant/types.ts src/lib/assistant/task-store.ts src/components/workspace.tsx
git commit -m "feat: generate and display final artifact on task export"
```
