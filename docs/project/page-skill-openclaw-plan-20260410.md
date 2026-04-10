# 页面化 / Skill 化 / OpenClaw 接入计划

更新时间：2026-04-10

## 总体判断

- 当前 PDF 翻译能力的主链已经足够清晰，适合进入“产品化封装”阶段，而不是继续只做算法试验。
- 下一阶段不应该再把重点放在“再造一个新链路”，而是要把已有的 `pdf-pipeline + snapshot + render` 能力包装成：
  - 更简单的页面工作流
  - 更稳定的 skill 能力单元
  - 可被 OpenClaw 代理直接调用的适配层
- 当前最重要的优先级不是“更多模型切换”，而是：
  1. 用户一眼知道该怎么操作
  2. 翻译结果一眼知道哪里可信、哪里需要 HITL
  3. 中文结果在原文附近可直接使用
- 回归方面，当前已经有一条可复用的 deterministic full-link 基线，后续应先守住这条线，再慢慢补真实模型回归。

## Principles

1. **业务入口优先于模型入口**
- 页面先让用户选“做什么”，再选“用什么模型”。

2. **翻译结果优先可用，不追求一步到位完美**
- 高价值业务块必须先稳定出现；细项可通过 HITL 补齐。

3. **页面化与 skill 化共用同一套主链**
- 不能页面一套逻辑、OpenClaw skill 一套逻辑。

4. **HITL 必须成为产品特性，而不是补丁**
- 模型不准时，系统必须能明确告诉用户“哪里要人工看”。

5. **回归先保底，再扩真机**
- 先守住 golden / deterministic 基线，再逐步扩大真实模型回归覆盖。

## Decision Drivers

1. 当前 V1 已明确要求 human-in-the-loop 和手动技能组合，不允许无确认自动串行。
2. 当前 PDF 正式稿能力已经具备可展示、可比对、可导出的基础，不应再只停留在测试脚本层。
3. OpenClaw 接入的关键不是重新实现模型能力，而是稳定复用现有 skill 与 workflow 资产。

## Viable Options

### 方案 A：先做页面化，再做 skill/OpenClaw 适配

优点：
- 用户可见价值最快
- 页面交互、状态、HITL 提示能先收敛

缺点：
- 容易把页面逻辑做厚，后面 skill 化时再拆一遍

### 方案 B：先做 skill/OpenClaw 适配，再做页面化

优点：
- 能力边界更干净
- 便于长期复用

缺点：
- 用户现在看不到明显进展
- 业务反馈难以快速进入产品闭环

### 方案 C：以“统一任务协议”为核心，同时推进页面壳和 skill 壳

优点：
- 页面和 OpenClaw 都消费同一个任务协议
- 后续不会出现两套入口、两套状态、两套产物定义
- 最符合当前仓库已经有 `catalog + workspace + execution + pdf-pipeline` 的现实

缺点：
- 前期需要多做一点边界整理

## Chosen Direction

选择 **方案 C**。

原因：
- 当前代码已经不是从零开始，`workspace.tsx`、`catalog.ts`、`execution.ts`、`pdf-pipeline`、`translation-pdf` 都已存在。
- 如果只做页面，会把 OpenClaw 接入推迟到后面再补，最终容易形成并行能力层。
- 如果只做 skill，会让用户端没有“低门槛页面化入口”，违背当前业务诉求。

## ADR

### Decision

以统一任务协议为核心，同时推进页面化壳层和 skill/OpenClaw 适配层。

### Drivers

- 当前能力已经足够产品化
- 页面与 skill 资产已具雏形
- 需要兼顾业务易用性与后续代理可接入性

### Alternatives Considered

- 先页面后 skill：短期快，但后期会返工
- 先 skill 后页面：结构干净，但业务反馈闭环慢

### Why Chosen

方案 C 最能复用现有代码，不需要再造平行能力层，并且能把“HITL + PDF 正式稿 + skill 输出”统一起来。

### Consequences

- 需要先收一个统一的任务协议与页面态机
- 需要给 OpenClaw 增加轻适配，而不是直接暴露内部实现细节
- 回归要同时覆盖页面入口与 skill 入口

### Follow-ups

- 页面入口简化
- HITL 建议结构化
- skill 打包协议
- OpenClaw 接入验证

## 当前测试基线

### 已有正向基线

- deterministic full-link 回归：
  - [final-verification.json](/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260408-fixture-full-v5/reports/final-verification.json)
  - 当前已知通过项：
    - `lint`
    - `build`
    - `eval:test02`
    - `compare:test02`
    - `verify:test02:ui`

### 已有业务基线

- 当前 4 个代表样本的人工作对照已经齐备：
  - [manual-vs-ai-translation-analysis-20260410.md](/Users/weitao/Documents/buildworld/aigc/export-agent/docs/project/manual-vs-ai-translation-analysis-20260410.md)
- 正式 PDF 已支持：
  - 基于 snapshot 重渲
  - 近场空白区中文说明优先
  - 工厂可直接对照阅读

### 当前风险

- 工作区有较多未提交改动，说明下一阶段必须分里程碑切，不能再大包推进。
- 真实模型环境仍可能抖动，不适合作为唯一 gate。

## 分阶段实施计划

### 阶段 1：页面壳收口

目标：
- 把当前 Workspace 收成一个“业务员能直接上手”的 PDF 翻译工作台。

必须交付：
- 业务场景主入口默认直达 `批注翻译给版房`
- 上传 PDF 后，页面明确展示：
  - 当前使用的翻译链
  - 当前模型
  - 当前是否需要人工确认
  - 当前正式 PDF / 预览 / 对比稿下载入口
- 页面里直接显示 HITL 建议区：
  - 高风险术语
  - 可能未对齐的细项
  - 建议人工重点复核页

验收：
- 新用户不看文档也能在 1 分钟内完成一次 PDF 翻译并找到正式稿
- `verify:ui` 与 `verify:test02:ui` 继续通过

### 阶段 2：把“翻译质量 + HITL”做成产品能力

目标：
- 页面和 skill 输出都能告诉用户“哪里已足够可信、哪里建议人工确认”。

必须交付：
- 结构化 HITL 建议字段，例如：
  - `highRiskTerms`
  - `likelyUnmatchedDetails`
  - `manualReviewFocusPages`
  - `confidenceSummary`
- 页面中把这部分做成“人工复核建议”卡片
- 对 `sketch/comment` 代表样本至少输出可解释的建议，不只是分数

验收：
- `M415013` 这类样本能明确指出 `码标 / OP2 / 刺绣 / 顺色` 一类风险点
- 用户无需看 comparison 原始文件，也知道该复核哪里

### 阶段 3：skill 化收口

目标：
- 让当前 PDF 翻译能力成为一个稳定 skill，而不是只能通过页面触发。

必须交付：
- 明确 skill 输入：
  - PDF 文件
  - 可选模型配置
  - 输出模式（仅预览 / 正式稿 / 含 HITL）
- 明确 skill 输出：
  - snapshot
  - annotated PDF
  - review hints
  - artifacts links / metadata
- 与现有 `catalog.ts` 对齐，避免页面和 skill 各自定义字段

验收：
- skill 可以在不经过页面点击的情况下，从统一任务协议直接跑通
- 页面和 skill 的输出字段一致

### 阶段 4：OpenClaw 适配

目标：
- 能把这套 PDF 翻译能力导入 OpenClaw 代理直接使用。

必须交付：
- OpenClaw 所需 skill manifest / prompt / adapter mapping
- 将现有 `comment-translator` 链路包装成 OpenClaw 可调用能力
- 明确哪些字段是 OpenClaw 面向外部的稳定接口

验收：
- OpenClaw 能触发一次真实 PDF 任务
- 返回结构与本仓库页面工作台一致，不需要额外人工解释

## 回归策略

### 必跑

1. `npx tsc --noEmit`
2. `npm run build`
3. `npm run verify:ui`
4. `npm run verify:test02 -- <runId> data/test02/manifest.json`

### 阶段性人工抽检

- `M422123`
- `M441083`
- `M445033`
- `M415013`

重点看：
- 翻译内容是否足够准确
- 不准时是否能给出 HITL 建议
- 中文是否尽量靠近原英文留白位置

### 暂不作为强 gate

- 真实模型全量回归
- mixed / 大 TP 全集业务放行

原因：
- 当前核心目标是把能力产品化和页面化，而不是一次性宣称“所有 PDF 全部稳定”

## RALPH / TEAM 执行建议

### Available Agent Types Roster

- `main rollout`
- `explorer`
- `worker`

### Ralph Lane

适合：
- 单主线连续收口
- 页面和任务协议边改边验

建议分配：
- 主实现：`main rollout`
- 代码探索/定位：`explorer`
- 局部实现或文档整理：`worker`

建议 reasoning：
- 主实现：`high`
- 探索：`medium`
- 文档/脚本：`medium`

### Team Lane

适合：
- 页面壳、skill 壳、OpenClaw adapter 可并行拆分时

建议拆 3 条 lane：
1. 页面与交互 lane
2. skill / 协议 / execution lane
3. 回归与验证 lane

建议验证路径：
- lane 内局部验证
- 汇总后跑 `tsc + build + verify:ui + verify:test02`

### Launch Hints

- Ralph：
  - `$ralph 先收页面化和 HITL 输出，再做 skill 统一协议`
- Team：
  - `$team 页面壳、skill 协议、回归验证并行推进`

## 下一步建议

第一优先级：
- 先做 **阶段 1 + 阶段 2**
- 也就是：页面真正收口 + HITL 建议结构化

原因：
- 这是业务最先能直接感知和使用的能力
- 也是后续 skill/OpenClaw 最好复用的数据层

一句话：

> 先把“用户能简单用、知道哪里准、知道哪里要人工看、正式稿能直接给工厂看”这件事做成产品；  
> 再把这套产品能力 skill 化并导入 OpenClaw。

## 当前执行进展（2026-04-10）

这轮已经先落下第一版页面与 HITL 共用数据层：

- 工作台右侧结果区已新增“人工复核建议”卡片
- 该卡片直接消费 `metadata.humanReviewGuide`
- `humanReviewGuide` 当前由 PDF pipeline 主链结果生成，不依赖 comparison 文件
- PDF 主链已开始同时输出 `pdf_translation_skill_v1`

这意味着：

1. 页面层已经开始具备业务导向的“先看哪里、为什么看”能力。
2. 后续 skill / OpenClaw 接入时，可以直接复用 `humanReviewGuide` 与 `pdf_translation_skill_v1`，不需要再重造一套 HITL 话术或产物字段。
3. 当前已经补出最小任务级 adapter：`/api/tasks/[taskId]/skill-payload`，后续 OpenClaw 可先从这里接，不必直接解析整份 `AssistantReply`。
