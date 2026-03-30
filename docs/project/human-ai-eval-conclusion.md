# Human + AI 联合评估结论（当前轮次）

## test02 人机对比回归（2026-03-29）

- **Run ID**：`20260329-human-ai-rerun-v1`
- **汇总路径**：`data/test02/runs/20260329-human-ai-rerun-v1/reports/summary.md`（及同目录 `summary.json`）
- **命令**：`TEST02_SKIP_EXISTING=1 TEST02_MAX_SEGMENTS=80 npm run eval:test02 -- data/test02/manifest.json 20260329-human-ai-rerun-v1`
- **重要边界**：`TEST02_MAX_SEGMENTS=80` 会裁剪 B 模型翻译条数；**`ata019` 等大 TP 的 18% 覆盖率主要反映「裁剪 + 选段策略」，不是无裁剪下的真实能力**。若要宣称 TP 全集质量，需去掉该上限或显著调大后重跑。
- **`LATEST_RUN.json`**：已指向本次 run 目录（脚本结束时写入）。
- **当前报告口径已补充 run context**：`reports/run-context.json`、`summary.json`、`comparison-summary.json` 现在会显式写出 `TEST02_MAX_SEGMENTS` 与 `budgetCapped`。后续看到 `fail / 低 Recall` 时，必须先判断是不是预算裁剪场景。

### 本轮汇总表（test02 harness：Recall / Precision / pass|warn|fail）

| Sample | Pipeline | Match | Recall | Precision | Coverage | PreviewReady |
| --- | --- | --- | ---: | ---: | --- | --- |
| ata001-smock-jacket | ok | no_reference | 0% | 0% | 510/510 (100%) | yes |
| ata019-shell-jacket | ok | **fail** | 1% | 2% | 88/492 (**18%**) | no |
| hanna-lightweight-skirt | ok | **warn** | 57% | 53% | 69/96 (72%) | yes |
| m415013 | ok | fail | 0% | 0% | 18/18 (100%) | yes |
| m422123 | ok | fail | 0% | 0% | 10/10 (100%) | yes |
| m441083 | ok | fail | 0% | 0% | 20/20 (100%) | yes |
| m445033 | ok | fail | 0% | 0% | 24/24 (100%) | yes |
| m4e002-soft-puffy-down-jkt | ok | fail | 69% | 40% | 73/81 (90%) | yes |

### 简要解读

- **mixed 分治**：`hanna`、`m4e002` 在产物上同时出现 `annotated-preview` + `bilingual.xlsx` + `table-style.pdf`，与「主 annotated + table/reference 补充」一致。
- **ata019**：在 `MAX_SEGMENTS=80` 下 `previewSuppressedReason=coverage_too_low`，对比 **fail** 符合预期；全量评估需重跑。
- **预算裁剪与真实 gap 的拆分方式**：
  - `ata019`、`ata001`、`hanna` 这类 `totalSegments >> TEST02_MAX_SEGMENTS` 的样本，`budgetCapped=true`，其 Recall / Precision 只能作为受限口径参考。
  - `m422123`、`m445033`、`m415013`、`m441083` 在同一轮里 `budgetCapped=false` 但仍出现 `0%`，这更像参考 PDF 拆句 / harness 归一化 / 粒度不对齐，不能再简单归因到“预算不够”。
- **sketch 标杆（m422123 / m445033 等）**：在「已选 segment 覆盖率 100%」下，harness 仍报 **fail、Recall 0%**，更可能来自 **人工参考 PDF 与 AI 候选粒度 / 归一化仍不对齐**，需逐份打开 `samples/<id>/comparison.md` 人工判读，**不能**仅凭 0% 断言「完全没翻到」。

### 建议的下一轮命令

- 无裁剪基线（耗时与 API 成本显著上升）：  
  `npm run eval:test02 -- data/test02/manifest.json <新 runId>`
- 仅重算对比（已有 `pipeline-result.json`）：  
  `npm run compare:test02 -- data/test02/manifest.json <runId>`

---

## 历史结论摘要（2026-03-24）

- 当前仓库已具备“全链路真实评估”的执行能力：可跑 `A辅助识别触发 -> 抽取融合 -> B翻译探测 -> 人工复核清单`。
- 当前环境下尚未完成真实模型闭环验证：模型服务对评测调用触发了 `HTTP 429 / rate_limited`（配额/限流），导致 A/B 实际调用无法稳定完成并回退到占位。
- 因此本轮结论属于“流程与评估框架可用，模型实调待完成（需处理配额/限流约束）”。

## 自动评估结果（AI 侧）

依据 `docs/project/fullchain-eval-report.md` 与 `docs/project/vision-extraction-dataset-eval.md`：

- 低风险样本：`hanna-lightweight-skirt`、`m415013`、`m422123`、`m441083`、`m445033`
  - `lowConfidencePages = 0`
  - 未触发二轮融合需求
- 重点风险样本：`ata001-smock-jacket`、`ata019-shell-jacket`、`m4e002-soft-puffy-down-jkt`
  - 触发 `secondPassRequired = yes`
  - 其中 `m4e002` 出现 `earlyGatePages > 0`
- 当前 `secondPassExecuted = no`，符合 P0“占位不夸大”的边界。

## 人工评估状态（Human 侧）

当前已具备人工抽检清单，但尚未完成逐样本人工打分归档。需要补齐：

1. 抽取完整性（关键字段遗漏率）
2. 翻译可用性（术语准确、语义完整）
3. 定位可追溯性（页码/region 对齐）
4. 导出可用性（渲染与导出一致）

## 风险与边界

- 本轮禁止项满足：
  - 未走整份 PDF 直接多模态翻译
  - 未让翻译模型承担结构识别
  - 未对单一文件写硬编码特判
- 主要剩余风险：
  - A/B 实调未完成，无法给出真实 token/时延/质量统计
  - 二轮融合仍为占位，未产生真实修正增益数据

## 是否可进入“真正评估”

- **可以进入**，前提是能稳定注入环境变量并让模型调用绕过配额/限流约束（例如更长的可用额度/更低并发/更小批次等）：
- 然后重新执行：
  1. `npm run lint`
  2. `npm run extract:eval`
  3. `npm run eval:fullchain`
  4. 四个重点样本 `test-extraction`

## 下一步建议（按优先级）

1. 完成 Qwen 环境参数注入并重跑全链路评估
2. 补“人工评分表”逐样本结果并与 AI 指标并排
3. 在 low-confidence 样本上启用真实 second pass 修正逻辑
4. 输出下一版可上线边界（灰度范围与回退策略）
