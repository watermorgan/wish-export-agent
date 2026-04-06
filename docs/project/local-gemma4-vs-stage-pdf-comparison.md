# 本地 gemma4 与阶段版（线上/业务确认）PDF 对比说明

生成日期：2026-04-04。本文与仓库内 **test02 产物**、业务确认路径及本轮代码变更对齐；若你本地有 `.tmp/gemma4-local-review/` 或 `.tmp/business-review-pdfs/`，可直接打开对应 PDF 复核。

## 1. 样本与产物路径

| 样本 ID | 阶段版 / 业务确认用 annotated PDF（参考） | 备注 |
| --- | --- | --- |
| M422123 | `.tmp/business-review-pdfs/M422123.annotated.pdf` | 阶段尾业务确认 pass |
| M441083 | `.tmp/business-review-pdfs/M441083.annotated.pdf` | pass |
| M445033 | `.tmp/business-review-pdfs/M445033.annotated.pdf` | pass |
| M415013 | `.tmp/business-review-pdfs/M415013.annotated.pdf` | pass |

本地 gemma4 主链产物示例：

- 历史路径：`.tmp/gemma4-local-review/M422123/…`
- 当前冒烟脚本物化：`npm run translate:smoke -- data/test02/<样本>.pdf` → `.tmp/exports/*.annotated-preview.html`

**2026-04-05 复跑（本机 `172.16.71.201` + `LLM_PREFER_OPENAI_COMPAT=1` + `QWEN_MODEL=gemma-4-31B-it` + `LOCAL_MULTIMODAL_RUNTIME=1` + `VISION_MULTIMODAL_ENABLED=1`，`--max-segments 40`）**：四份 sketch 标杆 PDF 均在 **有界时间内跑通**，B 段中文覆盖率 **100%**（见下表）。此前「长时等待」问题在本仓库当前主链 + 本地页图降采样组合下已缓解；**正式 annotated PDF（Python 渲染链）** 仍须单独导出对比，不能仅等同 HTML preview。

| 样本 | 耗时（约） | 段数 translated/total | 备注 |
| --- | --- | --- | --- |
| M422123 | ~10s | 10/10 | 此前已验证 |
| M441083 | ~17s | 20/20 | |
| M445033 | ~29s | 24/24 | |
| M415013 | ~21s | 18/18 | |

## 2. 本轮工程变更（与本地主链相关）

- **`VISION_MAX_RENDER_SIZE`**：默认 2048（`pdftoppm -scale-to` 长边）。
- **`LOCAL_MULTIMODAL_RUNTIME=1` 或 `VISION_USE_LOCAL_RENDER_SIZE=1`**：改用 **`VISION_LOCAL_MAX_RENDER_SIZE`**（默认 1024），**不**影响未设该开关的线上/默认运行。
- **`VISION_MULTIMODAL_ENABLED=1`**：A 辅助在需要时可附带页图（OpenAI-compatible 多模态）；未设置则仍为纯文本，与改造前一致。
- 实现位置：`src/lib/assistant/vision-render-config.ts`、`pdf-page-raster.ts`、`vision-extraction.ts`、`qwen-client.ts`（`callQwenChatWithContentParts`）。

在 `data/test02/M422123.pdf` 上实测：同一页 PNG 约 **289KB（2048 长边）** vs **82KB（1024 长边）**，可显著降低上传与推理负载。

## 3. 指标对比（能在仓库内客观取数的）

当前 **开源 `runPdfTranslationPipeline`（`translation-pipeline.ts`）** 为精简主链（pdftotext → 低置信 A 文本辅助 → B 批译 → HTML/xlsx 物化），**不包含** `translation-design.md` 中描述的全量 test02 诊断字段（如 `translatedSegmentCount` 在 diagnostics、`translation_snapshot_v1` 正式 PDF 导出等）。因此：

- **阶段版 / test02 完整跑次**：以 `data/test02/runs/20260329-human-ai-rerun-v1/` 等目录下 `pipeline-result.json` 为准（若存在）。
- **本地 gemma4**：以你机器上 `.tmp/gemma4-local-review/<id>/pipeline-result.json` 为准。

下面给出 **同一 test02 run**（`20260329-human-ai-rerun-v1`）中可从 `pipeline-result.json` 读取的摘要，便于与「本地 gemma4 若跑通」时对照（非同一环境，仅结构对齐）。

| 样本 | success | translatedSegmentCount（diagnostics） | translationCoveragePct | aModelExecuted | bModelExecuted |
| --- | --- | --- | --- | --- | --- |
| M422123 | 是 | 10 | 100% | 否* | 是 |

\* 该 run 中 `aModelTriggered=true` 但 `aModelExecuted=false`，表示 A 路径未形成有效解析块，与「仅文本 A」或环境有关。

**M441083 / M445033 / M415013** 在同 run 中 segments 全量翻译覆盖率多为 100%，但 harness 与参考 PDF 的 Recall/Precision 仍为 0% 或 fail，见 `docs/project/human-ai-eval-conclusion.md`：粒度与归一化差异，不能单看 coverage。

## 4. 业务块完整性、可读性

- **阶段版 PDF**（`.tmp/business-review-pdfs/*.annotated.pdf`）：已作为阶段尾业务确认基线（pass），以人工阅读为准。
- **本地 gemma4**：2026-04-05 起四份样本均已在本机 OpenAI 兼容链 + 可选多模态 A 上跑通 **HTML 双语预览**；与阶段版 **annotated PDF** 的版式/脚注仍可能不同，需人工打开 PDF 对比。
- **页面可读性**：正式 PDF 的 marker/脚注策略以 `translation-design.md` 与 `human-ai-eval-conclusion.md` 为准；本地模型若仍慢，应优先调 **页图尺寸与超时**，而非改渲染脚本。

## 5. 结论

| 问题 | 结论 |
| --- | --- |
| 本地 gemma4 是否可 **整体替代** 当前阶段版？ | **翻译主链（抽取 + B 段中文）**：四份标杆在 2026-04-05 环境下已 **有界跑通且 coverage 100%**。**阶段版正式 PDF（标注/marker 版式）**：仍应以 `.tmp/business-review-pdfs/*.annotated.pdf` 为业务基线；本地产物默认是 **HTML preview**，替代关系需在 **同 snapshot 渲染出的 PDF** 上再判。 |
| 是否可作为 **部分样本或实验路径**？ | **是**：`LLM_PREFER_OPENAI_COMPAT` + 本地降采样 + 可选 `VISION_MULTIMODAL_*` 适合联调与成本实验；线上默认勿开 `LLM_PREFER_OPENAI_COMPAT` 除非指向受控端点。 |
| 下一步 | 若需与阶段版 **逐页对齐**，请将同一 `PipelineResult` 走正式 `translation_snapshot_v1` → `render_feedback_pdf.py` 导出 PDF，再与业务确认稿对比；.harness 的 Recall 仍受粒度影响，见 `human-ai-eval-conclusion.md`。 |
