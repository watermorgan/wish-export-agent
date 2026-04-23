# AI 披露政策（AI Disclosure Policy）

> 本文档定义 `export-agent` 所有「AI 参与生成」的交付物**必须**携带的披露口径。
> 目的：避免业务员不经人工复核，把 AI 草稿当作正式翻译对外发送。

**版本**：v1（2026-04-21 上线）
**代码口径**：`src/lib/assistant/disclosure.ts` 为单一事实源；文档如与代码冲突，以代码为准并在此更新。

---

## 1. 适用范围

以下场景**必须**挂载 AI 披露字段 / 文案 / 水印：

| 场景 | 载体 | 模块 |
|------|------|------|
| `pdf_translation_skill_v1` 外部 payload | `skillPayload.disclosure` 对象 | `buildPdfTranslationSkillPayload`（`feedback-translation.ts`） |
| `ting_pdf_translation_v1` 外部 wrapper | `result.disclosure` 对象（按 `task.reviewStatus` 动态重建） | `buildTingPdfTranslationPayload`（`pdf-translation-skill.ts`） |
| 标注式翻译 PDF（sketch_comment / 通用） | 每页底部页脚 6.5pt 灰色披露 | `scripts/render_feedback_pdf.py::_apply_disclosure_watermark` |
| 表格式翻译 PDF（tp_bom_table_heavy） | 每页底部页脚 | `translation-pipeline.ts::stampDisclosureFooterOnPdf` |
| 双语 xlsx | Summary sheet A1/A2 中英双语披露 | `translation-pipeline.ts::buildSummarySheetWithDisclosure` |
| 工作台 UI | 翻译结果入口上方的 DisclosureBanner | `src/components/workspace.tsx` |

不适用：

- 纯诊断脚本（`scripts/eval-*.ts` / `scripts/smoke-*.ts`）的 stdout 日志。
- 内部 `.omc` / `.tmp` 调试产物（非对外交付）。
- Markdown 文档本身（人工撰写，无 AI 内容需要披露）。

## 2. 披露字段结构

见 `PdfTranslationSkillDisclosure`（`src/lib/assistant/disclosure.ts`）：

```jsonc
{
  "contentOrigin": "ai_generated",
  "humanReviewRequired": true,          // 任务未 approved 时为 true
  "notForExternalSendWithoutReview": true,
  "disclosureZh": "...",                 // 中文披露文案
  "disclosureEn": "...",                 // 英文披露文案
  "watermarkVersion": "v1",              // 渲染水印版本；EXPORT_AGENT_AI_DISCLOSURE=off 时为 null
  "generatedAt": "2026-04-21T00:00:00.000Z"
}
```

触发条件：

- 任务被 `approved` 的 consumer（Ting 人审通过后拉的终态）收到的 `disclosure` 文案切换为 **approved 变体**（`AI_DISCLOSURE_TEXT_APPROVED_ZH/EN`）；`humanReviewRequired = false`，`notForExternalSendWithoutReview = false`，但仍保留披露。
- `pending` / `revision_requested` / 其他未 approved 状态：使用默认 pending 文案，要求人工复核。

## 3. 中英文模板

| 场景 | 中文 | 英文 |
|------|------|------|
| 未审核 | 本内容由 AI 翻译生成，尚未经过人工复核，不得直接作为对外承诺或正式翻译件使用。 | This content is AI-generated and has not been human-reviewed. Do not send externally or treat as a binding translation without human verification. |
| 已审核 | 本内容由 AI 翻译生成，已通过人工审核；对外使用前请再次确认商务承诺一致。 | This content is AI-generated and has been human-reviewed; reconfirm any commercial commitments before external use. |

PDF/xlsx/UI 的渲染文案固定使用上述四句；修改须同步到 `disclosure.ts` 常量与本文件。

## 4. 水印文字格式（渲染层）

由 `buildDisclosureWatermarkText({ coveragePct, generatedAt })` 构造：

```
AI Translation Draft · Human Review Required · Coverage 87% · Generated 2026-04-21T00:00:00Z
```

规则：

- 前两段恒存。
- `coveragePct` 缺失或非数字时丢掉 `Coverage …%`。
- `generatedAt` 缺失时丢掉 `Generated …`。
- 分隔符固定 ` · ` (U+00B7)；与 payload 的 `disclosureZh/En` 不共用，水印只做**英文短句**以适配 PDF 页脚宽度。

## 5. 开关与版本

- 环境变量：`EXPORT_AGENT_AI_DISCLOSURE=off` 可关闭**渲染侧**水印（PDF / xlsx / Python）。payload 字段始终存在，与 UI 的 DisclosureBanner 一起不受该开关影响。
- 版本：当前 `watermarkVersion = 'v1'`；后续对 PDF 页脚视觉或位置做正式改动，需把版本递进并在本文件记录 changelog。
- Changelog：
  - **v1（2026-04-21）**：PDF 页脚 6.5pt 灰色单行；xlsx Summary A1/A2 双语；UI Banner；payload 字段化。

## 6. 验证基线

一次合格的披露回归必须通过以下脚本：

```bash
npm run verify:disclosure-watermark   # 单元级：PDFKit 水印 + xlsx Summary + 开关路径
npm run verify:ting-skill-payload     # payload 层：metadata / wrapper / HTTP 路由三层都带 disclosure
```

如果任何断言失败，**不得**将产物对外发送；即使手工关闭水印，也必须保留 payload 字段。

## 7. 豁免条件

只有同时满足以下所有条件时，可以临时在某产物关闭披露：

1. 该产物仅用于离线评测或内部调试（不会被 Ting / 客户看到）。
2. 关闭操作使用 `EXPORT_AGENT_AI_DISCLOSURE=off`，而不是删代码。
3. 操作人在 `progress.txt` 或 commit message 中记录关闭原因与覆盖范围。

> 不允许以「UI 布局更美观」「客户要求去水印」等理由在 production 关闭披露，除非经主管书面同意并记录在本文件的 changelog。
