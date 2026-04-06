# Frontend Optimization & Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the workspace into atomic components, apply the "Fresh & Lively" design system, implement theme/role switching, and verify functionality with tests.

**Architecture:** Component-based architecture (Next.js/React). Styling via Tailwind CSS with a unified color palette. State management via custom hooks.

**Tech Stack:** Next.js, React, Tailwind CSS, Lucide React (or Material Symbols), Vitest (if available) / npm build.

---

### Task 1: Component Decomposition & Layout Scaffolding

**Files:**
- Create: `src/components/workspace/WorkspaceLayout.tsx`
- Create: `src/components/workspace/TaskInitiation.tsx`
- Create: `src/components/workspace/TaskResults.tsx`
- Create: `src/components/workspace/ConfirmationPanel.tsx`
- Create: `src/components/workspace/TaskHistory.tsx`
- Create: `src/components/workspace/index.ts`
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Create the new component structure**
Scaffold the files under `src/components/workspace/`. Move logic from the main `workspace.tsx` into specialized hooks if necessary (e.g., `useTaskActions`).

- [ ] **Step 2: Implement WorkspaceLayout**
Apply the sidebar and header structure from the Stitch design.

- [ ] **Step 3: Commit**
```bash
git add src/components/workspace/
git commit -m "refactor: scaffold workspace component decomposition"
```

### Task 2: UI Styling & Theme/Role Switching Logic

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/app/globals.css`
- Modify: `src/components/workspace/WorkspaceLayout.tsx`

- [ ] **Step 1: Update Tailwind Config**
Add the new periwinkle, peach, mint, and coral colors to `tailwind.config.ts`.

- [ ] **Step 2: Implement Theme Switcher**
Add a state `theme: 'professional' | 'fresh'` and use it to toggle class names or CSS variables on the container.

- [ ] **Step 3: Implement Role Switcher**
Ensure the "Salesperson / Supervisor" toggle in the header correctly updates the `role` state and reflects in the UI.

- [ ] **Step 4: Commit**
```bash
git add tailwind.config.js src/app/globals.css src/components/workspace/
git commit -m "feat: apply Fresh & Lively design and implement theme/role switching"
```

### Task 3: Functional Testing & Verification

**Files:**
- Create: `src/components/workspace/__tests__/Workspace.test.tsx` (If Vitest is set up)
- Run: `npm run build`
- Run: `npm run lint`

- [ ] **Step 1: Verify Core State Transitions**
Manual test: Switching roles updates the visible task list. Switching templates updates the prompt.

- [ ] **Step 2: Run Full Build**
Run: `npm run build`
Expected: No compilation errors.

- [ ] **Step 3: Final Verification using superpowers**
Invoke `verification-before-completion` to ensure all P0/P1 items from the audit are addressed in the new UI.

- [ ] **Step 4: Commit**
```bash
git add .
git commit -m "test: verify frontend optimization and layout integrity"
```
