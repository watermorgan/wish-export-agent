# Dart 术语映射回归测试（Dart -> 省道）

## 目的
确认 PDF 翻译链路中，外贸工艺术语 `Dart/dart` 在译文与渲染产物中稳定被映射为 **`省道`**，避免出现“Dart 被翻成 省（不符合业务口径）”或渲染位置造成误读。

## 本次改动点（逻辑）
1. `data/glossary/core.json`
   - 将 `dart` 的标准中文从 `省` 修正为 `省道`
2. `src/lib/assistant/translation-pipeline.ts`
   - `normalizeFashionTranslation()` 的 `dart` fallback 字符串同步为 `省道`
3. `src/lib/assistant/__tests__/translation-rendering.test.ts`
   - 新增单元测试：`normalizeFashionTranslation('dart', '省') === '省道'`

## 测试步骤

### 1. 单元测试（验证 normalize 归一逻辑）
在 worktree 内执行：
```bash
node --import tsx --test src/lib/assistant/__tests__/translation-rendering.test.ts
```

期望：所有子测试通过，且 `normalizeFashionTranslation glossary exact-match for dart` 为 `ok`。

### 2. PDF 快检（真实 PDF smoke）
```bash
npm run smoke:pdf
```

期望：
- `pass: true`
- `translationCoveragePct: 100`

本次证据：
- `docs/project/pdf-pipeline-smoke-report.fast.json`（本次 smoke 的输出文件）
- 关键字段：`pass=true`，`zhPopulationPct=100`，`translatedSegmentCount=26`

### 3. 端到端真实 PDF（verify:pdf-e2e）
```bash
npm run verify:pdf-e2e -- data/test02/M422123.pdf
```

期望：全链路通过并生成 delivery/preview/xlsx/table-style/annotatedPdf 产物。

本次证据：
- `ok: true`
- `taskId=task_1776345356718_1z0vp4`

## 渲染产物证据（Dart -> 省道）

### 1. Snapshot 内部译文证据（translator-response.json）
在 e2e 产物目录：
`.tmp/task-artifacts/task_1776345356718_1z0vp4/translator-response.json`

找到 `en: "Dart"`（或 `dart`）条目，期望：
- `zh: "省道"`

本次结果：`dart zh=省道`（page=2）。

### 2. 最终 annotated PDF 的文本证据
在 e2e delivery annotated PDF：
`.tmp/task-artifacts/task_1776345356718_1z0vp4/M422123.annotated.pdf`

使用 pdfplumber 抽取文本统计：
- `省道` 出现次数：`1`
- `省` 出现次数：`0`

结论：本次回归在“译文内容”层面已经正确，且不会出现 Dart 被渲染为“省”的问题。

## 产物位置（方便打开）
1. annotated delivery PDF（可下载版本）：
   - `.tmp/task-artifacts/task_1776345356718_1z0vp4/M422123.annotated.pdf`
2. annotated preview HTML（站内渲染预览）：
   - `.tmp/exports/` 下对应的 `M422123.pdf.*.annotated-preview.html`
3. 双语 xlsx：
   - `.tmp/exports/` 下对应 `M422123.pdf.*.bilingual.xlsx`

## 结论
通过单元测试 + 真实 PDF smoke + 真实 PDF e2e，确认 `Dart/dart -> 省道` 映射正确，并且 annotated PDF 中 `省` 不再出现（至少在 Dart 相关文本抽取维度上为 0）。

