# Gemma4 B-only 对比摘要包（2026-04-07）

## 目的

这份文档用于快速查看：

- 当前阶段版 PDF
- 本地 `gemma-4-31B-it-Q3_K_M.gguf` 作为 **B 模型** 的 refined 对比版 PDF
- 每份样本的核心差异与建议结论

注意：

- 这不是“全本地 A/B”对比
- 这里固定复用了已成功 run 的 A 输出和 `segments`
- 只替换 B 为本地 `gemma4`
- 因此这里反映的是 **翻译风格差异**，不是识别差异

## 总结

| 样本 | 阶段版有效条数 | 本地 B-only 有效条数 | 剩余差异数 | 当前判断 |
| --- | ---: | ---: | ---: | --- |
| `M422123` | `19 / 24` | `19 / 24` | `5` | 可用，差异主要在状态词和面料规格压缩 |
| `M441083` | `38 / 46` | `38 / 46` | `2` | 很接近，差异集中在面料术语和“做工/工艺”措辞 |
| `M445033` | `36 / 60` | `36 / 60` | `4` | 很接近，差异已很少 |
| `M415013` | `30 / 48` | `30 / 48` | `1` | 基本收口，只剩 `11 Ecr` 的语义解释争议 |

结论：

- 本地 `gemma4` 作为 **B** 已经能稳定承接 4 个 sketch/comment 代表样本
- 当前差异不再是漏翻或 suppress 失控，而是：
  - 术语更直译
  - 长句压缩不如阶段版
  - 少量局部标签解释与人工稿口径不同

## 对比文件

### M422123

- 阶段版：
  - [M422123.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M422123.annotated.pdf)
- 本地 B-only refined：
  - [M422123.pdf.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/gemma4-b-only-review-refined-v3/M422123/M422123.pdf.annotated.pdf)

主要差异：

- `待确认` vs `待处理`
- 面料规格仍偏原文压缩格式：
  - `#CND250214 ...`
  - `#DYS-WS237230 ...`
- `选项 1/2` 的表达更直译

建议结论：

- 这份已经足够说明本地 `gemma4` 作为 B 可以工作
- 若继续优化，优先收状态词和面料规格模板

### M441083

- 阶段版：
  - [M441083.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M441083.annotated.pdf)
- 本地 B-only refined：
  - [M441083.pdf.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/gemma4-b-only-review-refined-v3/M441083/M441083.pdf.annotated.pdf)

主要差异：

- `压胶` / `复合` 这类材料工艺术语选择不同
- `所有工艺需防水` vs `所有做工需防水`

建议结论：

- 这份主要体现“术语风格差异”
- 不是能力问题，而是工艺单短句风格还没完全贴近阶段版

### M445033

- 阶段版：
  - [M445033.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M445033.annotated.pdf)
- 本地 B-only refined：
  - [M445033.pdf.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/gemma4-b-only-review-refined-v3/M445033/M445033.pdf.annotated.pdf)

主要差异：

- `顶部明线 7mm` vs `顶部明线7mm`
- `原创设计` vs `同原设计`
- `内部设计` vs `内里设计`
- `整洁包边` vs `包边处理`

建议结论：

- 这份已经非常接近
- 当前本地 `gemma4` 作为 B 的成熟度，在这 4 份里 `M445033` 最接近阶段版

### M415013

- 阶段版：
  - [M415013.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M415013.annotated.pdf)
- 本地 B-only refined：
  - [M415013.pdf.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/gemma4-b-only-review-refined-v3/M415013/M415013.pdf.annotated.pdf)

主要差异：

- `11 Ecr` 当前仍被解释成颜色，而阶段版更接近裁片标签

建议结论：

- 这份已经基本收口
- 如果后续继续投资本地 B，建议先让业务确认 `11 Ecr` 该按颜色解释还是按裁片标签解释

## 建议怎么用这份结果

如果你的目标是：

- 判断“本地 `gemma4` 作为 B 能不能接主链”
  - 现在答案是：能

- 判断“能不能直接替代当前阶段版”
  - 现在答案是：还不能完全替代

- 判断“还值不值得继续优化本地 B”
  - 现在答案是：值，但已经进入术语和短句风格打磨阶段

## 下一步建议

优先级建议：

1. 先确认 `11 Ecr` 的业务口径
   - 颜色标签
   - 还是裁片/位置标签

2. 不再优先投入全本地 A/B
   - 当前全本地复杂样本主链仍不稳定
   - 更值得的是把本地 `gemma4` 当作 B 路径继续打磨

3. 若要切阶段性提交
   - 现在已经是一个比较清晰的里程碑：
     - 本地 B-only 对比工具
     - 本地页图尺寸控制
     - 对比结论文档
