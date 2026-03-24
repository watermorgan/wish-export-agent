# Output Strategy Decision

## 背景

基于业务反馈：

- `Cici Rain Jacket - sketch.annotated.pdf`：3 分（方向基本正确但质量不足）
- `Macade TP Cici Rain Jacket W.annotated.pdf`：0 分（策略错误，不是单纯翻译质量问题）

结论是“文档类型分流 + 输出策略分流”必须成为正式规则。

同时，后续不能只按 `sketch/comment` 与 `tp/bom` 两类理解输入，而应至少分成：

- `sketch/comment`
- `tp/bom/table-heavy pdf`
- `reference/colour/material`
- `structured xlsx`

## 正式规则

1. `sketch/comment` 文档
- 主输出策略：`annotated PDF`
- 优化重点：长说明合并、短标签拆分、对位稳定、漏译和截断控制
- 下一阶段方向：优先“原位双语”，空间不足时再回退编号/侧注

2. `TP/BOM/table-heavy` 文档
- 主输出策略：`bilingual table / bilingual xlsx / table-style pdf`
- 不再默认走 `annotated PDF` 作为唯一结果

3. `reference / colour / material` 文档
- 主输出策略：图片旁短标签翻译 + 轻量补充说明
- 不强行走整页表格，也不默认走重编号批注

4. `structured xlsx`
- 主输出策略：`bilingual xlsx`
- 不进入 OCR / 版面理解主链

## 当前业务评分解释

### 3 分：`Cici Rain Jacket - sketch.annotated.pdf`

含义：

- 输出方向基本正确
- 业务可以勉强使用
- 但抽取粒度、对位、漏译和截断问题仍明显

=> 这是“路线对、质量不够”的问题。

### 0 分：`Macade TP Cici Rain Jacket W.annotated.pdf`

含义：

- 输出形态不适合文档类型
- 即使翻出部分中文，业务也无法高效确认
- 关键问题不是“模型不够强”，而是“表格型文档不该继续走 annotated PDF 路线”

=> 这是“路线错了，不只是质量不够”的问题。

## 实施优先级

1. 先把 `tp/bom/table-heavy` 从 0 分拉到“可确认”
- 优先落地：
  - bilingual xlsx
  - bilingual table pdf

2. 再把 `sketch/comment` 从 3 分提升到“顺手可用”
- 优先落地：
  - 原位双语
  - 更自然的中文高亮
  - 更少的编号依赖

## 实施边界

- 模型 A 仅做识别辅助（OCR、文本块、区域提示），不负责整文翻译。
- 模型 B 仅翻译结构化 segment / block，不承担结构识别。
- 主链仍是：`pdftotext -layout -> first pass -> low confidence -> A assist -> second pass -> B translate -> render/export`。

## 当前实现状态（本轮）

- 已在 pipeline 结果结构中加入：
  - `documentMainType`
  - `outputStrategy`
- 已加入策略化输出载体：
  - `annotatedPdf`（`inline_bilingual_preferred`，长文本回退 footnote）
  - `bilingualTableBundle`（最小可用 rows 输出，保留 page/region/source/confidence）
- 已基于布局特征给出策略建议：
  - `tp_bom_table_heavy -> bilingual_table_bundle`
  - `sketch_comment -> annotated_pdf`
  - `reference_colour_material -> label_overlay`
  - `structured_xlsx -> bilingual_xlsx`

未完成项：

- TP/BOM 的完整 bilingual xlsx/table-pdf 导出还未落地，仅完成策略分配与预留出口。
- reference / colour / material 的轻量原位标签渲染仍未落地。
- structured xlsx 的直通双语输出仍未落地。
