# 人工翻译 vs AI 阶段版对比分析

更新时间：2026-04-10

## 1. 人工翻译数据在哪里

当前仓库中，人工翻译 PDF 位于：

- [M422123翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M422123翻译.pdf)
- [M441083翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M441083翻译.pdf)
- [M445033翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M445033翻译.pdf)
- [M415013翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M415013翻译.pdf)

对应当前 AI 阶段版正式 PDF：

- [M422123.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M422123.annotated.pdf)
- [M441083.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M441083.annotated.pdf)
- [M445033.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M445033.annotated.pdf)
- [M415013.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M415013.annotated.pdf)

本轮分析使用的评测依据：

- [m422123 comparison.md](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m422123/comparison.md)
- [m441083 comparison.md](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m441083/comparison.md)
- [m445033 comparison.md](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m445033/comparison.md)
- [m415013 comparison.md](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260403-m415013-rightlower-v1/samples/m415013/comparison.md)

## 2. 总体判断

- 当前 AI 阶段版已经不是“缺块严重、不能用”的状态，4 个代表样本都能进入业务确认范围。
- 与人工翻译相比，当前 AI 的主要差距已不在“主链断裂”，而在：
  - 术语是否压缩成更像人工稿的短句
  - 一条 AI 长句是否拆得足够接近人工稿
  - 少量细项是否被保留为高价值业务点
- 版式层面，当前 AI 正式 PDF 已经优先把中文放在原英文附近的空白处，阅读路径更接近工厂直接使用场景。
- 但它仍不能被表述为“全面替代人工终稿”，尤其复杂 `mixed / TP` 文档不在本轮分析范围内。

## 3. 分样本分析

### 3.1 M422123

人工稿：
- [M422123翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M422123翻译.pdf)

AI 稿：
- [M422123.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M422123.annotated.pdf)

指标：
- `pass`
- recall `80%`
- precision `75%`
- AI coverage `24/24 = 100%`

AI 已经对齐的重点：
- `17mm塑料四合扣黑色门襟用`
- `版型基于M322183`
- `后腰部橡筋`
- `斜插侧袋`
- `15mm单开线口袋`
- `省`

与人工稿的主要差异：
- 颜色和面料块仍偏“字段式说明”，例如 AI 会输出 `02#黑色`、面料规格行，而人工稿更像人工整理后的短标签。
- Page 1 仍有少量长句拼接，如 `袋布 + 四合扣`、`拉链 + 水洗选项` 被连在一起；人工稿会拆得更干净。
- AI 仍会带出一些款号/版权/编辑日期等低价值元信息，但这些已经不再是主阅读路径。

业务解释：
- 这份样本已经可以用于版房/工厂对照阅读。
- 继续优化的方向不是“补识别”，而是“把字段式说明再压短一点，更像人工工艺单”。

### 3.2 M441083

人工稿：
- [M441083翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M441083翻译.pdf)

AI 稿：
- [M441083.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M441083.annotated.pdf)

指标：
- `pass`
- recall `73%`
- precision `82%`
- AI coverage `46/46 = 100%`

AI 已经对齐的重点：
- `02#黑色`
- `60g大身，40g袖子`
- `袖口1X1尼龙罗纹，配色`
- `帽上隐形磁吸朝向与MY42033相同`
- `门贴内有拉链`
- `后浮水压双面胶`
- `袋口压双面胶，内藏拉链口袋`
- `侧缝移到后身`

与人工稿的主要差异：
- 辅料/标识类细项还有遗漏，例如：
  - `尺码标`
  - `71694烫标`
  - 右臂票袋隐形拉链
  - `主标`
  - `烫标`
- 部分术语仍偏工程说明，例如：
  - `面料：华悦 HYT23290TPU + 5K/5K 复合...`
  - `肘缝`
  - `胸袋袋布：无明线`
  人工稿通常会更短、更像工艺单标签。

业务解释：
- 这份样本整体结构已经能对齐人工稿，适合作为“复杂 trims / artwork / 结构说明”的示范件。
- 继续优化重点在“标类和袋类细项补齐”，不是整页重做。

### 3.3 M445033

人工稿：
- [M445033翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M445033翻译.pdf)

AI 稿：
- [M445033.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M445033.annotated.pdf)

指标：
- `pass`
- recall `85%`
- precision `85%`
- AI coverage `60/60 = 100%`

AI 已经对齐的重点：
- `版型同M145023`
- `02#黑色`
- `48#海军蓝`
- `3#隐形拉链侧`
- `面料1 与M245013相同面料`
- `面料2 与M145023相同面料`
- `身里春亚纺 黑色`
- `1X1罗纹内领`
- `填充：与M145023相同`
- `棒球领采用1X1罗纹`
- `面料平装领`

与人工稿的主要差异：
- 人工稿里非常短的业务标签仍有少量未被保留，例如：
  - `之前富阳大货`
  - `主标新logo`
  - `码标73518`
  - `15MM四合扣`
  - `滚边处理，缝头要清理干净`
- AI 在 Page 3/4 仍会产出一些“设计说明式”句子，如：
  - `无绗缝 - 填充物为自由卷...`
  - `款式：原创设计；领型：原创设计`
  - `净缝：内部缝份整洁包边`
  这些不一定错，但人工稿通常只保留最实操的短句。

业务解释：
- 这是当前最稳的一类样本之一。
- 如果业务要看“现在 AI 已经接近人工稿到什么程度”，优先看这份。

### 3.4 M415013

人工稿：
- [M415013翻译.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M415013翻译.pdf)

AI 稿：
- [M415013.annotated.pdf](/Users/weitao/Documents/buildworld/aigc/export-agent/.tmp/business-review-pdfs/M415013.annotated.pdf)

指标：
- `pass`
- recall `76%`
- precision `63%`
- AI coverage `48/48 = 100%`

AI 已经对齐的重点：
- `OP1`
- `尺寸和版型同参考样衣`
- `新主标`
- `领圈针织带`
- `2CM领高与主身面料`
- `后背结构同参考样衣`
- `与参考样品相同的正面工艺`
- `相同棉质，但反面无羊羔毛`
- `比主身摇粒绒面料更薄一些`

与人工稿的主要差异：
- 细项召回仍不如前三个样本稳定，人工稿里以下内容还未完全对齐：
  - `码标`
  - `螺纹用双层面料（但是背面不做羊羔毛）`
  - `OP2:毛面为正做无口袋的`
  - `刺绣`
  - `毛`
  - `刺绣颜色顺面料`
- AI 仍会把一些字段/规格解释为独立条目：
  - `面料：SHELL FABRIC`
  - `面料：双层正反面毛圈布/抓绒软布`
  - `正面：100% 棉 / 反面：100% 涤纶`
  - `克重：约 300g；幅宽：150cm`
- 这些不是完全错误，但人工稿会更偏向“只保留业务动作与结论”，不保留这么多中间说明。

业务解释：
- 这份样本已经从前期 fail/warn 收到了可用阶段，但仍是 4 个样本里最需要人工盯细项的一份。
- 如果业务想看“AI 目前还差在哪”，这份最有代表性。

## 4. 版式与使用体验对比

与人工翻译 PDF 相比，当前 AI 正式稿有两个明显差异：

1. AI 稿更强调“原文附近可追溯”
- 当前 AI annotated PDF 会把中文优先放到离原英文最近的空白处。
- 对工厂和版房来说，这比早期“全靠右侧栏和 marker 跳读”的版本更实用。

2. 人工稿仍更像“终稿”
- 人工稿会主动删掉大量规格/过程性说明，只保留最关键的业务句。
- AI 稿目前虽然已经能做到主信息覆盖，但仍会保留更多字段型或说明型内容。

一句话：
- AI 稿更强在“可追溯、离原文近、自动生成”
- 人工稿更强在“短句更干净、只保留最关键结论”

## 5. 结论

- 这 4 份样本里，AI 已经达到“可以拿给业务确认、也可以给工厂/版房直接辅助阅读”的阶段。
- 但如果标准是“完全等同人工终稿”，当前仍有明确差距。
- 最接近人工稿的是：
  - `M445033`
  - `M422123`
- 结构复杂但整体已可用的是：
  - `M441083`
- 最需要继续人工复核细项的是：
  - `M415013`

当前最准确的业务口径应是：

> sketch/comment 这一类样本，AI 当前已经进入可用和可确认阶段；  
> 但仍建议把它视为“高质量辅助稿”，而不是“无需人工复核的最终稿”。
