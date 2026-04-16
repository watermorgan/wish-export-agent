# Repository Guidelines

## Startup
- Read `.codex-bridge.json` first.
- Load `memory/manifest.json` and `memory/acceptance-criteria.md`.
- Load `skills/manifest.json` before using project-local skills.

## Working Rules
- Treat this directory as the only Git scope for code and config changes.
- Prefer local `memory/` constraints over generic external skill defaults.
- If a requested action conflicts with `memory/execution-boundaries.md`, stop and ask.
- After any non-trivial debugging or architecture change, persist durable conclusions into `memory/` and the relevant `docs/project/` files instead of leaving them only in chat history.
- **Parallel Development (Git Worktree)**: 
  - For tasks requiring long-running services (e.g., UI dev servers on port 3005) or strict isolation from mainline logic, use `git worktree`.
  - Maintain the main directory for core algorithm and pipeline development.
  - Worktrees should be located in `.worktrees/` and use descriptive branch names.
  - This prevents environment corruption and allows concurrent testing of logic vs. presentation.

## Project Intent
- This repository is **export-agent**: a standalone AI workspace product for foreign trade operations.
- It includes a Web workbench, task state machine, review flow, PDF translation pipeline, and stable external APIs.
- Prioritize workflows around inquiry intake, customer qualification, quotation support, follow-up drafting, and human handoff.

## Deployment Boundary
- **export-agent (this repo)** = the product itself. It runs as an independent service.
- **Ting 外贸助手** = an external business agent on the OpenClaw platform. Ting is one of several **consumers** of export-agent, connecting via MCP / REST APIs. Ting is **not** built or hosted in this repository.
- Other consumers (Web workbench users, future agents) use the same API surface.
- Current external API contract: `POST /api/tasks`, `GET /api/tasks/:id/skill-payload`, `POST /api/feedback`.
- Wire protocol naming (`ting_pdf_translation_v1`, `TingPdfTranslationPayload`) is a known design debt — these are Ting-branded names for what is actually a generic external consumption layer. Do not add more Ting-specific coupling; when a second consumer appears, rename to neutral names.

## Extension Architecture
- New business scenarios (BOM, reply drafting, etc.) go in **this repo** as new skills under `src/skills/{name}/` with their own pipeline in `src/lib/assistant/{name}-pipeline.ts`.
- Shared infrastructure (task state machine, review flow, feedback loop, glossary, UI) is reused across all scenarios.
- Do **not** split into separate repos until there is a clear need for independent deployment or team isolation.

## Expected Deliverables
- Reusable prompts, tool integrations, workflow code, evaluations, and operating docs.
- Changes should preserve auditability and avoid committing secrets.
