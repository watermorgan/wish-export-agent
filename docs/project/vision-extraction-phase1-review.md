# Vision Extraction Phase 1 Review

## Scope

本评审只覆盖 Cursor 这次新增的第一阶段抽取骨架：

- `/src/lib/assistant/file-extractor.ts`
- `/src/lib/assistant/feedback-source.ts`
- `/src/lib/assistant/vision-extraction.ts`
- `/src/lib/assistant/types.ts`
- `/scripts/test-extraction.ts`

不把当前仓库其他未完成模块混入结论。

## Overall Judgment

当前实现已从“纯骨架”推进到“主链可执行 + second pass占位”的阶段，但仍不是完整生产态。

它已经做到：

- 维持文本主链为核心
- 增加页面类型识别的第一版 heuristic
- 增加 region/block 概念的第一版数据结构
- 给 segment 增加来源和置信度字段
- 预留视觉辅助抽取接口
- 在抽取链中加入 early gate 与第二轮融合占位（流程骨架）
- 在 `service.ts` 业务主链里接入 `translation-pipeline.ts`（不再只在评测脚本中跑）

它还没有做到：

- 真实 OCR / 多模态接入
- 真实视觉 bbox 级区域定位
- 端到端翻译/PDF 利用 `extractionMeta`
- 低置信度阈值生产化（目前是初版 heuristic 常量）
- second pass 真实纠偏合并（当前仍是 placeholder）

## Findings

### High

1. 主仓库当前无法 `next build`

- 证据：
  - `src/components/workspace.tsx` 依赖 `@/lib/assistant/catalog`
  - `src/lib/assistant/task-store.ts` 依赖 `@/lib/assistant/catalog` 和 `@/lib/assistant/db`
  - 这些文件当前不在工作区
- 影响：
  - 不能把“抽取 Phase 1 lint 通过”误写成“当前项目构建通过”
- 结论：
  - 这是当前工作区完整性问题，不是 Phase 1 骨架本身的问题，但必须在评估里明确分开。

### Medium

1. 已实现多区域切分，但在 table-heavy 文档上存在“整页 table 过判”风险

- `buildRegionsForPage()` 已可输出多 region（按列与空行间隔）。
- 在 ATA001/ATA019 中，table 命中明显提升，但部分页被强行归为 table，导致 region 数下降。

2. `table` 页识别从“偏弱”转为“偏激进”

- 在 `ATA001`、`ATA019` 这类文档中，`table` 页已大量出现（较基线明显改善）。
- 但也带来 `reference/mixed` 被误吸入 `table` 的风险，需要下一轮阈值校准。

3. `LABEL_PATTERNS` 存在样衣反馈语料偏置

- 它没有显式按文件名特判。
- 但词表仍主要对 sketch/comment 领域友好，对更广泛版式的泛化能力需继续验证。

### Low

1. `vision-extraction.ts` 仍是独立骨架，未接主链

- 这本身是合理的 Phase 1 选择。
- 但文档必须持续明确：当前主链仍是 `pdftotext -layout -> feedback-source`。

2. `extractionMeta` 已进入评测可见层，但还没进翻译/PDF 链

- 已通过 `extract:eval` 输出 `sourceType` 与低置信度统计。
- 还没有透传到翻译链和 PDF 标注链。

3. 全链路评估脚本已可运行，但当前环境下 A/B 实调未完成

- `scripts/eval-fullchain.ts` 已补充 A 辅助识别触发与 B 翻译探测。
- 由于当前未配置 Qwen API，报告中 A/B 调用状态为未完成，这属于环境约束，不是脚本缺失。

## Recommended Next Step

1. 先校准 `table/reference/mixed` 判定阈值，抑制 table 过判
2. 再增强 mixed 页 region 二次分类（同页内 table/reference/paragraph 混合）
3. 之后再接真实 OCR / vision provider（仅作为辅助层）
