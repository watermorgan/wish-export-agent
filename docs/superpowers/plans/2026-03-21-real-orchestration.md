# Real LLM Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a sequential LLM orchestrator that replaces mock data with real model calls for all skills, starting with the Feedback/Translation scenario.

**Architecture:** 
- Convert `buildAssistantReply` into an async `runAssistant` function.
- Implement `CumulativeContext` to pass outputs between steps.
- Create a `MarkdownParser` to extract artifacts and risk markers from model responses.

**Tech Stack:** TypeScript, Next.js, OpenAI-compatible APIs (via `llm/router.ts`).

---

### Task 1: Core Orchestrator Refactoring

**Files:**
- Modify: `src/lib/assistant/execution.ts`
- Modify: `src/app/api/assistant/route.ts`

- [ ] **Step 1: Define StepRunner interfaces**
Add `CumulativeContext` and `StepResult` types to `execution.ts`.

- [ ] **Step 2: Implement async runAssistant loop**
Replace the static logic with a `for...of` loop over `selectedSkills`.
Load `prompt.md` for each skill.
Call `generateWithAvailableProvider` from `src/lib/assistant/llm/router.ts`.

- [ ] **Step 3: Update API Route**
Ensure `POST /api/assistant` calls the new async `runAssistant` and handles the promise.

- [ ] **Step 4: Verify with Mock Provider**
Run a task and verify the audit trail shows sequential steps being hit (even if output is still raw).

- [ ] **Step 5: Commit**
```bash
git add src/lib/assistant/execution.ts src/app/api/assistant/route.ts
git commit -m "feat: implement basic sequential step runner in execution.ts"
```

### Task 2: Structural Parser & Risk Marker Detection

**Files:**
- Create: `src/lib/assistant/parser.ts`
- Modify: `src/lib/assistant/execution.ts`

- [ ] **Step 1: Implement MarkdownParser**
Extract tables and lists from raw LLM text into `ArtifactField[]`.
Detect `[PENDING_CONFIRMATION]` or `[待确认]` tags and convert them to `PendingConfirmation` objects.

- [ ] **Step 2: Add unit test for Parser**
Create `src/lib/assistant/__tests__/parser.test.ts` and verify extraction logic with sample Markdown.

- [ ] **Step 3: Wire Parser into Orchestrator**
In the step loop, pass LLM output to the parser and append result to the reply.

- [ ] **Step 4: Commit**
```bash
git add src/lib/assistant/parser.ts src/lib/assistant/execution.ts
git commit -m "feat: add markdown parser for artifacts and risk detection"
```

### Task 3: Realizing the Feedback Chain

**Files:**
- Modify: `src/lib/assistant/execution.ts`
- Modify: `src/lib/assistant/feedback-translation.ts`

- [ ] **Step 1: Enable real model calls for Feedback**
Ensure `comment-translator` and `comment-merger` skills trigger real LLM calls instead of being short-circuited by mock logic.

- [ ] **Step 2: Verify Accumulative Context**
Ensure the input to `comment-merger` includes the output from `comment-translator`.

- [ ] **Step 3: Commit**
```bash
git add src/lib/assistant/execution.ts
git commit -m "feat: enable real LLM calls for the feedback chain"
```

### Task 4: Verification & Smoke Test

- [ ] **Step 1: Manual Verification**
Upload a small PDF with a price/delivery mention. Run the "Feedback Analysis" task.
Verify:
1. "Pending Confirmations" panel shows "Price" or "Delivery" risk.
2. "Artifacts" shows the translated text.
3. No hydration errors in the browser.

- [ ] **Step 2: Final Build Check**
Run: `npm run build && npm run lint`
Expected: SUCCESS
