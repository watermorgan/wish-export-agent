# Translation Design

## Scope

本文描述当前仓库里“翻译文档处理链”的设计现状，重点覆盖：

- 输入文档抽取
- 翻译任务执行
- PDF 标注输出
- 不同文档类型的呈现策略
- 当前已知限制与后续优化方向

本文只描述当前已实现或已验证的设计，不引入未来未落地的能力假设。

## Current Goal

当前翻译链服务的核心场景是：

1. 上传英文工艺意见、sketch、tech pack、TP/BOM 类 PDF
2. 抽取可翻译文本
3. 输出中文翻译结果
4. 生成便于业务确认的 PDF 结果

当前代码没有显式按“文档类型”切两套执行器，而是主要按页面翻译项密度选择渲染模式：

1. 非密集页
- 典型特征：短句批注较少、空白较多
- 目标输出：原文附近编号 + 右侧面板或同页空白区中文说明

2. 密集页
- 典型特征：表格密集、字段多、说明短而碎
- 目标输出：原页保留定位编号，同页空白区优先放 `CN Notes`，放不下的剩余内容进入补充审阅页

## End-to-End Pipeline

当前链路分 4 层：

1. File Extraction
- 文件上传后先抽文本，不直接把原始 PDF 整份送给模型
- PDF 文本抽取主流程依赖 `pdftotext -layout`
- 目标是尽量保留行级结构、列感知和 section/segment 切分信息

2. Structured Source
- 抽取结果被整理成中间层 JSON
- 核心结构：
  - `sections`
  - `segments`
  - 每个 segment 包含 `source`
- 这样模型只处理结构化文本，不直接处理原始 PDF 字节流

3. Translation Execution
- 当前真实翻译通过统一 provider 路由执行，默认优先级最高的是 ModelScope OpenAI-compatible provider
- 模型默认按 section / chunk 分批调用，而不是整单一次性调用
- 每个 chunk 输出结构化结果，再在服务端合并

4. PDF Rendering / Overlay
- 根据结构化翻译结果回查原 PDF 中的文本位置
- 为每条可定位文本分配连续编号
- 编号显示在原文附近
- 中文翻译卡片按页面密度选择不同布局

## Key Files

当前关键实现文件：

- 输入抽取：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-source.ts`
- 翻译主链：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
- ModelScope client：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/modelscope-client.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/openai-compatible-client.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/llm/providers/modelscope.ts`
- 离线批量翻译：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/offline-feedback-translate.mjs`
- PDF 标注渲染：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/render_feedback_pdf.py`

## Extraction Strategy

### 1. Layout-Aware Text Extraction

抽取时优先保留版式信息，而不是简单把全文拼成纯文本。

当前做法：

- 读取 `pdftotext -layout` 的文本结果
- 基于文本行、空白分布和 section 标题做 `sections / segments` 切分
- 在部分 section 里做续行合并，减少被换行打断的短句碎片

这样做的原因：

- PDF 中常见断词、换行、bullet、列错位
- 直接把全文作为一个大 prompt 容易丢失结构
- 先抽成结构化 source 更利于后续 chunk 翻译

### 2. Segment Merge Rules

对于明显属于同一段但被换行打断的内容，当前会尝试合并后再翻译。

目标：

- 避免把一条完整工艺说明拆成多条零碎翻译
- 尤其针对 sketch 页面的短段落和 detail 区

例子：

- 不希望输出：
  - `Taped seams with visible contrast`
  - `tape`
- 而是合并成：
  - `Taped seams with visible contrast tape`

这套规则是 section-scoped 的通用规则，不是对单个文件名写特判。
当前主要应用在：

- `details-op1`
- `details-op2`
- `inner-shorts`

## Translation Execution Strategy

### 1. Chunked Translation

当前不会把整份文档一次性丢给模型。

原因：

- 请求太大，耗时高
- 更容易超时
- 大文档失败后难以恢复

所以当前做法是：

- 先切 section / chunk
- 每次只翻译一小批 segment
- 最后在服务端合并结果

当前默认参数：

- `FEEDBACK_SECTION_CHUNK_SIZE=12`
- `FEEDBACK_SECTION_CHUNK_CONCURRENCY=3`

### 2. Lightweight Output Schema

模型不负责重新生成整份复杂 PDF 结构。

当前原则：

- 英文原文由本地结构化数据保留
- 模型主要返回中文翻译
- 服务端负责把英文、中文、编号重新组合成 PDF 和页面结果

这样可以减少：

- 输出 token
- 格式波动
- 结构错位

### 3. Provider Selection And Short-Circuit Conditions

当前执行入口不是写死某一个模型，而是通过 `generateWithAvailableProvider()` 走 provider 路由。

默认 provider 优先级是：

1. `modelscope`
2. `codex-cli`
3. `claude-cli`
4. `gemini-cli`
5. `anthropic`

另外存在几类短路条件：

1. `ASSISTANT_FORCE_GOLDEN=1`
- 不调用真实模型，直接走 golden fixture

2. 当前任务链包含 `comment-merger`
- 当前真实翻译接入只针对 translator-only 场景
- 如果叠加 `comment-merger`，会保留原 reply，不进入这条真实翻译链

### 4. Retry / Backoff

离线脚本已经具备：

- 超时重试
- 退避重试
- 分块失败后拆小重跑

这套机制对大文档很重要，因为 TP / BOM 文档天然比 sketch 更重。

## PDF Rendering Strategy

当前 PDF 渲染的目标不是“机器替换原文”，而是“生成便于业务确认的中文辅助层”。

### Shared Rules

无论文档类型如何，当前共有规则：

1. 每条可定位翻译都有连续编号
2. 编号显示在原文附近
3. 中文翻译卡片使用相同编号
4. 编号按整份文档全局递增，不是每页重置

对于密集页分组，编号显示采用压缩规则，而不是始终单个数字：

- 连续编号：显示为 `12-18`
- 少量离散编号：显示为 `12,14,18`
- 更长的离散组：显示为 `12+4`

### 1. Non-Dense Page Mode

触发条件：

- `len(notes_for_page) <= DENSE_PAGE_NOTE_THRESHOLD`

当前策略：

1. 原页显示红色编号
2. 中文翻译优先放右侧面板
3. 卡片布局由 `fit_notes_single_page()` 在单列/双列之间自适应

这个模式通常更像 sketch / 批注图稿页的输出，但代码层面不是靠文档类型判断，而是靠页面密度判断。

### 2. Dense Page Mode

触发条件：

- `len(notes_for_page) > DENSE_PAGE_NOTE_THRESHOLD`

当前策略：

1. 先按 bbox 行聚类
2. 再按行内长度、横向距离拆成更小的组
3. 原页保留定位编号
4. 同页底部空白区优先放一批 `CN Notes`
5. 放不下的剩余组再进入 `CN Review` 补充页

这个模式通常更像 TP / BOM / 表格页的输出，但实现依然是密度驱动，而不是显式文档类型驱动。

## Dense Page Fallback Logic

当前对密集页的回退逻辑如下：

1. 先判断该页翻译项数量是否超过阈值
2. 如果是普通页：
- 走原页 + 右侧面板卡片模式
3. 如果是密集页：
- 先按行聚类
- 再按行内内容长度、横向距离继续拆分小组
- 优先尝试放入同页底部空白区
- 只有 dense overflow 的剩余组才进入 `CN Review` 附加页

这意味着当前设计不是二选一，而是：

- 同页优先
- 附加页兜底

## Matching Strategy

这一层属于 PDF 渲染/定位阶段，不属于 source 抽取主线。

当前原文定位不是靠固定模板，而是靠文本 token 与 bbox 的结合匹配。

流程：

1. 从 PDF 中提取单词和位置信息
2. 对原文 segment 做 loose tokenize
3. 在页面词流中寻找最佳 token 序列匹配
4. 命中后生成 bbox
5. bbox 用于绘制原文附近的编号

这个设计的优点：

- 不依赖某一种特定 PDF 模板
- 对 bullet、断词、列布局有更强容错
- 可以复用到别的翻译文档

## Current Strengths

当前这套设计已经具备这些优点：

1. 不再依赖整单同步翻译
2. 已支持真实 LLM 调用
3. 已支持结构化中间层
4. 已支持编号映射
5. 已支持基于页面密度的不同呈现策略
6. 已支持“同页空白区优先，附加页兜底”

## Current Limitations

当前仍有这些限制：

1. 不是精确原位批注
- 现在是“原文附近编号 + 空白区/附加页翻译”
- 不是把中文真正贴到每条英文旁边

2. 密集表格仍然会有一部分进入附加页
- 原因是单页空白区容量有限
- 尤其是字段过多的 dense page

3. 表格语义分组还不够强
- 当前是按行和横向距离聚类
- 还没有真正识别 `Fabrics / Zippers / Trims / Packaging` 等语义模块

4. 抽取质量仍受 PDF 源质量影响
- 如果 PDF 本身是扫描件或版式极乱，抽取质量会下降

5. 术语一致性仍依赖 prompt 和后处理
- 当前还没接结构化术语库

## Recommended Next Improvements

建议后续优先做这几项：

1. 表格语义分组
- 在 TP/BOM 审阅页里按 `Fabrics / Zippers / Trims / Packaging` 分区

2. 同页空白区布局优化
- 优先把最重要的组放同页
- 让补充页只保留低优先级或剩余项

3. 术语库和规则后处理
- 统一防水拉链、压胶、logo、elastic、trim 等行业术语

4. 大文档异步任务化
- 目前离线脚本已可用
- 后续应正式并入任务状态机

5. 更强的 bbox 聚类
- 在不写模板特判的前提下，提高“属于同一段”的识别质量

## Reviewer Checklist

如果让 Cursor 或其他工具 review，建议重点看这些问题：

1. 抽取层的“同段合并”规则是否足够通用
2. 页面密度阈值是否足够稳定，还是需要引入更明确的页面类型特征
3. 密集表格页的分组策略是否还能更稳
4. 同页空白区布局是否还能容纳更多高优先级翻译
5. 编号压缩显示规则是否需要继续收紧
6. 是否需要把编号系统从“全局递增”改成“页内 + 全局索引并存”
7. 是否需要引入“重要项优先上同页”的排序规则
