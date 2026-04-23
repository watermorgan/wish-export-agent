# bom-organizer

**用途**：把工艺单与相关 PDF / 表格整理成结构化 BOM。

## 输入假设

- `files[]`：至少 1 份 PDF 或 xlsx 的工艺单；允许附加面辅料说明文件。
- `taskType = 'bom'`（`manifest.json` 强约束）。
- `goal`：用户用自然语言描述目标 BOM 粒度（面料/辅料/尺寸字段的要不要全、是否合并同款等）。
- 文件的中文/英文可混排；对术语的中文偏好通过项目 glossary 生效。

## 输出契约

- `BOM 初稿`：结构化字段表。
- `缺失字段清单`：因原件不含/抽取置信度低而没能落的字段。
- `冲突字段清单`：同一字段在不同来源读出不同值的记录。
- `待确认项`：主管必须手工 review 的行（`humanReviewGuide` 里会回填）。

## 已知限制

- 当前不会主动重绘 BOM 表格 PDF；结构化字段交给工作台导出或翻译主链的 `bilingual_xlsx`。
- 对 OCR 层极稀疏的扫描件，行级抽取错位会传导到冲突清单；高置信阈值由 `pipelineResult.diagnostics.layoutConfidence` 观察。
- 合并策略是「按字段优先 + 冲突后人工」；不做跨样品归并。

## 失败模式

- 输入完全无法识别（如图片型 PDF 且未开启 vision）：返回空 BOM + 明确告知「识别失败，建议启用 A 模型辅助识别或改提供 xlsx」。
- 多文件矛盾超过阈值：`冲突字段清单` 会膨胀；`HumanReviewGuide` 会把「冲突集中」标记为高风险。

## 升级路径

1. 为 tp/bom/table-heavy 版式加入专门的行对齐提示词（当前共用通用 prompt）。
2. 引入「BOM 模板化」：允许主管先约定字段顺序，skill 严格按此输出。
3. 与 `data/glossary` 打通，让面料/辅料术语的中文译名强一致。

## 相关代码

- manifest：`src/skills/bom-organizer/manifest.json`
- prompt：`src/skills/bom-organizer/prompt.md`
- pipeline 出口：`src/lib/assistant/translation-pipeline.ts` 的 `tp_bom_table_heavy` 分支
