# 项目计划

## 当前目标

围绕 PDF 翻译链继续推进“模型 + 抽取算法”能力，重点解决：

- 不同 PDF 版式下漏抽取、误拆分、误合并
- TP / BOM / techpack 类文档识别偏弱
- 抽取结果还没有真正进入主翻译链的增强版本
- 缺少稳定的数据集回归和评估闭环
- 不同文档主类型缺少明确输出策略分流

当前主结论：

- 现有问题主要仍在抽取/分段，不是翻译模型本身
- 当前已进入 `vision-assisted extraction` 的可运行主链阶段，但 second pass 仍是占位/弱实现
- 当前主链仍是 `pdftotext -layout -> feedback-source -> 翻译模型`
- `vision-extraction.ts` 已作为 A 模型辅助识别入口接入主链
- 输出策略需分流：不能再只用一套结果形态覆盖所有资料
- 当前至少要区分：
  - `sketch/comment`
  - `tp/bom/table-heavy pdf`
  - `reference/colour/material`
  - `structured xlsx`

## 整体流程（ASCII）

```text
+------------------+
| Input PDF        |
+------------------+
          |
          v
+------------------------------+
| Text main chain              |
| pdftotext -layout            |
+------------------------------+
          |
          v
+----------------------------------------------+
| Early gate                                   |
| Is text layer obviously insufficient?        |
+----------------------------------------------+
      | yes                           | no
      v                               v
+----------------------------+   +------------------------------------+
| Model A early assist       |   | First-pass fusion                  |
| OCR / layout scan          |   | page type + regions + segmentation |
+----------------------------+   +------------------------------------+
      |                               |
      +---------------+---------------+
                      |
                      v
        +--------------------------------------+
        | Low-confidence check                 |
        | Any low-confidence pages / regions?  |
        +--------------------------------------+
                 | yes                | no
                 v                    v
      +---------------------------+   +----------------------------------+
      | Model A regional assist   |   | Structured extraction result     |
      | OCR / block hints / bbox  |   | segments + regionId + confidence |
      +---------------------------+   +----------------------------------+
                 |                               ^
                 v                               |
      +------------------------------------+     |
      | Second-pass fusion                 |-----+
      | fix / merge / replace boundaries   |
      +------------------------------------+
                      |
                      v
      +------------------------------------+
      | Model B translation                |
      | translate structured text blocks   |
      +------------------------------------+
                      |
                      v
      +------------------------------------+
      | Render / export layer              |
      | numbering + position + output doc  |
      +------------------------------------+
                      |
                      v
      +------------------------------------+
      | Preview / annotated PDF / export   |
      +------------------------------------+
```

说明：

- 模型 A 只做辅助识别，不直接负责整份 PDF 翻译。
- 模型 B 只翻译结构化 block / segment，不参与页面结构识别。
- 对文本层明显不足的页面，A 模型可以提前介入。
- 对文本层可用但局部不稳的页面，A 模型只在低置信度区域补强。

## 文档类型与输出策略

### 输入类型

1. `sketch/comment`
- 线稿、批注、样衣意见页

2. `tp/bom/table-heavy pdf`
- TP、BOM、尺寸表、材料表、tech pack

3. `reference/colour/material`
- 图片参考页、色卡、面料/辅料参考页

4. `structured xlsx`
- 已结构化表格，不走 OCR/版面理解主链

### 输出策略

1. `sketch/comment -> annotated_pdf`
2. `tp/bom/table-heavy -> bilingual_table_bundle`
3. `reference/colour/material -> label_overlay`
4. `structured xlsx -> bilingual_xlsx`

### 当前业务反馈对应的产品判断

- 3 分案例：
  - `Cici Rain Jacket - sketch.annotated.pdf`
  - 说明：路线对了，但质量不够高
- 0 分案例：
  - `Macade TP Cici Rain Jacket W.annotated.pdf`
  - 说明：路线错了，不是单纯质量差

因此当前优化优先级是：

1. 先把 `tp/bom/table-heavy` 从 0 分拉到可确认
2. 再把 `sketch/comment` 从 3 分提升到顺手可用

## 已完成

1. 数据归档元信息
- 已新增：
  - `data/README.md`
  - `data/20260315/manifest.json`
  - `data/20260324/manifest.json`
- 当前两批业务样本已能按 `source_pdf / reference_pdf / reference_xlsx` 管理

2. Phase 1 骨架评审
- 已新增：
  - `docs/project/vision-extraction-phase1-review.md`
- 已明确：
  - Phase 1 的职责边界
  - 当前实现的强项和不足
  - 与主翻译链的关系

3. 数据集评测脚本
- 已新增：
  - `scripts/eval-extraction-dataset.ts`
  - `npm run extract:eval`
- 已输出：
  - `docs/project/vision-extraction-dataset-eval.md`
  - `docs/project/fullchain-eval-report.md`

5. 全链路评估脚本（新增）
- 已新增：
  - `scripts/eval-fullchain.ts`
  - `npm run eval:fullchain`
- 说明：
  - 评估链覆盖 A 辅助识别触发、抽取融合、B 翻译探测、人工复核待办计数。
  - A/B 默认统一走 `qwen3.5-35B`（通过 OpenAI-compatible 配置）。

4. V2 方案文档收口
- 已更新：
  - `docs/project/translation-extraction-v2.md`
- 已明确：
  - 当前主链不是整份 PDF 直接多模态翻译
  - 多模态应作为低置信度区域补强层

6. 结果产物与下载/预览闭环
- 已新增真实结果产物：
  - `tp/bom/table-heavy -> bilingual_xlsx`
  - `sketch/comment -> annotated_html_preview`
- 已新增统一下载/预览接口：
  - `/api/assistant/artifacts?path=<relativePath>`
- 已在主链结果中透传：
  - `artifactLinks.bilingualXlsx`
  - `artifactLinks.annotatedPreview`

## 当前追踪状态

### 已到位

1. `tp/bom/table-heavy`
- 已不再只是结构层 `rows`
- 已能真实产出 `.xlsx`
- 已有下载接口可消费

2. `sketch/comment`
- 已不再只是 `annotatedPdf` 内存结构
- 已能真实产出 `.annotated-preview.html`
- 已有预览接口可消费

3. 专项回归
- `data/local/manifest.json` 已加入默认 `eval:fullchain`
- `Macade` / `Cici` 已纳入专项自动回归

## 当前验证结论

### 已验证通过

1. `npm run lint`
- 通过

2. `npm run extract:eval`
- 通过
- 已覆盖：
  - `data/20260315`
  - `data/20260324`

3. 跨文档抽取稳定性
- 当前样本均可完成基础文本抽取和结构化 section/segment 构建
- 未出现“某一类 PDF 直接崩掉”的情况

### 当前明显不足

1. `next build` 仍失败
- 与当前抽取骨架本身无直接关系
- 当前工作区缺失：
  - `src/lib/assistant/catalog.ts`
  - `src/lib/assistant/db.ts`
- 主链完整构建不可作为 Phase 1 完成标准

2. 页面类型识别已增强（但仍需抑制过判）
- `ATA001`、`ATA019` 已出现明显 `table` 命中（不再是 0）
- 当前存在部分文档 `table` 过判风险，需要下一轮校准阈值

3. 区域切分已落地（多区域）
- `feedback-source.ts` 已从“每页单 region”升级到“按列/间隔切分多 region”
- 重点样本中可见每页 region 数 > 1（如 ATA001/ATA019 第7页）

4. `vision-extraction.ts` 已接入主链，但真实增益仍有限
- 当前已作为 A 模型辅助识别入口参与 pipeline
- second pass 真实纠偏融合仍未完成

5. `extractionMeta` 部分透传
- 已进入 `FeedbackSourceReference` 且在评测输出中可见（sourceType / low-confidence 统计）
- 尚未进入翻译链 / PDF 链 / UI

6. 当前离线与业务主链接入状态（本轮更新）
- `service.ts` 已接入 `translation-pipeline.ts`，上传 PDF 会进入真实主链执行（不再仅 mock）。
- `eval-fullchain.ts` 已复用同一主链实现，不再绕过 `vision-extraction.ts` 直接探测。
 - A/B fallback 的**可读原因**（脱敏）：`metadata.pipelineFallbackHints` 与 pipeline `diagnostics` 中的 `bModelApiConfigured`、`bModelBatchAttempts`、`bModelBatchJsonOk`、`bModelLastErrorKind`；常见原因包括未配置 API、HTTP 错误（含 `HTTP 429 / rate_limited` 配额超限）、JSON 解析失败；**不等于**生产环境已稳定跑满模型。

7. 文档主类型与输出策略分流（本轮新增）
- `sketch/comment`：默认走 `annotated PDF` 路线（编号 + 中文批注 + 页面对位）。
- `TP/BOM/table-heavy`：默认走 `bilingual table / xlsx / table-style pdf` 路线，不再默认 annotated PDF。
- 结果结构已可按策略输出：
  - `annotatedPdf`（原位双语优先，长文本回退 footnote）
  - `bilingualTableBundle`（表格行输出，保留抽取元数据）
- `tp_bom_table_heavy` 已新增可下载产物：
  - `bilingual_xlsx` 文件写入 `.tmp/exports/`
  - 下载路径通过 `outputs.bilingualTableBundle.downloadable.relativePath` 返回
  - 下载接口：`/api/assistant/artifacts?path=<relativePath>`
- `sketch/comment` 已新增可查看预览产物：
  - `annotated_html_preview` 文件写入 `.tmp/exports/`
  - 由 `annotatedPdf.inline_bilingual_preferred` + `footnotes` 真实渲染生成
  - 预览接口同上（`.html` 使用 inline 返回）
- `reference/colour/material`：默认走轻量标签翻译与补充说明，不强行套用重编号批注。
- `structured xlsx`：默认走 bilingual xlsx，不进入 PDF OCR 主链。

8. 本轮已部分收口（仍非业务全链路终态）
- 工作台 `workspace.tsx` 已消费 `metadata.pdfArtifactLinks`：表格类展示「下载双语 Excel」，线稿/批注类展示「打开翻译预览」，主按钮由 `primary` 字段区分；同屏展示 `pipelineFallbackHints`（脱敏）。
- `documentMainType` 判型已改为**按页**聚合版式（不再按 region 误累计），且「表格段占比」需与「表格页占比」联合判断，避免线稿 PDF 因局部表格块段占比高被误判为 TP；专项样本 `Macade` 已稳定为 `tp_bom_table_heavy`（在本地源文件存在时的 `eval:fullchain` 中可复现）。
- `bilingualTableBundle` 已新增可下载 `table-style pdf`（基于 `bilingualTableBundle.rows` 的表格排版），作为第二产物提供业务确认。
- 本轮表格排版继续打磨：缩小外边距/紧化行高，并改进中文无空格换行（tokenization + 动态限制最大行数），减少跨页断点跳动（仍为最小可用排版）。
- 本轮“业务样本产物生成”（以便先看效果、再给业务确认）：
  - 样本源：`data/test/Cici Rain Jacket - sketch.pdf`、`data/test/Macade TP Cici Rain Jacket W.pdf`（不依赖 `.tmp/task-uploads`）。
  - 产物（落盘于 `.tmp/exports/`）：
    - `Cici` 预览：`.tmp/exports/Cici_Rain_Jacket_-_sketch.pdf.9e6334545f.annotated-preview.html`
    - `Macade` Excel：`.tmp/exports/Macade_TP_Cici_Rain_Jacket_W.pdf.17ae78172b.bilingual.xlsx`
    - `Macade` 表格 PDF：`.tmp/exports/Macade_TP_Cici_Rain_Jacket_W.pdf.c9d40d53e4.table-style.pdf`
  - 真实翻译命中（本轮参数：`EVAL_FULLCHAIN_MAX_SEGMENTS=1 B_MODEL_MAX_TOKENS=180 B_MODEL_SEG_TEXT_MAX_CHARS=400`）：
    - `fullchain-eval-report.md`：Macade `zhPopulationPct=2`、Cici `zhPopulationPct=1`；`B` 批次解析 `1/1` 成功（仍不等于全文完成）。
    - 抽检：Macade xlsx `Chinese_non_empty=1/66`；Cici 预览存在 `zh-inline`，但大量段落仍为 `待人工补译`（需在配额更稳时继续提高覆盖率）。
- 仍待：抽取层对「表格块 vs 线稿页」的版式分类进一步校准、`mixed` 类文档的产品口径。

## 后续任务

### P0

1. 多区域切分
- 目标：
  - 把 `feedback-source.ts` 从“整页单区域”升级到“每页多区域”
- 必须完成：
  - 至少区分：
    - 左列说明区
    - 右列说明区
    - 图片/参考说明区
    - 表格块
  - 不能继续只返回一个 region

2. TP / table 页识别增强
- 目标：
  - 提升 `ATA001`、`ATA019` 这类 PDF 的 `table` 命中率
- 必须完成：
  - 新增更适合 TP/BOM 的 heuristic
  - 在评测报告里能看到 `table` 页开始出现

3. pageLayoutType -> regionType -> segment 策略分流（第一轮融合）
- 目标：
  - 不同页型/区域用不同拆分合并策略
- 必须完成：
  - `sketch`
  - `table`
  - `reference`
  - `mixed`
  - 不能再只靠同一套通用规则

4. 端到端透传 `extractionMeta`
- 目标：
  - 让来源、置信度、regionId 真正进入下游
- 必须完成：
  - 进入翻译输入结构
  - 进入 PDF 标注或结果结构
  - 至少能在调试输出中看到

5. 文档与代码对齐
- 必须同步更新：
  - `docs/project/translation-extraction-v2.md`
  - `docs/project/vision-extraction-phase1-review.md`
  - `docs/project/vision-extraction-dataset-eval.md`

### P1

1. `vision-extraction.ts` 接入真实 provider（包含 early gate 早期识别与低置信度区域补强）
- 目标：
  - 接 OCR 或轻量多模态作为辅助抽取层
- 约束：
  - 不允许把整份 PDF 直接改成多模态翻译主链
  - 仅做辅助抽取、补 OCR、bbox/块定位

2. 低置信度区域补强
- 目标：
  - 只对低置信度区域走视觉增强
- 必须完成：
  - segment 级低置信度识别
  - fallback / merge 逻辑

3. 抽取评测增强
- 目标：
  - 让评测不只统计 pages/segments
- 建议加入：
  - `table page recall`
  - `reference page recall`
  - `avg regions per page`
  - `low-confidence segment count`
  - `early-gate pages`
  - `second-pass triggered`

4. 输出策略落地
- `sketch/comment -> annotated PDF`
- `TP/BOM/table-heavy -> bilingual table bundle`
- `reference/colour/material -> label_overlay`
- `structured xlsx -> bilingual_xlsx`
- 在结果结构与导出层完成策略消费（当前已在 pipeline 给出策略建议值）

5. 业务体验优化
- `sketch/comment`
  - 原位双语优先
  - 放不下时再回退编号/侧注
- `tp/bom/table-heavy`
  - 页面优先提供 bilingual table / xlsx 下载入口
  - 不再默认打开 annotated PDF

### P2

1. UI 显示低置信度
- 在结果页或调试页显示：
  - `sourceType`
  - `layoutConfidence`
  - `mergeConfidence`

2. 结构化翻译质量对照
- 目标：
  - 用 `reference_pdf / reference_xlsx` 做更接近人工结果的对照评估

## Cursor 开发约束

1. 不允许把主链改成“整份 PDF 直接多模态翻译”
2. 不允许为了 `Cici` 或某一个样本写路径/文件名特判
3. 必须保留文本主链
4. 必须继续使用现有样本做跨版式验证：
- `data/20260315`
- `data/20260324`
5. 未完成的能力不能写成已完成

## Cursor 交付要求

每轮至少交付：

1. 代码改动
2. 文档同步
3. 样本验证结果
4. 明确说明：
- 哪些完成了
- 哪些部分完成
- 哪些还没做

## 本轮之后最建议的下一步

1. 前端正式消费 `artifactLinks`
- `tp/bom/table-heavy`：显示“下载双语 Excel”
- `sketch/comment`：显示“打开翻译预览”

2. 校准 `documentMainType` 判型
- 优先修 `Macade TP Cici Rain Jacket W` 误判
- 继续降低 `table` 过判/漏判

3. 查清模型 fallback
- 当前评测显示 A/B 大面积回退
- 需区分配置问题、网络问题、超时问题、provider 行为问题

4. 补 `table-style pdf`
- 让 `tp/bom` 从单产物（xlsx）升级为双产物（xlsx + pdf）

5. 将 `data/local/manifest.json` 中仍指向 `.tmp/...` 的样本迁移到稳定数据目录
- 避免清理临时文件后专项回归失效

## 当前业务样本状态（2026-03-26）

- `Cici Rain Jacket - sketch.pdf`
  - 已修正：低覆盖率时的 preview 不再堆满“待人工补译”，而是只展示已译条目并明确告知覆盖率不足。
  - 当前现实：能作为“方向/样式/定位方式”预览，不适合作为翻译完成稿。
- `Macade TP Cici Rain Jacket W.pdf`
  - 已修正：`table-style pdf` 中文不再乱码；`xlsx` 增加 `Summary` + `TranslatedOnly`，避免直接打开就是大面积空白。
  - 当前现实：可用于确认表格结构与少量真实译文，不适合作为全文翻译完成稿。
- 共同阻塞：
  - 真实翻译覆盖率仍低，主要受 `HTTP 429 / rate_limited` 约束。
  - 当前应优先把“业务预览是否达标”和“真实翻译是否跑满”明确分开，不再让低覆盖率产物伪装成完整业务成品。
