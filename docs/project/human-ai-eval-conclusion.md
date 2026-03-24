# Human + AI 联合评估结论（当前轮次）

Generated at: 2026-03-24

## 结论摘要

- 当前仓库已具备“全链路真实评估”的执行能力：可跑 `A辅助识别触发 -> 抽取融合 -> B翻译探测 -> 人工复核清单`。
- 当前环境下尚未完成真实模型闭环验证：`QWEN_API_KEY / QWEN_BASE_URL` 未配置，A/B 模型调用未实际发生。
- 因此本轮结论属于“流程与评估框架可用，模型实调待完成”。

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

- **可以进入**，前提是先补环境配置：
  - `QWEN_API_KEY`
  - `QWEN_BASE_URL`
  - （可选）`QWEN_MODEL=qwen3.5-35b-instruct`
- 配置后重新执行：
  1. `npm run lint`
  2. `npm run extract:eval`
  3. `npm run eval:fullchain`
  4. 四个重点样本 `test-extraction`

## 下一步建议（按优先级）

1. 完成 Qwen 环境参数注入并重跑全链路评估
2. 补“人工评分表”逐样本结果并与 AI 指标并排
3. 在 low-confidence 样本上启用真实 second pass 修正逻辑
4. 输出下一版可上线边界（灰度范围与回退策略）
