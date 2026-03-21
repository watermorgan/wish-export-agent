# Design Spec: Export Agent V1 - Baseline & Codebase Alignment

## 1. Overview
The current implementation of the Export Agent has drifted from its original acceptance criteria and memory configuration. Since the project is in its early stages, we have decided to adopt **Option B: Modify the Contract to Fit Engineering Reality**. This means we will update the business and acceptance documentation to reflect the current, pragmatic TypeScript/React implementation, rather than forcing the code into rigid legacy schema requirements. We will also clean up dead links in the configuration.

## 2. Goals
- Eliminate discrepancies between the codebase and `memory/` contracts without sacrificing the core business logic (Human-in-the-loop, no auto-send).
- Clean up broken memory links to ensure Agent context remains healthy.
- Bridge the gap in the export workflow to ensure a usable final artifact is produced.

## 3. Implementation Plan (3 Phases)

### Phase 1: Contract & Configuration Alignment (The "Compromise")
Instead of rewriting working code to use `snake_case`, we will update the rules.

*   **Update `memory/acceptance-criteria.md`**:
    *   Change `metadata.needs_human_review` to `metadata.needsHumanReview`.
    *   Change `[PENDING_CONFIRMATION]` to allow structured JSON markers or the current UI `status-pending` / `status-required` mapping, rather than forcing raw text tags.
    *   Remove the strict requirement for a dedicated `requires_manager_approval` field, acknowledging that the current `TaskStatus === 'pending_supervisor_review'` state machine handles this adequately.
    *   Relax the UI class requirement from strictly `status-pending` to "visually distinct pending statuses (e.g., `status-required`, `status-recommended`)".
*   **Update `.codex-bridge.json`**:
    *   Remove the `role_mapping` block pointing to deleted `role-*.md` files.
    *   Point any necessary boundaries directly to `execution-boundaries.md`.

### Phase 2: Resolving UI & Logic Drifts in Code
While the contract is relaxed, some logical bugs found in the audit still need fixing.

*   **Relax Submit Guard (`src/app/api/tasks/[taskId]/submit/route.ts`)**:
    *   Modify the submission logic. Currently, it blocks if *any* `required` or `returned` item exists.
    *   Ensure it aligns with the business rule: Only block if `required` items are NOT `confirmed`. If a `recommended` item is `returned`, it should not strictly block submission. (Need to verify current implementation details).
*   **Ensure `updatedBy` / `updatedAt`**:
    *   Ensure the patch endpoints for confirmations actually record the timestamp and user role modifying the data, fulfilling the audit requirement.

### Phase 3: The "Export" Artifact (Closing the Loop)
The audit correctly noted that "Exporting" just changes a state, but doesn't produce an artifact.

*   **Enhance `exportTask` (`src/lib/assistant/task-store.ts`)**:
    *   When a task is transitioned to `exported`, generate a clean, final text artifact (stripping internal IDs and tags) and save it to the task record.
*   **Update UI (`src/components/workspace.tsx`)**:
    *   When a task is `exported`, show a modal or a text area with the finalized content and a "Copy to Clipboard" button.

## 4. Dependencies & Risks
- **Risk**: Relaxing the `[PENDING_CONFIRMATION]` text marker might make it harder to parse out unresolved items if we switch LLM providers.
- **Mitigation**: We will ensure the LLM outputs a structured JSON schema where `status: 'required'` explicitly handles the "Pending" state, which is more robust than regex text parsing.
