# Delivery

Use this folder for accepted delivery rules, task routing, stage skill routing,
and handoff templates.

## Stage Routing

- Discussion or unclear acceptance: clarify before creating task state.
- Planning or decomposition: write a compact plan only when it changes execution.
- Development or refactor: define assumptions, smallest sufficient change,
  likely files, verification, and what not to change.
- Testing or QA: keep raw run output in `.ai-control/raw/` or the sandbox; store
  only accepted evidence summaries under `docs/initiatives/`.
- Memory promotion: route raw findings through owner review before writing
  accepted memory.

Choose one primary stage route, then add only the guardrails needed for risk,
verification, or owner intake.
