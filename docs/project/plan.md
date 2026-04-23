# 项目路线图（Export-Agent × Ting × ADai）

> 本文档定位：**面向工程团队的路线图**，四栏视图（已完成 / 进行中 / Backlog / 性能里程碑），
> 取代旧版的「早期 Phase 1 报告」。历史阶段性结论已归档到 `docs/project/` 下的各专题文档。

**最后更新**：2026-04-21，UAT 全量通过 + AI 披露 v1 上线。
**产品语境**：`export-agent` 是外贸工作台产品本身；Ting 外贸助手通过 MCP/REST 消费它的 PDF 翻译闭环。

---

## 一、已完成（Completed · 可回归）

| 条目 | 形态 | 关键入口 |
|------|------|----------|
| PDF 翻译主链 | A 模型（视觉识别）+ B 模型（结构化翻译）分离 | `src/lib/assistant/translation-pipeline.ts` |
| 多路产物 | annotated PDF / bilingual xlsx / table-style PDF | `materializeAnnotatedHtmlPreview` / `materializeBilingualXlsx` / `materializeTableStylePdf` |
| 输出策略分流 | `sketch/comment`, `tp/bom/table-heavy`, `reference`, `structured_xlsx` | pipeline 自动判型，`workspace.tsx` 按 `primary` 字段展示 |
| 任务化闭环 | 创建 → 执行 → 审核 → revision 迭代 → 交付 | `task-store.ts` + `task-iteration.ts` + `/api/tasks/*` |
| Override / Rework / Feedback 三路由 | 契约分离：override 页级、rework 页级重翻、feedback 系统学习 | `docs/project/override-rework-feedback-routing-spec-20260420.md` |
| Revision lineage | 每次 override/rework 生成 revision，失败路径保留 `failedRevisionId` + `revisionLookupUrl` | `src/lib/assistant/__tests__/task-revision-lineage.test.ts` |
| 对外 skill payload | `pdf_translation_skill_v1` 正式入外部协议；`ting_pdf_translation_v1` 做 wrapper | `src/lib/assistant/pdf-translation-skill.ts` |
| HTTP / Ting CLI / Ting MCP 三通道 | 同一份 `ting_pdf_translation_v1`；失败路径均保留 revision 诊断 | `scripts/verify-ting-service-cli.ts`, `scripts/verify-ting-mcp-server.ts` |
| skippedTranslationPages 外显 | skip-only override 也刷新 payload 与 disclosure.generatedAt | `src/app/api/tasks/[taskId]/overrides/route.ts` |
| HumanReviewGuide | 自动推高风险页 / 列出术语 / 告知复核顺序 | `src/lib/assistant/feedback-translation.ts` |
| AI 披露 payload 字段（v1） | `skillPayload.disclosure` 统一中英文文案 + 审核状态感知 | commit `4efd45d` |
| AI 披露水印（v1） | 每页 PDF 页脚 + xlsx Summary 双语 + UI Banner；`EXPORT_AGENT_AI_DISCLOSURE=off` 可关 | commit `5c4bf37` |
| 自动化回归 | `verify:task-revision-flow` / `verify:ting-service-cli` / `verify:ting-mcp-server` / `verify:ting-skill-payload` / `verify:disclosure-watermark` | `package.json` scripts |

## 二、进行中（In Progress · 本迭代周期内完成）

| 条目 | 负责方 | 预期交付 |
|------|--------|----------|
| src/skills/* 子技能 README 清单 | export-agent 工程 | 每个 skill 独立 README：输入假设 / 输出契约 / 已知限制 / 升级路径 |
| 内部路线图 + README 刷新 | export-agent 工程 | 本文档 + `README.md` + AI 披露政策 + UAT 已知问题归档 |
| glossary 术语溯源 | export-agent 工程 | `origin: 'manual' \| 'ai_feedback_mining' \| 'imported'`，`promote-feedback-terms.ts` 回填 |

## 三、Backlog（未排期，按价值排序）

1. **`ting_pdf_translation_v1` 重命名** — 把历史前缀 `Ting` 改为通用 `ExternalPdfTranslation` 或 `external_pdf_*`；需要跨 consumer 协调。详见 `pdf-translation-skill.ts` 的 DESIGN DEBT 注释。
2. **Revision 级别的交付链接** — 当前 `deliveryPdfUrl` 总是指向 current task；历史 revision 返回 `null`。真要做 revision 级下载，需要补 `/api/tasks/[taskId]/revisions/[revisionId]/translation-pdf` 与对应的产物落盘策略。
3. **AI 披露水印 v2** — 当前水印是「每页底部 6.5pt」。v2 计划把披露文本做成标准化斜纹水印 + 可切换的业务品牌。
4. **Glossary 术语评审流** — 当前 AI 挖掘术语需要人工二次确认；目标是做一个 review UI，允许主管批量 approve/reject，事件回流到 feedback loop。
5. **业务预览阈值可配** — 现在 `businessPreviewThresholdPct` 是硬编码；做成每种 documentMainType 的独立阈值。
6. **对 Ting 主流程的自愈** — 本仓库已经暴露 `failedRevisionId / revisionLookupUrl`，但 Ting 侧尚未消费；后续要打通 Ting 的 retry 策略，避免每次失败都回用户界面。

## 四、性能里程碑（Performance Milestones · 跨 PR 的可量化指标）

| 指标 | 当前水位 | 目标 | 采集口径 |
|------|----------|------|----------|
| B 模型整轮翻译成功率（rate_limited 之外） | 约 75% | ≥ 95% | `scripts/eval-fullchain.ts`，按整轮 `bModelBatchJsonOk` 统计 |
| 业务预览覆盖率（sketch_comment） | `Cici` 类样本 ≈ 60%（受 429 影响） | ≥ 80% | `diagnostics.businessTranslationCoveragePct` |
| 表格型样本覆盖率（tp_bom） | `Macade` 类样本约 40%（受 429 影响） | ≥ 80% | 同上 |
| 任务端到端 P50 延迟（单份 PDF） | 约 90–120s（含 vision 回退） | ≤ 60s | `scripts/smoke-pdf-pipeline.ts` |
| Ting 回调失败率 | UAT 轮 0% | 保持 0%，失败时必须带 `failedRevisionId` | `verify:ting-service-cli` / `verify:ting-mcp-server` |

---

## 相关文档

- 披露政策：[`docs/product/07-ai-disclosure-policy.md`](../product/07-ai-disclosure-policy.md)
- UAT 已知问题归档：[`docs/project/post-uat-known-issues-20260422.md`](./post-uat-known-issues-20260422.md)
- Override/Rework/Feedback 路由契约：[`docs/project/override-rework-feedback-routing-spec-20260420.md`](./override-rework-feedback-routing-spec-20260420.md)
- Ting 系统 prompt：[`docs/project/ting-system-prompt-20260420.md`](./ting-system-prompt-20260420.md)
- Ting 侧语义消歧协议 v1：[`docs/project/ting-disambiguation-protocol-20260421.md`](./ting-disambiguation-protocol-20260421.md)
- ADai 反馈运营 SOP：[`docs/project/adai-feedback-ops-sop-20260420.md`](./adai-feedback-ops-sop-20260420.md)
- 验收基线：[`memory/acceptance-criteria.md`](../../memory/acceptance-criteria.md)

## 约束（Cursor / Codex 合作守则，继承自旧版）

1. 不允许把主链改成「整份 PDF 直接多模态翻译」；A 模型仅做识别辅助。
2. 不允许为任一单点样本写特判（路径、文件名、SKU 等）。
3. 未完成的能力不得写成已完成；验证必须跑实际脚本并贴日志。
4. AI 披露不允许移除或降级（见 `docs/product/07-ai-disclosure-policy.md`）。
