# Unified Theme Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the visual theme by replacing hardcoded colors with theme variables and ensuring full compatibility between "Professional" and "Fresh" themes.

**Architecture:** 
- Map all visual semantics (bg, text, border, shadow) to CSS variables in `globals.css`.
- Synchronize `tailwind.config.js` with these semantic variables.
- Systematically replace hardcoded Tailwind classes (e.g., `bg-white`, `border-slate-50`) with semantic classes (e.g., `bg-surface`, `border-outline`).

**Tech Stack:** Tailwind CSS, Next.js, React.

---

### Task 1: Standardize Tailwind Configuration & Global Styles

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Expand Tailwind Config with Semantic Variables**

```javascript
// tailwind.config.js
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        "success-mint": "var(--color-success-mint)",
        "risk-coral": "var(--color-risk-coral)",
        ivory: "var(--color-ivory)",
        "on-surface": "var(--color-on-surface)",
        surface: "var(--color-surface)",
        outline: "var(--color-outline)",
        muted: "var(--color-muted)",      // New
        accent: "var(--color-primary)",   // Alias
        "accent-soft": "var(--color-accent-soft)", // New
      },
```

- [ ] **Step 2: Align Global CSS Variables**

Ensure both themes in `globals.css` define `---color-muted`, `--color-accent-soft`, and `--color-outline`.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.js src/app/globals.css
git commit -m "style: standardize semantic tailwind variables"
```

### Task 2: Refactor Layout Components (Sidebar & Header)

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Clean up Sidebar classes**
Replace `text-muted`, `border-line`, `bg-ivory` with `text-muted`, `border-outline`, `bg-ivory`.

- [ ] **Step 2: Clean up Header classes**
Ensure `bg-surface`, `border-outline` are used instead of `bg-white` or `border-line`.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/
git commit -m "style: theme-aware sidebar and header"
```

### Task 3: Refactor Core Workspace Components

**Files:**
- Modify: `src/components/workspace/TaskInitiation.tsx`
- Modify: `src/components/workspace/TaskResults.tsx`
- Modify: `src/components/workspace/ConfirmationPanel.tsx`
- Modify: `src/components/workspace/TaskHistory.tsx`

- [ ] **Step 1: Unify TaskInitiation colors**
Replace all `bg-white` with `bg-surface`.
Replace `border-slate-50` and `border-slate-100` with `border-outline`.
Replace `text-slate-800` with `text-on-surface`.

- [ ] **Step 2: Unify TaskResults colors**
Follow the same pattern for cards, buttons, and text.

- [ ] **Step 3: Unify ConfirmationPanel colors**
Ensure status-based cards use semantic tints (e.g., `bg-risk-coral/10` instead of hardcoded reds).

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/
git commit -m "style: theme-aware workspace components"
```

### Task 4: Final Verification & Test

- [ ] **Step 1: Run build verification**
Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 2: Visual check (Manual)**
Verify that toggling the theme in the header correctly updates all backgrounds, borders, and text colors without any "white spots" left.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "style: final theme unification verified"
```
