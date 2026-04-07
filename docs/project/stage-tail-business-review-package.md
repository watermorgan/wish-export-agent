# Sketch/Comment 阶段尾业务确认包

更新时间：2026-04-03

## 1. 建议给业务确认的 4 个样本

本轮只建议拿 `sketch/comment` 代表样本给业务确认，不建议把 `mixed` / 大 TP 样本一起打包成“本阶段已全面通过”。

推荐样本与当前状态：

| 样本 | 当前状态 | 指标 | 推荐理由 |
| --- | --- | --- | --- |
| `M422123` | pass | recall 80 / precision 75 | 典型款式图 + page1 材料块 + page2 callout，最适合展示“缺块已补齐” |
| `M441083` | pass | recall 73 / precision 82 | 典型 trims / artwork / 结构批注样本，适合展示右侧辅料区和 page2 结构说明 |
| `M445033` | pass | recall 85 / precision 85 | 当前最稳的 sketch 样本之一，适合给业务建立信心 |
| `M415013` | pass | recall 76 / precision 63 | 本轮最有代表性的“从 fail/warn 拉到 pass”的收口样本，但仍建议业务重点盯细项 |

对应 run：

- `M422123` / `M441083` / `M445033`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/`
- `M415013`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260403-m415013-rightlower-v1/`

## 2. 每个样本给业务时看什么

### 2.1 `M422123`

原始文件：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M422123.pdf`

人工参考：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M422123翻译.pdf`

本轮 AI 对比：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m422123/comparison.md`

本轮 AI 预览：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/exports/M422123.pdf.e7601da60f.annotated-preview.html`

建议业务重点看：
- Page 1：`02 NOIR`、`面料1/面料2`、`袋布`、`四合扣`、`拉链` 是否都已进入主链且定位接近原文。
- Page 2：`Back elasticated waistband`、`Chino pocket + pleat`、`15mm piped pocket`、`Dart` 是否都能看懂且不挡原图。
- 正式稿是否仍保持“可看原文细节”，不会被中文覆盖。

### 2.2 `M441083`

原始文件：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M441083.pdf`

人工参考：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M441083翻译.pdf`

本轮 AI 对比：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m441083/comparison.md`

本轮 AI 预览：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/exports/M441083.pdf.226b177370.annotated-preview.html`

建议业务重点看：
- Page 1：右侧 `TRIMS` 区的拉链、拉头、票袋、反光、主标/码标类信息是否已达到“可理解、可追溯”。
- Page 2：帽子、暗磁、门贴拉链、胸袋、侧缝、反光、双面胶这些结构说明是否和人工稿方向一致。
- 允许仍有少量辅料细项未完全对齐人工拆句，但整体结构批注应已可用。

### 2.3 `M445033`

原始文件：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M445033.pdf`

人工参考：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M445033翻译.pdf`

本轮 AI 对比：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m445033/comparison.md`

本轮 AI 预览：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260331-sketch-batch-arrayrecover-v1/exports/M445033.pdf.f9804ef341.annotated-preview.html`

建议业务重点看：
- 这份主要看“稳定性”，不是看极端补块。
- 检查按扣、拉链、里布、内里结构、后背/侧边结构类说明是否清晰，是否已经接近人工稿阅读体验。
- 这份可作为“当前最稳定的一类 sketch/comment 样本”给业务建立基线。

### 2.4 `M415013`

原始文件：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M415013.pdf`

人工参考：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/M415013翻译.pdf`

本轮 AI 对比：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260403-m415013-rightlower-v1/samples/m415013/comparison.md`

本轮 AI 预览：
- `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260403-m415013-rightlower-v1/exports/M415013.pdf.a0e6653104.annotated-preview.html`

建议业务重点看：
- Page 1：颜色、`OP1`、面料说明、主标、尺寸版型说明是否都已回来。
- Page 2：`领圈针织带`、`2CM领高`、`前片工艺相同`、`后背结构相同`、`前袋/双针` 等是否已达到“能指导设计/打样”的程度。
- 这份仍建议业务重点复核细项：
  - `码标`
  - `OP2`
  - `刺绣`
  - `刺绣顺色`
  - `反面无羊羔毛` 这类组合短句

## 3. 给业务的说明口径

### 3.1 推荐你直接这样说

> 本轮先给你看 `sketch/comment` 这一类的阶段结果。  
> 我们选了 4 个代表样本：`M422123`、`M441083`、`M445033`、`M415013`。  
> 这 4 个样本当前都已经达到阶段验收线，能用于业务确认“方向是否可接受、是否能进入下一阶段”。  
> 但这不等于系统已经全面替代人工终稿，尤其 `mixed` / 大技术包样本还不是本轮主展示对象。  
> 你这轮重点不是挑绝对零误差，而是确认：  
> 1. 关键业务块是否已经稳定回来了  
> 2. 正式稿是否不再挡住原图/英文  
> 3. 术语和表达是否已经接近你们日常人工稿风格  

### 3.2 建议让业务重点确认的 3 类问题

1. 识别召回是否够业务使用  
   重点看颜色、面料、辅料、口袋、拉链、按扣、结构批注、版型说明这些高价值块是否都被带进主链。

2. 表达风格是否能接受  
   不要求每一句都和人工稿一字不差，但要确认：
   - 术语方向对不对
   - 句子是否足够短、像工艺单
   - 是否会误导设计/打样

3. 正式稿是否可实际使用  
   重点确认：
   - 中文不挡原图
   - 仍能看清原英文和线稿细节
   - 批注位置是否基本可追溯

### 3.3 这轮不建议给业务承诺的内容

- 不要说“已经全面替代人工终稿”
- 不要说“所有 PDF 类型都已经通过”
- 不要把 `mixed` / 大 TP 样本混进这轮阶段确认结论

更准确的说法应是：

> sketch/comment 这一类，当前已经到阶段尾可确认状态；  
> mixed / 大 TP 文档是下一阶段继续优化对象。
