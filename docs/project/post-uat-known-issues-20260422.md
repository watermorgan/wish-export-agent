# Ting × export-agent × ADai 闭环 UAT 已知问题归档（2026-04-22）

**UAT 结论**：两轮 UAT 共 9/9 核心用例通过，7 项核心能力（任务创建 / override / rework / revision / feedback / 交付 PDF / 新结果回拉）全部满足 Go-Live 要求。

本文档归档 Ting 在两轮 UAT 中提出的 **4 个已知问题**，定位为「体验优化，不阻塞上线」；是否纳入下一迭代由主管决策。

---

## 问题一览

| 编号 | 标题 | 严重度 | 状态 | Owner | 建议处置 |
|------|------|--------|------|-------|----------|
| UAT-001 | `deliveryPdfUrl` 不回灌到历史 revision | 低 | 已归档 | export-agent 工程 | Backlog，设计侧先确认 revision 产物是否需要分别落盘 |
| UAT-002 | 业务在自然语言里混用"重做"和"重新识别"，Ting 路由不确定 | 低 | 已由 Ting 消歧协议 v1 兜底 | Ting 工程 | 见 `ting-disambiguation-protocol-20260421.md`，业务无需记忆任何系统术语 |
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

## UAT-002 · 业务自然语言里的"重做 / 重新识别"路由不确定

**现象**：业务在 Ting 里说"这页重做"或"重新识别这一页"时，系统既可能走 rework（只重翻）也可能走 override+forceVisionPages（重识别+重翻），结果与预期不符。

**根因**：业务从来不会关心"识别"和"翻译"在实现上是两个阶段；但 Ting 之前的 system prompt 没有在路由层面做语义消歧，只在后面把这件事"规则化"后甩给了 LLM 自己悟。

**早期错误处置（已废弃）**：

- 最初的想法是让业务"请记得说 OCR / 视觉"才能触发 forceVisionPages —— 这是在让业务替 Ting 承担消歧职责，错误的设计。

**正确处置（已落地）**：

- 引入 **Ting 侧语义消歧协议 v1**（`docs/project/ting-disambiguation-protocol-20260421.md`）：
  1. Ting 识别一份歧义触发词清单（"重做 / 重新识别 / 再跑一次 / 这页有问题"等）。
  2. 命中后强制走一次性 A/B 澄清模板，**只用业务语言**（"译文的问题" vs "原文的问题"），**不暴露任何系统术语**（OCR / vision / rework / override / forceVisionPages）。
  3. A → rework；B 或"都有 / 不确定" → override+forceVisionPages。
- 同步更新 `ting-system-prompt-20260420.md` 与 `ting-lead-runtime-prompt-20260420.md`：加入触发词清单、澄清模板、禁止系统术语的硬约束。
- `override-rework-feedback-routing-spec-20260420.md` §6.1 明确声明："Ting 侧语义消歧是 Ting 的职责"，export-agent 只按收到的字段执行，不做二次消歧。

**对业务的意味**：业务按自己的自然语言描述问题即可。Ting 会替他们区分"译文问题"与"原文问题"，并在不把系统术语倾倒给业务的前提下完成路由。业务不需要学习任何关键词。

**对 Ting 工程的意味**：Ting 的 prompt / agent 代码必须实现 §2 触发词识别 + §3 澄清模板；如果未来业务测试仍出现"路由误判"，先查 Ting 是否按协议执行，而不是让 export-agent 加兜底。

**验证建议（业务测试阶段）**：

- 让业务故意说"重新识别这一页 / 重做这页"，观察 Ting 是否弹出 A/B 澄清问题。
- 故意回答"不确定"，观察 Ting 是否按默认 B 分支走（触发 forceVisionPages），结果中原文内容是否被刷新。
- 全程不应在 Ting 对用户的任何一句话里出现 OCR / vision / rework / override / forceVisionPages 等词。

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
