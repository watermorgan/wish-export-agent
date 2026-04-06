# Multi-Role Frontend Stability & UI Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve hydration mismatches, enforce theme consistency across all components, and verify functionality across Sales and Supervisor roles.

**Architecture:** 
- Use "Mounted Pattern" to defer client-only rendering (theme/role init).
- Strict enforcement of semantic Tailwind variables.
- Multi-role smoke tests.

**Tech Stack:** Next.js 15, Tailwind CSS, TypeScript.

---

### Task 1: Fix Hydration & Baseline Styling

**Files:**
- Modify: `src/components/workspace/WorkspaceLayout.tsx`
- Modify: `src/components/workspace/TaskResults.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Implement Mounted Guard in Layout**
Ensure the layout doesn't render role-specific or theme-specific data until the client is mounted.

- [ ] **Step 2: Clean Cache and Rebuild**
Run: `rm -rf .next && npm run build`
Expected: Success.

- [ ] **Step 3: Commit**
```bash
git add .
git commit -m "fix: resolve hydration mismatch via mounted guard"
```

### Task 2: Multi-Role UX/UI Audit & Polish

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/header.tsx`
- Modify: `src/components/workspace/TaskInitiation.tsx`

- [ ] **Step 1: Audit Sales Role View**
Verify all cards, buttons, and inputs follow the "Fresh" theme. Fix any remaining `text-slate-x` or `bg-white`.

- [ ] **Step 2: Audit Supervisor Role View**
Switch to supervisor role. Verify the Audit Queue and task risks are visually prominent and themed.

- [ ] **Step 3: Commit**
```bash
git add .
git commit -m "style: unify UI for both Sales and Supervisor roles"
```

### Task 3: Comprehensive Multi-Role Testing

- [ ] **Step 1: Role Switch Test**
Verify that switching roles updates the sidebar badge, header status, and recent task list filtering.

- [ ] **Step 2: Theme Persistence Test**
Verify that the `data-theme` attribute is applied consistently and survives a page reload (simulated).

- [ ] **Step 3: Final Production Build Check**
Run: `npm run build && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**
```bash
git add .
git commit -m "test: verify multi-role stability and theme consistency"
```
