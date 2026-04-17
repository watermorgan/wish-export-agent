# Back elasticated waistband 覆盖/漏翻译回归测试（footnote -> side panel）

## 目的
确认当原文为 `Back elasticated waistband` 时：
1. 译文仍然生成（`后腰部橡筋`）
2. annotated PDF 中该译文不会以蓝色 inline overlay 的形式压住左侧原英文（你指出的覆盖问题）

## 本次定位的渲染缺陷
`scripts/render_feedback_pdf.py` 的 inline_candidates 逻辑在部分场景会把“render_mode != inline 的 note”也纳入蓝色 inline overlay 候选（例如 translation 较短 + sketch/mixed/vision 条件）。
这会导致 footnote 类型 note 在几何 bbox 估计不充分时把蓝色块画到左侧英文附近，从而出现“被挡住/看不到译文”的可视缺陷。

## 本次改动点（逻辑）
- `scripts/render_feedback_pdf.py`
  - inline_candidates 收紧：仅当 `note.get('render_mode') == 'inline'` 才允许进入蓝色 inline overlay

## 测试步骤
### 1. 代码静态校验
在 worktree 内执行：
```bash
python -m py_compile scripts/render_feedback_pdf.py
npx tsc --noEmit
npm run lint
npm run build
```
期望：以上全部 PASS。

### 2. 真实 PDF 端到端回归（verify）
```bash
npm run verify:pdf-e2e -- data/test02/M422123.pdf
```
期望：ok=true，并生成 annotated PDF 与相关预览/交付物。

## 渲染产物证据（Back elasticated waistband）
本次 verify 的 taskId：
- `task_1776345827573_lltvs5`（首次回归）
- `task_1776346565216_5qyin9`（主目录同步后回归再确认）

### 1. 最终 annotated PDF 的几何证据（pdfplumber）
在：
- `.tmp/task-artifacts/task_1776345827573_lltvs5/M422123.annotated.pdf`

使用 pdfplumber 抽取 `后腰部橡筋` 的词框 bbox：
- `page.width = 1089.92`
- `后腰部橡筋` 的 bbox：`x0=887.92`

结论：bbox x0 已落到右侧面板区域（> 原始页面宽度阈值），不再处于可能覆盖左侧英文的位置，从而规避了“被挡住”的可视缺陷。

补充证据（第二次 e2e）：
- `.tmp/task-artifacts/task_1776346565216_5qyin9/M422123.annotated.pdf`
- `后腰部橡筋`：仍满足 `page.width=1089.92` 且 `x0=887.92`

## 产物位置（方便打开）
- annotated PDF：
  - `.tmp/task-artifacts/task_1776345827573_lltvs5/M422123.annotated.pdf`
- annotated preview HTML：
  - `.tmp/exports/` 下对应 `M422123.pdf.*.annotated-preview.html`

## 结论
通过静态校验 + 真实 PDF e2e 回归，确认：
- `后腰部橡筋` 正常渲染
- 覆盖风险区域不再出现蓝色 inline overlay 压住原英文的问题。

