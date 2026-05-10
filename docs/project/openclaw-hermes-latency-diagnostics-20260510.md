# OpenClaw / Hermes Latency Diagnostics - 2026-05-10

## Context

User-reported symptoms: OpenClaw Ting, OpenClaw ADai, Hermes Ting, DingTalk, and Feishu replies felt slow, especially after idle periods and when multiple agents were involved.

This note records the first optimization increment and the verification method. It is not a final performance guarantee; fresh DingTalk/Feishu traffic must be measured after the runtime changes.

## Findings

- OpenClaw slow cases before optimization included first-token latencies from 35s to 101s, with some total replies over 80s.
- Hermes Ting ordinary DingTalk chat was usually 7s to 19s, but tool-heavy/current-news style prompts reached 122s with 8 API calls.
- Several OpenClaw events had inbound messages but no correlated completion metrics. These must be treated as `unknown`, not `pass`.
- Runtime warnings seen during the investigation:
  - OpenClaw DingTalk duplicate plugin/config warning.
  - OpenClaw DingTalk registration confirmation warnings after restart.
  - OpenClaw memory vector recall degraded because `sqlite-vec` is unavailable.
  - Hermes Ting `Channel directory built: 0 target(s)` after restart.
  - Hermes Ting interrupt recursion warning on overlapping user input.

## Changes Made

- Added `scripts/analyze-agent-latency.mjs` to parse OpenClaw and Hermes logs into a compact latency report.
- Added `npm run diagnose:agent-latency` as the operator-facing report command.
- Added `scripts/verify-agent-latency-analyzer.mjs` and `npm run verify:agent-latency` to lock the parser behavior.
- Updated OpenClaw Ting, OpenClaw ADai, and Hermes Ting runtime memory/prompt files with chat-mode rules:
  - Ordinary chat should avoid MCP/file/search/deep memory unless needed.
  - Long operations should produce visible status instead of silence.
  - Follow-up messages like "continue" or "stuck?" should merge into the active flow instead of restarting the toolchain.
- Reindexed OpenClaw Ting and ADai memory stores.
- Reset the single direct DingTalk test session bindings for Ting, ADai, and Hermes Ting with backups preserved.
- Restarted OpenClaw gateway and Hermes Ting gateway.

## Verification

Commands used:

```bash
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run verify:agent-latency
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run diagnose:agent-latency -- --since '2026-05-10 16:43'
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

All passed after the analyzer was corrected to report unmatched events as `unknown`.

## Next Test Protocol

After sending new DingTalk/Feishu messages, run:

```bash
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run diagnose:agent-latency -- --since 'YYYY-MM-DD HH:MM'
```

Use at least these prompts per channel:

- `你好`
- `聊聊天`
- `最近客户反馈说你的反应有点慢，怎么优化`
- `今天外贸有哪些热点`
- After a quiet period, repeat `你好`

Interpretation:

- Ordinary chat target: first response under 10s where stream metrics exist, total under 30s.
- Tool-heavy prompts: warn above 120s total, fail above 180s total.
- `unknown` rows are not success evidence; inspect logs or rerun with isolated traffic.

## Remaining Risks

- OpenClaw completion matching is still partly heuristic because some log lines do not include a stable session id.
- DingTalk multi-account/plugin warnings remain. Do not change multi-account business config without a dedicated plan.
- Hermes Ting currently runs, but `Channel directory built: 0 target(s)` suggests the message target directory needs follow-up before treating Hermes DingTalk as healthy.
- Memory recall is FTS-only until `sqlite-vec` support is restored.
