# Repository Guidelines

## Startup
- Read `.codex-bridge.json` first.
- Load `memory/manifest.json` and `memory/acceptance-criteria.md`.
- Load `skills/manifest.json` before using project-local skills.

## Working Rules
- Treat this directory as the only Git scope for code and config changes.
- Prefer local `memory/` constraints over generic external skill defaults.
- If a requested action conflicts with `memory/execution-boundaries.md`, stop and ask.

## Project Intent
- This repository is for an export-sales assistant agent.
- Prioritize workflows around inquiry intake, customer qualification, quotation support, follow-up drafting, and human handoff.

## Expected Deliverables
- Reusable prompts, tool integrations, workflow code, evaluations, and operating docs.
- Changes should preserve auditability and avoid committing secrets.

