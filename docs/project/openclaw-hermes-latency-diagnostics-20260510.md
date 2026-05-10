# OpenClaw / Hermes Latency Diagnostics - 2026-05-10

## Context

User-reported symptoms: OpenClaw Ting, OpenClaw ADai, Hermes Ting, DingTalk, and Feishu replies felt slow, especially after idle periods and when multiple agents were involved.

This note records the first optimization increment and the verification method. It is not a final performance guarantee; fresh DingTalk/Feishu traffic must be measured after the runtime changes.

## Findings

- OpenClaw slow cases before optimization included first-token latencies from 35s to 101s, with some total replies over 80s.
- Hermes Ting ordinary DingTalk chat was usually 7s to 19s, but tool-heavy/current-news style prompts reached 122s with 8 API calls.
- Several OpenClaw events had inbound messages but no correlated completion metrics. These must be treated as `unknown`, not `pass`.
- Real chat-path comparison on 2026-05-10 showed the issue is runtime-specific, not business-tool specific:
  - OpenClaw ADai on DingTalk: `66.1s` first chunk / `66.7s` total on a pure `OK` reply.
  - OpenClaw Ting on DingTalk: `48.0s` first chunk / `48.8s` total on a pure `OK` reply.
  - Hermes Ting on DingTalk: `10.1s` total on a pure `OK` reply.
  - OpenClaw main on Feishu: `11.8s` total on a pure `OK` reply.
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
- Added `scripts/reapply-openclaw-dingtalk-hotpatch.mjs` and `npm run service:reapply-dingtalk-hotpatch` to keep the DingTalk runtime hotpatch reproducible after plugin reinstall or upgrade.
- Added `scripts/repair-openclaw-cron-session-isolation.mjs` and `npm run service:openclaw-cron-isolation` to keep scheduled OpenClaw agent jobs out of interactive direct-message sessions.
- Updated OpenClaw Ting, OpenClaw ADai, and Hermes Ting runtime memory/prompt files with chat-mode rules:
  - Ordinary chat should avoid MCP/file/search/deep memory unless needed.
  - Long operations should produce visible status instead of silence.
  - Follow-up messages like "continue" or "stuck?" should merge into the active flow instead of restarting the toolchain.
- Reindexed OpenClaw Ting and ADai memory stores.
- Reset the single direct DingTalk test session bindings for Ting, ADai, and Hermes Ting with backups preserved.
- Restarted OpenClaw gateway and Hermes Ting gateway.
- Added OpenClaw Feishu dispatch-complete parsing to the latency analyzer so Feishu chat no longer disappears from the report.
- Trimmed OpenClaw runtime memory files to remove stale setup history and auto-promoted noise:
  - `workspace/MEMORY.md`: `11624` bytes -> `1563`
  - `workspace-ting/MEMORY.md`: `9326` bytes -> `2591`
  - `workspace-adae/MEMORY.md`: `13364` bytes -> `2608`
- Reset the OpenClaw direct sessions for ADai, Ting, and main Feishu after the memory trim.

## Verification

Commands used:

```bash
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run verify:agent-latency
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run diagnose:agent-latency -- --since '2026-05-10 16:43'
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/Users/weitao/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

All passed after the analyzer was corrected to report unmatched events as `unknown`.

Additional verification and observations:

- `npm run diagnose:agent-latency -- --since '2026-05-10 20:22'`
  - Captured the OpenClaw DingTalk failures and the healthy Hermes/OpenClaw-Feishu paths.
- `npm run diagnose:agent-latency -- --since '2026-05-10 21:01'`
  - After memory trim + session reset:
    - OpenClaw ADai DingTalk improved to `15.0s` first chunk / `15.6s` total.
    - OpenClaw Ting DingTalk improved to `11.4s` first chunk / `11.9s` total.
- `node --import tsx --test src/lib/assistant/__tests__/excel-translation-review.test.ts`
  - Passed on rerun: `10/10`.
- `npm run verify:openclaw-cron-isolation`
  - Passed with a temp OpenClaw fixture.

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
- Even after trimming, OpenClaw direct sessions still load large prompt contexts (`~17k` to `20k` input tokens on fresh ADai/Ting direct sessions). The latency is improved, but the prompt footprint is still heavier than it should be.

## Dreaming Note

- `MEMORY.md` growth was not caused by one thing alone, but Dreaming is a major amplifier.
- Before mitigation, OpenClaw had `plugins.entries.memory-core.config.dreaming.enabled=true` with weekly frequency.
- Evidence in the workspace shows Dreaming writes and promotes material through:
  - `memory/.dreams/session-corpus/*.txt`
  - `memory/YYYY-MM-DD.md`
  - `<!-- openclaw:dreaming:light:start -->`
  - `<!-- openclaw:dreaming:rem:start -->`
  - `Promoted From Short-Term Memory`
- The low-risk mitigation used here was not to disable Dreaming globally, but to trim runtime `MEMORY.md` files and reset the affected direct sessions.
- Follow-up on 2026-05-10:
  - `plugins.entries.memory-core.config.dreaming.enabled` was switched to `false`
  - gateway was reloaded successfully afterward
  - repo helper added: `npm run service:openclaw-dreaming` for status / future toggles
- This change is intended to stop further `MEMORY.md` bloat from new Dreaming promotions. It does not clean historical `memory/.dreams` files by itself.

## Cron Session Isolation

- Root cause found after the first memory trim: `weekly-memory-archive` was bound to the live Ting DingTalk DM session:
  - before: `sessionTarget=session:agent:ting:dingtalk:direct:12443063651233525`
  - before: `sessionKey=agent:ting:dingtalk:direct:12443063651233525`
- The 2026-05-10 weekly archive run read memory files and other sessions inside that same direct session, expanding Ting's interactive context to about `83.8k` input tokens.
- Runtime repair performed:
  - `weekly-memory-archive` now uses `sessionTarget=isolated`
  - `sessionKey=agent:ting:cron:21366bd4-739f-4c2f-8029-ae6efc127a34`
  - the polluted Ting direct session was removed from `sessions.json`
  - backups were written under `/Users/weitao/.openclaw/backups`
- Verification:
  - `npm run service:openclaw-cron-isolation -- --check` now reports `needsCronPatch=false` and `needsDirectSessionReset=false`
  - `openclaw sessions --agent ting --json` no longer lists `agent:ting:dingtalk:direct:12443063651233525`; the next user message will create a clean session.

## DingTalk Hotpatch Persistence

- Script: `npm run service:reapply-dingtalk-hotpatch`
- Scope:
  - ensure `openclaw.plugin.json#channelConfigs.dingtalk`
  - ensure silent-reply suppression for `NO_REPLY`
  - ensure AI Card preview suppresses `NO` / `NO_` / `NO_RE` prefix fragments
  - ensure media-send fallback does not leak the raw local path back to the user
- Current state on 2026-05-10: the live extension already matches the expected patch points, so the script reports `needsPatch: false`.
