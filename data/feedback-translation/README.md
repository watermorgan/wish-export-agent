# Feedback Translation Dataset

这个目录用于存放“意见翻译与归并”场景的真实输入和人工标准答案。

## 目录结构

- `case-XXX/input/`: 原始输入文件（PDF, XLSX, 截图文本等）。
- `case-XXX/golden/`: 人工标准答案（Golden Set）。
- `case-XXX/context.md`: 业务上下文背景。
- `case-XXX/rubric.md`: 该案例的专项评测规范。

## 标准答案规范 (Golden Set Spec)

为了支持自动化或人工评测，`golden/` 下的参考文件应遵循以下结构建议：

### 1. `translation-reference.json` (推荐)
- **Key Fields**:
  - `sourceFile`: 对应原始文件名
  - `title`: 该标准答案标题
  - `sections`: 按业务区块组织的章节列表
  - `sections[].title`: 章节标题，例如 `Quality / 面料与核心卖点`
  - `sections[].summary`: 本章节的业务说明
  - `sections[].segments[].source`: 原始英文片段
  - `sections[].segments[].translation`: 标准中文翻译

- PDF 可以继续保留在 `golden/` 目录中作为人工底稿，但系统预览和自动评测应优先读取 `translation-reference.json`。

### 2. `merge-reference.json` (或 .md)
- **Key Fields**:
  - `groups`: 分组后的主题列表
  - `conflicts`: 明确识别出的冲突点
  - `summary`: 该案例的核心关注点摘要

## 评测维度 (Rubric Dimensions)

1. **准确性 (Accuracy)**: 翻译是否还原原意，尤其是外贸术语（如 FOB, MOQ, Lead time）。
2. **完整性 (Completeness)**: 是否有遗漏的批注或意见。
3. **风险识别 (Risk Awareness)**: 价格、交期、商业承诺是否被 100% 识别并标记为“待确认”。
4. **归并逻辑 (Merger Logic)**: 重复项是否去重，冲突项是否被明确暴露而非静默合并。
