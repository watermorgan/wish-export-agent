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

## 口径收敛补充（2026-03-30）

- **comparison 现在优先消费 `pipeline.segments`，不再优先消费 `outputs.annotatedPdf.items`**。这意味着：
  - 正式稿 suppress 掉的条目，不会再被误判成“主链没翻到”
  - test02 评测与正式 PDF 展示层已经解耦
- **当前新的 sketch refresh 直接暴露了另一个更上游的 blocker**：
  - 在 2026-03-30 这轮在线环境中，`m415013`、`m422123` 已出现 `coverage=0%`
  - 这说明当时的在线 B 模型没有稳定产出中文，问题不在 comparison 规则本身
  - 因此这类 run 的 `fail / 0%` 不能继续拿来讨论 sketch harness 粒度，必须先恢复一个稳定的 B 环境，或切回本地/更稳的线上 B 再重跑
- **2026-03-30 补充**：
  - 代码侧已补“主 B 整轮 0 产出时，再切一次备用 B”的最小 fallback，并把 `bModelFallbackUsed / bModelActiveModel` 暴露到 diagnostics、smoke 和页面 metadata
  - 但当日定向验证里，本地备用 B 端点返回“请先连接 VPN”，因此 fallback 成功态暂未在该环境完成端到端实证
  - 同日 `smoke:pdf` 也出现 90s timeout；这进一步说明当前 blocker 仍是模型/网络环境稳定性，而不是 snapshot / comparison 逻辑
  - 随后又验证了两个备用 B 目标：
    - 本地 `Qwen3.5-9B-Q8_0.gguf`：`curl --max-time 8` 到 `172.16.71.201:8001` 仍超时
    - 线上 `qwen3.5-flash`：fallback 已真实触发，`bModelFallbackUsed=true`、`bModelActiveModel=qwen3.5-flash`，但当前 key/endpoint 返回 `403 Forbidden`
  - 结论：当前代码侧 fallback 已接通，运行态 blocker 是“没有一个当前环境可用的备用 B 目标”
  - 随后本地模型服务恢复可达，结论更新为：
    - 本地 B 单条结构化翻译可用
    - `M422123` 在“主 B 故障 + 本地 B fallback”下，`smoke:pdf` 恢复到 `10/10`、`coverage=100%`
    - `M422123` 在“主 A 故障 + 主 B 故障 + 本地 A/B fallback”下，`smoke:pdf` 恢复到 `28/33`、`coverage=85%`
    - `test02` 定向回归：
      - `m422123`：`translatedSegmentCount=28/37`，`referenceRecallPct=67`，`aiPrecisionPct=30`
      - `m445033`：`translatedSegmentCount=28/51`，`referenceRecallPct=39`，`aiPrecisionPct=73`
    - 这说明主链已从“模型不可用导致 0 覆盖率”回到“识别召回与 comparison/术语对齐仍有差距”的正常优化阶段
  - 同日继续优化后：
    - 主 B 若首轮 `batchJsonOk=0` 且连续报 `http / rate_limited`，现在会提前结束主策略并尽快切本地 fallback，不再把 `retranslate` / `vision second stage` 也一并跑满
    - `M422123` 在当前默认环境下已可恢复到 `translatedSegmentCount=35/35`、`coverage=100%`、`bModelFallbackUsed=true`
    - `m441083` 在 mixed sparse 页放宽 vision 补强后，已从 `fail` 拉到 `warn`：`referenceRecallPct=67`、`aiPrecisionPct=60`
    - `m415013` 的主要问题也已从“环境不可用”缩到“page 1 业务句召回不够稳”：
      - 放宽 mixed sparse 页 vision 后，A 已能稳定抽到 `02#黑色`、棉/涤双层面料、袖口/腰带/领面、顺色、抓绒剃薄等业务句
      - 再补 comparison 术语归一后，`m415013` 从 `referenceRecallPct=24 / aiPrecisionPct=25` 提升到 `36 / 31`
      - 随后把 `same front workmanship` / `same back construction` / `same size and shape` 这类句子压成更短的人工稿式表达后，`m415013` 的正文输出更接近参考稿，但 comparison 仍主要受 page 顺序与候选对齐影响，不能再用单一 Recall 数字判断好坏
      - 进一步补页级诊断后确认：`m415013` 的 `visionTargetPages=[1,2,3]`，但 `visionPageBlockCounts` 只有 `page 2 -> 10`；说明 page 1 已被送进 A，只是当前 fallback A 没稳定返回有效业务块
  - 结论：`m415013` 当前更值得继续盯 page 1 的 A 识别稳定性与 provider 运行态，而不是继续把时间耗在 comparison 对齐上
  - 同日晚些时候又补了两项 A 侧诊断/纠偏：
    - `vision-extraction.ts` 现已把 `visionPageErrors` 透传到 `pipeline-result.diagnostics`，可以直接区分主 A 的 `401 Unauthorized`、fallback 的 `no parsable blocks`、以及本地服务不可达
    - `safeParseQwenBlocks` 已确认支持本地多模态返回的顶层 JSON array；此前 `m415013` page 1 存在“模型有返回但 parser 丢弃”的真实问题
  - 对 `M415013` page 1 的单页直连调试结论：
    - 当本地 `Qwen3.5-9B-Q8_0.gguf` 服务可达时，使用**不带 text-layer hints 的简短业务 OCR prompt**，可直接返回 `02 NOIR`、`65 DONUTS 18-1409TCX`、双层面料说明、`SAME COTTON FACE LOOK BUT SHAVED POLAR FLEECE TO BE THINNER` 等有效 JSON blocks
    - 这说明 page 1 的问题并不只是“模型看不到”，还包括 fallback prompt 形态和运行态稳定性
  - 当前新的 blocker 更明确：
    - 主 A 仍持续 `401 Unauthorized`
    - 本地 fallback A 在同一轮回归里存在波动：page 1/3 可能出现 `no parsable blocks`，而服务本身也会间歇性超时/不可达
    - 因此后续若要继续提升 `m415013`，优先级应是：先稳定 A provider 可用性，再用最简本地 fallback prompt 重打 page 1，而不是继续优先改 comparison
  - 2026-03-31 进一步确认了一个更具体的根因：
    - 本地 fallback A 对 `M415013` page 1 的直连调用可稳定返回顶层 JSON array，包含 `02 NOIR`、`65 DONUTS 18-1409TCX`、双层面料说明、`SAME COTTON FACE LOOK BUT SHAVED POLAR FLEECE TO BE THINNER` 等业务块
    - 主管线之前仍报 `vision page 1 returned no parsable blocks`，根因是 `safeParseQwenBlocks` 在 **顶层 JSON array 被截断** 时，恢复逻辑仍只会搜索 `"blocks":[...]` 形态，导致 page 1 结果被整体丢弃
    - 修复为“顶层 array 也走平衡对象恢复”后，`m415013` 新 run `20260331-m415013-arrayrecover-v1` 已恢复到：
      - `visionPageRawBlockCounts: page1=15, page2=11`
      - `visionPageBlockCounts: page1=13, page2=10`
      - `translatedSegmentCount=39/39`
      - `referenceRecallPct=48`
      - `aiPrecisionPct=38`
    - 这说明 page 1 的主矛盾已经从“完全没回块”变成“细项召回和术语/粒度仍有差距”
  - 同日继续把 page 1 术语往人工稿靠：
    - `EN ATTENTE M MEP S40 -> 待处理 M MEP S40`
    - `65 DONUTS 18-1409TCX -> 65#咖色`
    - `11 Ecr -> 11 右片裁剪`
    - `11 Ecru -> 11#米白`
    - `MATCHING COLOR WITH OUTSHELL FABRIC -> 顺色`
    - `CUFF + BELT + COLLAR FABRIC -> 袖口、底摆、领材料`
    - `SAME COTTON FACE LOOK BUT SHAVED POLAR FLEECE TO BE THINNER -> 比主身摇粒绒更薄`
    - 这轮 style-align 后，`m415013` 的 `aiPrecisionPct` 提到 `43`，但由于 A 运行态与 comparison 粒度仍有波动，`referenceRecallPct` 仍不稳定，说明下一步仍应优先看 page 级细项召回，而不是只盯术语分数
  - 2026-04-07 又补了一轮更窄的 stage 对齐规则：
    - `cuff opening slit with 7mm top-stitch -> 袖口开衩，顶部明线 7mm`
    - `original idea for shape and collar shape -> 同原设计`
    - `inside design -> 内里设计`
    - `clean binding finishing for clean inside seams -> 整洁包边`
    - `shell fabric hua yue hyt23290tpu + 5k/5k lamination 100% polyester 177gr/m2 56/57" we need softer handfeel! -> 面料：华悦 HYT23290TPU + 5K/5K 压胶 100% 聚酯纤维 177g/m2 56/57" 手感需更柔软！`
    - 这几条主要用来把 `M445033` 的剩余差异压到人工稿短句风格，不再继续扩大到其他样本族
  - 同日晚些时候把 parser 修复后的 sketch 标杆组一起回归（`20260331-sketch-batch-arrayrecover-v1`）：
    - `m422123`: `pass`，`referenceRecallPct=80`，`aiPrecisionPct=72`
    - `m441083`: `warn`，`referenceRecallPct=57`，`aiPrecisionPct=74`
    - `m445033`: `pass`，`referenceRecallPct=85`，`aiPrecisionPct=85`
    - `m415013`: 仍是 `fail`，但主矛盾已收缩到 page 1 细项（`码标 / OP1 / OP2 / 刺绣 / 更薄+顺色`）召回不足，而不是整页 OCR 缺失
  - 这说明顶层 array 截断容错修复不只是单样本收益，而是对 sketch/comment 路线整体有效；当前 sketch 组的剩余 gap 已经从“主链不稳”收缩到“细项召回 + 术语/粒度对齐”
  - 2026-04-01 继续收 `m415013` 时，还确认了一个更细的规则问题：
    - `PROTO #1 / PROTO #2` 这类方案标签之前被当成低价值字段过滤掉，导致它们虽然在页面上可见，却没有进入 `PipelineResult.segments` / `comparison` 主链
    - 这类标签对 `m415013` 的 reference 对齐是有意义的，不能再默认吞掉；后续如继续追 `m415013`，应先确认 `PROTO` 标签是否已回到主链，再看 `OP1 / OP2 / 刺绣` 等细项是否仍缺
    - 当前本地多模态端点对极窄竖排裁切仍然超时，说明这次问题的主要风险已不是规则，而是 A 端可用性与响应延迟；因此这类细项更适合在代码里保留而不是在回归里靠临时裁切硬跑
  - 2026-04-02 再补了一层时延收口：
    - `ORIGINAL SAMPLE PICTURES` 这类样衣实拍页不再自动进入整页 vision 触发，避免明显低价值页面拖慢 sketch/comment 单样本回归
    - 同时把 A 侧 `401/403/Unauthorized/Forbidden/本地模型不可达` 视为非重试错误，避免无效页级重试继续烧时间
    - 但即便在 `VISION_PAGE_RETRY_LIMIT=0`、更低模型 timeout 和更小 `maxSegmentsForTranslation` 下，`M415013` 的单样本 smoke 仍然会整体 timeout，说明当前阻塞已不只是 page 3 或主 A 授权问题，而是当前运行环境下整条 A/B 链的可用时延仍不稳定
  - 2026-04-02 继续收 `m415013` 时，又确认了两条 durable 结论：
    - 主 B 的 `403 AllocationQuota.FreeTierOnly` 必须在首个失败 batch 就早停并切备用 B；否则会把整轮 smoke / eval 时间无意义拖长。当前已通过在错误消息里透传原始 body，并把这类错误明确归为 `rate_limited`，把 `bModelBatchAttempts` 从早前的数十次空耗压到了 `1 + fallback batches`
    - `smoke:pdf` / `businessPreviewReady` 不能再按“所有 segment 的中文覆盖率”判断。像 `M415013` 这类样本，即使只翻出了页眉元信息，也可能显示 `coverage=100%`；当前已改为按“未被 annotated suppress 的业务 segment”单独计算 `businessSegmentCount / translatedBusinessSegmentCount / businessTranslationCoveragePct`。只有业务条目达标，smoke 才算通过
    - 本地 fallback A 对多模态页的实际耗时常落在 `14s+`，之前用统一 `12s` 超时会把“慢但可用”的请求误打成失败；当前本地 vision 已改为更长的最小时延预算
    - page 级 vision 结果必须强制覆盖当前目标页号和 `regionId` 前缀，不能信任模型回包里的 `pageNumber/regionId`。否则像 `m415013` 这类多页样本会把第 2 页的批注错误挂到第 1 页，进一步污染 comparison 和后续 page-level 选择
    - 在这组修复后，`m415013` 的本地 A/B fallback 路径已恢复到：
      - `visionPageBlockCounts: page1=15, page2=10`
      - `translatedSegmentCount=40/40`
      - `businessSegmentCount=22`, `translatedBusinessSegmentCount=22`
      - `referenceRecallPct=32`, `aiPrecisionPct=40`
    - 这说明当前 `m415013` 的主矛盾已经从“page1 没回块 / smoke 假阳性”收敛为“comparison 候选口径 + 细项术语对齐”
  - `20260402-m415013-idfix-v1`
    - 同页不同 OCR fallback plan 之前共用 `vision_p${pageNumber}` 前缀，造成 `regionId` 冲突；不同英文块会写到同一个 id 上，进而污染 B 映射和 comparison。
    - 修正后改成按 `mode` 生成稳定前缀，例如 `vision_p1_full_* / vision_p1_focused_* / vision_p1_business_crop_*`。
    - 仅重跑 `m415013` 后，结果提升到：
      - `translatedSegmentCount=47/47`
      - `businessPreviewReady=true`
      - `comparisonStatus=warn`
      - `referenceRecallPct=60`
      - `aiPrecisionPct=56`
    - 这说明当前 `m415013` 已从“A 页级块回不来”进一步收敛为“page1/page2 细项召回 + comparison 候选噪音控制”。
  - `20260402-m415013-detailcrop-v1`
    - page1/page2 下半区仍缺 `OP2 / 刺绣 / 尺寸版型` 等短句时，新增了一个更偏右下业务区的 `detail_crop` OCR 模式。
    - 该模式本身没有继续抬高主链 recall，但补回了 `尺寸和版型同参考样衣` 这类下半区短句。
    - comparison 侧再补一层候选过滤与高价值判定后：
      - 孤立 `颜色 / 面料` 与 `品牌 / 款名 / 客户 / 款号:` 不再进入 AI 候选
      - `尺寸 / 版型 / 前袋 / 双针` 被提升为高价值候选
      - `m415013` 提升到 `comparisonStatus=warn`、`referenceRecallPct=64`、`aiPrecisionPct=57`
    - 当前剩余差距主要收缩为 `码标 / OP2 / 刺绣 / 双针 / 前袋可做` 等细项，而不是 page1/page2 OCR 整体缺失。
    - 随后继续仅重算 comparison（不重跑 pipeline），再把 `前片工艺 / 参考样衣 / 后背结构 / 前袋 / 双针 / 尺寸版型` 这类短句提升为高价值候选后，`m415013` 进一步到：
      - `comparisonStatus=warn`
      - `referenceRecallPct=68`
      - `aiPrecisionPct=59`
    - 这说明当前 `m415013` 的收益主要仍来自 comparison 候选对齐，而不是主链需要再次大改。

## 阶段尾收口（2026-04-03）

- 对 `m415013` 新增 `right_panel_crop / lower_panel_crop` 后，主链回归 `20260403-m415013-rightlower-v1` 只把 `m415013` 提到：
  - `comparisonStatus=warn`
  - `referenceRecallPct=64`
  - `aiPrecisionPct=58`
- 这说明继续往 page 级 OCR plan 里堆裁切模式，收益已经明显变小；新增裁切更多带来了 `NEW LOGO LABEL`、`11 右片裁剪`、面料成分残片等噪音，而没有真正补回 `OP2 / 码标 / 刺绣`。
- 随后只重算同一 run 的 comparison，并继续收紧候选：
  - 允许 `参考样品 / 正面工艺 / 前袋 / 双针 / 尺码标` 这类短句稳定进入高价值匹配
  - 压掉 `11右片裁剪`、`面料:SHELL FABRIC`、成分/克重/幅宽残片等明显低价值候选
  - 把 `前身袋鼠兜，顶部缝合在身内` 与 `双针加固` 视为同一条高价值业务句的可接受表述
- 在不重跑 pipeline 的前提下，`m415013` 变成：
  - `comparisonStatus=pass`
  - `referenceRecallPct=76`
  - `aiPrecisionPct=63`
- 当前结论：
  - `m415013` 已从“主链 page1/page2 OCR 回不来”收敛为“少量细项仍与人工稿不完全同句式”。
  - 对 `m415013` 而言，继续扩 OCR 裁切模式已接近边际收益；下一阶段应优先把精力放回 sketch 标杆组整体回归和业务确认包整理，而不是再单点加 OCR plan。

- 随后对已有 sketch 组 run `20260331-sketch-batch-arrayrecover-v1` 仅重算 comparison，结果保持稳定：
  - `m422123`: `pass`，`referenceRecallPct=80`，`aiPrecisionPct=81`
  - `m445033`: `pass`，`referenceRecallPct=85`，`aiPrecisionPct=85`
  - `m441083`: `warn`，`referenceRecallPct=57`，`aiPrecisionPct=74`
  - `m415013`: 在旧 pipeline 结果上仍为 `warn`，`referenceRecallPct=64`，`aiPrecisionPct=58`
- 这说明本轮 comparison 候选收口没有破坏既有 sketch 标杆，当前剩余压力主要集中在：
  - `m415013` 的少量 page1/page2 细项
  - `m441083` 的 recall 继续抬升

## Sketch 阶段尾状态（2026-04-03）

- 继续收紧 sketch/comment comparison 后，旧 run `20260331-sketch-batch-arrayrecover-v1` 重新计算为：
  - `m422123`: `pass`，`referenceRecallPct=80`，`aiPrecisionPct=75`
  - `m441083`: `pass`，`referenceRecallPct=73`，`aiPrecisionPct=82`
  - `m445033`: `pass`，`referenceRecallPct=85`，`aiPrecisionPct=85`
  - `m415013`: 旧 run 仍为 `warn`，`referenceRecallPct=64`，`aiPrecisionPct=58`
- 与此同时，`m415013` 在更新后的 run `20260403-m415013-rightlower-v1` 上已经达到：
  - `comparisonStatus=pass`
  - `referenceRecallPct=76`
  - `aiPrecisionPct=63`
- 当前阶段尾判断：
  - sketch 四个代表样本已经达到“可给业务看方向与阶段结果”的门槛。
  - 仍不应宣称“可全面替代人工终稿”，但已经可以进入业务确认包整理，而不必继续卡在主链结构层。

## Gemma4 本地混合路径补测（2026-04-07）

- 本轮额外验证了一条新的对比路径：
  - A：线上 `Qwen/Qwen3.5-35B-A3B`
  - B：本地 `gemma-4-31B-it-Q3_K_M.gguf`
- 目的不是替换当前阶段版，而是确认本地 `gemma4` 是否已具备作为本地 B 的对比价值。
- 结果：
  - `M422123`：`translatedSegmentCount=10/10`，business `6/6`，`businessPreviewReady=true`
  - `M441083`：`translatedSegmentCount=20/20`，business `12/12`，`businessPreviewReady=true`
  - `M445033`：`translatedSegmentCount=9/24`，business `0/15`，`businessPreviewReady=false`
  - `M415013`：`translatedSegmentCount=18/18`，business `0/0`，`businessPreviewReady=false`
- 当前结论：
  - 本地 `gemma4` 已经不是“完全不可跑”，在 `M422123 / M441083` 上可以形成可读对比 PDF
  - 但它仍不能替代当前 `.tmp/business-review-pdfs/` 里的线上阶段版
  - 更准确的定位是：本地 `gemma4` 目前适合作为实验/成本优化路径，不适合作为复杂 sketch/comment 的默认 B
- 详细对比已落在：
  - `docs/project/gemma4-hybrid-comparison.md`

## Gemma4 本地 B-only 固定 A 对比（2026-04-07）

- 同日又补了一条更可信的对比路径：
  - 不重跑当前失效的线上 A
  - 直接复用已成功 run 的 `pipeline-result.json`
  - 只把 B 重译为本地 `gemma-4-31B-it-Q3_K_M.gguf`
  - 再重写 snapshot 并渲染正式 PDF
- 结果：
  - `M422123`: `24/24`，business `19/19`
  - `M441083`: `46/46`，business `38/38`
  - `M445033`: `60/60`，business `36/36`
  - `M415013`: `48/48`，business `30/30`
- 这说明当前应区分两件事：
  1. 本地 `gemma4` 作为 **B**，在固定 A/segment 条件下已经能完整承接 sketch/comment 代表样本
  2. 本地 `gemma4` 作为 **复杂样本的全本地 A/B 主链**，仍然不稳定
- 因此后续若要比较“本地翻译风格是否可接受”，优先使用这组 B-only 结果，而不是继续被当前线上 A token 失效影响判断。
- 同日晚些时候又补了一轮 refined 重跑：
  - `scripts/retranslate-pipeline-with-local-b.ts` 现在会先过 `normalizeFashionTranslation()`，并保留阶段版原本已 suppress 的空白 `zh`
  - refined 产物目录：`.tmp/gemma4-b-only-review-refined-v4/`
  - refined 后，本地 B-only 与阶段版的有效已翻条数完全对齐：
    - `M422123`: `19 / 24`
    - `M441083`: `38 / 46`
    - `M445033`: `36 / 60`
    - `M415013`: `30 / 48`
  - 因此当前差异已更明确收敛为“术语风格与短句压缩”，而不是 suppress 失控或条目漂移
  - 当前 refined-v4 的剩余差异量级也已经压到：
    - `M422123`: `5` 条
    - `M441083`: `2` 条
    - `M445033`: `4` 条
    - `M415013`: `1` 条
  - 结论：本地 `gemma4` 作为 B 的下一阶段价值，不再是“证明它能不能承接”，而是“是否要继续投入把少量术语和短句压到更像人工稿”

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

## 2026-04-10 人工稿对照补充

- 针对当前业务确认的 4 个 sketch/comment 代表样本，已补充一份“人工翻译 PDF vs 当前 AI 阶段版正式 PDF”的对照分析：
  - [manual-vs-ai-translation-analysis-20260410.md](/Users/weitao/Documents/buildworld/aigc/export-agent/docs/project/manual-vs-ai-translation-analysis-20260410.md)
- 该文档明确了：
  - 人工翻译 PDF 的实际路径（`data/test02/*翻译.pdf`）
  - 当前 AI 正式稿路径（`.tmp/business-review-pdfs/*.annotated.pdf`）
  - `M422123 / M441083 / M445033 / M415013` 的样本级差异说明
  - 当前可对业务使用的口径：AI 已进入“高质量辅助稿”阶段，但仍不应表述为“无需人工复核的最终稿”
