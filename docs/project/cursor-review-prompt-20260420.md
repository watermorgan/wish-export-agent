# Cursor 评审 Prompt

```text
请审查当前 export-agent 工作区里与 Ting × export-agent × 阿呆 翻译自迭代闭环相关的未提交或最新提交改动。

评审目标：
1. 确认 review object 仍然是 task，而不是 revision
2. 确认 override / rework / feedback 的契约与实际执行一致
3. 确认 rework 当前只承诺页级语义，没有伪装成 segment 级局部重算
4. 确认 skippedTranslationPages 没有被对外 payload 隐藏
5. 确认 failedRevisionId / revisionLookupUrl 能通过 HTTP、Ting CLI、Ting MCP 保留下来
6. 优先找行为回归、误导性契约、验证缺口，不要做风格评论

请重点查看：
- src/lib/assistant/types.ts
- src/lib/assistant/task-iteration.ts
- src/lib/assistant/task-input.ts
- src/lib/assistant/task-store.ts
- src/lib/assistant/translation-pipeline.ts
- src/lib/assistant/feedback-translation.ts
- src/app/api/tasks/[taskId]/overrides/route.ts
- src/app/api/tasks/[taskId]/rework/route.ts
- src/app/api/tasks/[taskId]/revisions/[revisionId]/route.ts
- scripts/ting-pdf-service.ts
- scripts/ting-pdf-mcp-server.mjs
- scripts/verify-task-revision-flow.ts
- memory/acceptance-criteria.md
- memory/execution-boundaries.md
- docs/project/ting-system-prompt-20260420.md
- docs/project/adai-feedback-ops-sop-20260420.md

已知当前验证命令：
- node --import tsx --test src/lib/assistant/__tests__/task-mutation-validation.test.ts src/lib/assistant/__tests__/task-revision-lineage.test.ts
- npm run lint
- npm run build
- ENABLE_TASK_OVERRIDES=1 ENABLE_TASK_REWORK=1 ENABLE_TASK_REVISION_READ_API=1 ASSISTANT_FORCE_GOLDEN=1 npm run verify:task-revision-flow
- npm run verify:ting-mcp-server
- ENABLE_TASK_REVISION_READ_API=1 npm run verify:ting-skill-payload

请按严重级别输出 findings，格式：
- P0 / P1 / P2
- 文件路径
- 具体风险
- 为什么这是契约或行为问题

如果没有阻塞问题，请明确写：
APPROVED

如果有问题，请明确写：
REJECTED
```
