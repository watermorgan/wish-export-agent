# Resume Brief

Current project: `export-agent`

Use this as the shortest current-work entry point. Deeper authority remains in
`AGENTS.md`, `memory/`, and the existing `docs/product/` / `docs/project/`
files.

## Current Boundary

- `export-agent` is the standalone product/API/MCP repository.
- Ting/OpenClaw/Hermes runtime issues are external consumers/runtime concerns
  unless they reveal an export-agent API contract defect.
- Stable external API surface remains:
  - `POST /api/tasks`
  - `GET /api/tasks/:id/skill-payload`
  - `POST /api/feedback`

## Current Code State

- Active branch: `feat/smart-inline-rendering`.
- Current HEAD: `164684a Surface pipeline unavailable errors in fallback replies`.
- Remote `origin/master` points to the same `164684a` commit.
- Remote `origin/main` points to `b8e4d78`.
- Local model profile switcher exists:
  - `npm run model:use:minimax`
  - `npm run model:use:qwen-local`
- Model profile files are local-only and ignored:
  - `.env.local`
  - `.env.profile.*.local`

## Current Runtime State

- Last checked service state: not running.
- `npm run service:status` reported stale pid `65328`, port `3000` not listening.
- `npm run service:health` failed with `ECONNREFUSED 127.0.0.1:3000`.
- To recover product service, use `npm run service:start` or `npm run service:restart`,
  then confirm with `npm run service:health`.

## Recent Product Fixes

- Task-store fallback-only health semantics clarified; local-file fallback is
  expected demo mode unless `TASK_STORE_REQUIRE_DATABASE=1`.
- Excel artifacts are task-bound through persisted task payloads.
- PDF translation now fails fast after repeated `http` / `timeout` model
  transport failures and surfaces a user-facing network/VPN recovery message.
- Feedback fallback replies now preserve pipeline-level unavailable errors.

## Control Plane Notes

- `ai-control.yml` configures this repo for AI Control Platform sidecar use.
- `docs/` is authority.
- `.ai-control/` is generated/non-authority state; do not promote anything from
  it without owner intake.
- Current derived health can be checked with:

```bash
/Users/weitao/workspace/.shared-skills/laip-control-plane/bin/ai-control validate --project export-agent --root /Users/weitao/Documents/buildworld/aigc/export-agent --json
```
