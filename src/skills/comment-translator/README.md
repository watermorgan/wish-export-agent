# comment-translator

**用途**：对批注、意见文本、聊天记录做双语翻译；PDF 输入时产出可直接预览/下载的正式翻译稿与人工复核建议。

## 输入假设

- `files[]`：原始批注文本（txt / md）、chat 导出、或 PDF；PDF 通常是 `sketch/comment` 或 `tp/bom/table-heavy`。
- `taskType ∈ { 'feedback', 'reply' }`。
- `executionControl?`：可选的 A 模型（视觉）/ B 模型（翻译）配置，影响 fallback 行为。
- 非 PDF 输入：仅返回原文/译文对照 + 术语清单。
- PDF 输入：走完整翻译主链，同时生成 `pdf_translation_skill_v1` + 一份正式 PDF 产物。

## 输出契约

- `原文/译文对照`：按 segment 排布，保留 regionId / pageNumber / sourceType。
- `术语清单`：命中或候选术语，含 glossary 来源。
- `歧义提示`：翻译器认定歧义的段落及建议反问。
- `正式 PDF / 预览入口`（仅 PDF 输入）：annotated PDF、bilingual xlsx、table-style PDF、annotated HTML preview 四种。
- `人工复核建议`：`HumanReviewGuide`，含高风险页与复核顺序。
- `pdf_translation_skill_v1`：正式结构化 payload；携带 AI 披露（`disclosure`）与 revision 信息。

## 已知限制

- B 模型 429 限流时会自动回退到 `openrouter/free`；大批次翻译在回退时会明显变慢。
- 对 TP/BOM 类 PDF 不会生成 annotated PDF，仅双语 xlsx + table-style PDF；这是有意设计（annotated PDF 会把表格元素拆碎）。
- A 模型当前仅做视觉辅助，**不会**翻译整页；Rework 明确不重跑 A 模型（详见 `docs/project/ting-system-prompt-20260420.md`）。
- 不支持把多份 PDF 合并翻译；每个任务输入 1 份 PDF。

## 失败模式

- 整轮 B 翻译 JSON 解析失败：`pipelineFallbackHints` 会带 `bModelLastErrorKind`，结果结构返回 `待人工补译` 占位；不会伪装成完成。
- vision 未配置且文本层极稀疏：`diagnostics` 给出 `layoutConfidence<阈值`，覆盖率会显著低于业务预览门槛。
- 披露开关 `EXPORT_AGENT_AI_DISCLOSURE=off` 下，水印不渲染但 payload `disclosure` 字段仍保留（见披露政策）。

## 升级路径

1. 把 `pdf_translation_skill_v1` wrapper 的 consumer 协议从 Ting 专属重命名成通用 `external_pdf_*`（见 plan.md Backlog）。
2. 让 A 模型在 rework 场景下也能按请求重跑（当前只翻译，不识别）；需要先确认成本/一致性。
3. 对 `businessPreviewThresholdPct` 按 documentMainType 做独立阈值。

## 相关代码

- manifest：`src/skills/comment-translator/manifest.json`
- prompt：`src/skills/comment-translator/prompt.md`
- pipeline：`src/lib/assistant/translation-pipeline.ts`、`src/lib/assistant/feedback-translation.ts`
- 对外 wrapper：`src/lib/assistant/pdf-translation-skill.ts`
- 披露：`src/lib/assistant/disclosure.ts` + `docs/product/07-ai-disclosure-policy.md`
