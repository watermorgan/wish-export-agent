# Ting × export-agent × ADai 闭环 UAT 已知问题归档（2026-04-22）

**UAT 结论**：两轮 UAT 共 9/9 核心用例通过，7 项核心能力（任务创建 / override / rework / revision / feedback / 交付 PDF / 新结果回拉）全部满足 Go-Live 要求。

本文档归档 Ting 在两轮 UAT 中提出的 **4 个已知问题**，定位为「体验优化，不阻塞上线」；是否纳入下一迭代由主管决策。

---

## 问题一览

| 编号 | 标题 | 严重度 | 状态 | Owner | 建议处置 |
|------|------|--------|------|-------|----------|
| UAT-001 | `deliveryPdfUrl` 不回灌到历史 revision | 低 | 已归档 | export-agent 工程 | Backlog，设计侧先确认 revision 产物是否需要分别落盘 |
| UAT-002 | Rework 文案让人误以为 OCR 也会重跑 | 低 | 已归档 | export-agent 工程 + Ting 文档 | 修 `ting-system-prompt-20260420.md` 文案，见 PR-4a |
| UAT-003 | skip-only override 在某些场景下不刷新诊断时间戳 | 低 | 已在 commit `4efd45d` 修复 | export-agent 工程 | Closed。保留在此以备追溯 |
| UAT-004 | Ting CLI 对 `revisionLookupUrl` 的展示格式不够友好 | 低 | 已归档 | Ting 工程 | 建议 Ting 侧优化日志 formatter |

> 注：严重度采用「不阻塞上线」分类；若后续升级为阻塞项，应创建独立 RFC，而不是继续追加在本归档文件。

---

## UAT-001 · deliveryPdfUrl 不回灌到历史 revision

**现象**：查询历史 revision（非 current task 的版本）时，返回的 `deliveryPdfUrl` 为 `null`；只能在 current task 上看到下载链接。

**根因**：当前实现仅为 current task 落盘 PDF 产物；历史 revision 的产物并未写入固定路径，也没有保留下载接口。

**影响**：Ting 在展示 revision 历史时，用户看不到历史版本的下载入口；实际业务只需要「最新版」下载时不影响。

**证据**：`src/lib/assistant/task-iteration.ts::buildRevisionResponse`，以及对应单测 `src/lib/assistant/__tests__/task-revision-lineage.test.ts`。

**处置**：

- 短期：Ting 在展示时明确「历史版本仅保留诊断信息，不提供下载」。
- 中期：若业务真要回溯历史版本 PDF，需要为每个 revision 保留独立产物，并补 `/api/tasks/[taskId]/revisions/[revisionId]/translation-pdf` 接口。见 `docs/project/plan.md` Backlog 条目 2。

## UAT-002 · Rework 文案让人误以为 OCR 也会重跑

**现象**：Ting 调 rework 时，用户期待「重做识别」，但实际上 rework 只会在不重跑 vision 的前提下重新翻译受影响页。

**根因**：`docs/project/ting-system-prompt-20260420.md` 对 rework 的描述为「重跑当前 task 主链」，字面上容易被理解成「重新 OCR + 翻译」。`src/lib/assistant/translation-pipeline.ts` 中的 `extractWithVisionFallback` 对 `executionControl.rework` 明确不再触发 vision。

**影响**：功能本身正确（rework 只重翻），但 Ting 的 system prompt 会让 LLM 给用户错误期待。

**处置**：

- 在 PR-4a 更新 `ting-system-prompt-20260420.md`：把「重跑当前 task 主链」改成「对受影响页进行重新翻译（不重跑视觉识别）；若要重新识别请使用 override forceVision」。
- `review-object-decision-20260420.md` 已经用相同口径，不需要再改。

## UAT-003 · skip-only override 不刷新诊断时间戳（已修复）

**现象**：UAT Round 1 时发现，`skip-only` 的 override 不触发 pipeline 重跑，导致 `skillPayload.disclosure.generatedAt`、`diagnostics` 里与时间相关的字段停留在上一次任务的时间戳。

**根因**：`src/app/api/tasks/[taskId]/overrides/route.ts` 在 `forceVisionPages` 为空的分支里没有重建 `skillPayload`，导致 wrapper 层按旧时间戳回传。

**处置（已完成）**：commit `4efd45d` 在 skip-only 分支里显式 `updatePdfTranslationSkillPayload` 刷新 `skippedTranslationPages` 与 `disclosure.generatedAt`，revision 推进时保证外部口径一致。

**验证**：`verify:ting-skill-payload` 现在包含 skip-only override 前后 `disclosure.generatedAt` 差异断言。

## UAT-004 · Ting CLI 对 revisionLookupUrl 的展示格式不够友好

**现象**：Ting CLI 失败时会打印 `failedRevisionId=...` 和 `revisionLookupUrl=https://...`，两段文字挤在一行，不便排障。

**根因**：Ting CLI formatter 把两个字段拼在同一个 info line；`export-agent` 侧已经把字段拆分为两个独立字段返回，责任在 Ting。

**处置**：建议 Ting 在 CLI 输出层改为两行展示，或提供 `--json` 开关让诊断字段结构化导出。`export-agent` 这边不需要改代码，`scripts/verify-ting-service-cli.ts` 的断言以字段存在为准，不校验格式。

---

## 追溯与更新

- 后续发现的新 UAT 问题请在本文件新增条目，不要覆盖既有条目。
- 若某个「已归档」的问题升级为阻塞项，请同步在 `docs/project/plan.md` 的进行中栏添加，并把对应条目状态改为「重开 → 跟进」。
