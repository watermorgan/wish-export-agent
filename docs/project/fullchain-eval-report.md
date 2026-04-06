# Offline Evaluation Harness Report

Generated at: 2026-03-25T16:18:35.521Z

## Dataset Coverage Note

- 以下 manifest 目录缺失，因此本次报告仅覆盖已存在的清单（例如 local 专项）：data/20260315/manifest.json, data/20260324/manifest.json

| Sample | Source PDF | DocType | OutputStrategy | Refs | Segments | EarlyGate | LowConfPages | 2ndPassReq | aAssistProbeTriggered | aAssistProbeCompleted | translationProbeCompleted | zhPopulationPct | scriptDerivedHumanReviewItems | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | --- |
| macade-tp-cici-rain-jacket-w | Macade TP Cici Rain Jacket W.pdf | tp_bom_table_heavy | bilingual_table_bundle | 0 | 66 | 0 | 1 | yes | yes | no | yes | 2 | 3 | 抽取与导出链路完成；A:已触发但未完成(回退/失败)；B:批次解析全部成功(1/1)。 |
| cici-rain-jacket-sketch | Cici Rain Jacket - sketch.pdf | mixed | annotated_pdf | 0 | 87 | 0 | 1 | yes | yes | no | yes | 1 | 3 | 抽取与导出链路完成；A:已触发但未完成(回退/失败)；B:批次解析全部成功(1/1)。 |

## Metric notes

- `zhPopulationPct`：结构化 segment 中带非空译文字段的比例（百分比）；受 `EVAL_FULLCHAIN_MAX_SEGMENTS` 等批处理上限影响，不等于“全文人工作业完成度”。

## Human Review Checklist

- 抽取完整性：关键说明、表格、标签是否都进入结构化结果。
- 翻译可用性：术语准确、句义完整、可直接给业务使用。
- 定位可追溯性：能定位回页码/区域并解释低置信原因。
- 导出可用性：渲染与导出结果是否保持源段落映射。

