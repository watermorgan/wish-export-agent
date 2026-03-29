# Feedback Translation Acceptance Report

## Scope

本报告只核对翻译相关主链路：

- 输入抽取：`feedback-source.ts`、`file-extractor.ts`
- 翻译执行：`feedback-translation.ts`
- provider / model 路由：`llm/router.ts`
- PDF 编号与渲染：`render_feedback_pdf.py`
- UI 待确认项展示：`workspace.tsx`、`globals.css`
- workflow 审核 / 导出门控：`task-store.ts`、`src/app/api/tasks/*`

说明：

- 以下结论只追踪当前真实实现缺口。
- `memory/acceptance-criteria.md` 与 `memory/execution-boundaries.md` 已按当前代码基线收口，不再把历史文档漂移作为待修问题。

## High

### 1. translator-only 与 translator+merger 并发创建任务时存在数据库死锁风险

- 验收条款要点：
  - 主链路应稳定可执行
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/app/api/assistant/route.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
  - 实测：并发向 `/api/assistant` 发两个最小 feedback 请求时出现 `deadlock detected`
- 说明：
  - 当前翻译链本身可以执行，但在并发创建任务时，数据库写入路径仍有锁竞争风险
- 已落地缓解（需在新环境复测）：
  - `task-store.ts`：任务级 `pg_advisory_xact_lock(hashtext(task_id))`，同任务串行写
  - `db.ts`：`ensureTaskSchema()` **singleflight**，避免冷启动多请求并行跑同一套 DDL/迁移互相卡住（表现为 `/api/assistant` 长时间无响应）
  - `db.ts`：连接池 `max` / `connectionTimeoutMillis` 可配（`.env.example` 中 `PG_POOL_MAX`、`PG_CONNECTION_TIMEOUT_MS`）
- 最小修订建议：
  - 继续观察是否仍有 `deadlock detected`；若有，再统一跨任务子表 `DELETE/INSERT` 顺序或改为 upsert

### 2. 当前任务写库仍采用“全量删子表再重建”策略，放大并发锁竞争

- 验收条款要点：
  - 翻译主链路在并发场景下应保持可重复执行与可恢复
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
  - 函数：`replaceTaskChildren()`
- 说明：
  - 当前每次任务更新都会先 `DELETE` 再 `INSERT` 多张子表
  - 在翻译执行较慢、并发任务较多时，这种“全量替换”会扩大锁持有时间和互锁概率
- 最小修订建议：
  - 任务级 advisory lock 已加；下一步如需继续降锁持有时间，可评估子表 upsert / 差量更新

## Medium

### 3. `sketch/comment` 页的主要缺口仍是识别召回，而不是单纯翻译质量

- 验收条款要点：
  - 该翻译的业务块应先进入结构化结果，再谈翻译质量
- 当前实现状态：部分满足，但已定位核心根因
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/vision-extraction.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/translation-pipeline.ts`
  - 样本：`M422123.pdf`
- 说明：
  - `Page 1` 的颜色、面料、工艺块之前大面积缺失，不是视觉模型没看到，而是视觉 JSON 因 `finish_reason=length` 被截断，旧逻辑整页丢弃
  - 当前已加入：业务价值优先、返回数量约束、JSON 截断容错
- 最小修订建议：
  - 继续验证这些新块进入 B 模型翻译后的最终业务 PDF
  - 以 Page 1 的颜色/面料/工艺块是否完整进入结果作为阶段门槛
### 4. “无法确定”已开始做后处理，但模型解析失败时仍会整体回退

- 验收条款要点：
  - “无法确定”应进入等待人工确认路径，而不是直接报错
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - 函数：`safeParseSectionModelResponse()`、`maybeRunRealFeedbackTranslation()`
- 说明：
  - 当前已对“无法确定 / not sure / to be confirmed”做规则型 pending 映射
  - 但模型解析失败时仍会整体回退到 fixture，而不是进入更细的等待确认状态
- 最小修订建议：
  - 保留现有规则
  - 后续补“解析失败 -> 待人工确认”的细粒度降级路径

### 5. 当前翻译工作台首屏暴露过多系统概念，业务路径不够直接

- 验收条款要点：
  - 业务员上传文件后应能快速理解“下一步做什么”
  - 翻译主链路不应要求业务员先理解角色 / 模板 / 技能 / 链路编排
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/components/workspace.tsx`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/docs/project/plan.md`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/docs/project/translation-design.md`
- 说明：
  - 当前首页同时暴露角色、任务类型、模板、技能
  - 这些概念适合系统配置和高级操作，不适合业务员首屏主流程
  - 上传后的下一步动作和当前阶段也不够明确
- 最小修订建议：
  - 默认首页收口成单场景翻译入口
  - 把角色 / 模板 / 技能移入“高级设置”
  - 上传后显式提示下一步和当前阶段

### 6. 翻译结果主入口不够突出，页面内仍缺少“打开/下载结果”一级动作

- 验收条款要点：
  - 业务员应能快速定位翻译结果
  - 翻译 PDF 生成后，应能在页面中直接打开或下载
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/components/workspace.tsx`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/app/api/tasks/[taskId]/export/route.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
- 说明：
  - 当前页面能展示翻译内容，但结果区不是“翻译优先”
  - 当前导出动作只返回 JSON / `finalArtifact` 文本，并没有页面内的 PDF 打开或下载入口
- 最小修订建议：
  - 结果区顶部固定“翻译结果”模块
  - 增加“页面查看 / 打开翻译结果 / 下载翻译 PDF”入口

### 7. dense 页同页展示能力已存在，但无法保证所有高价值项都留在原页

- 验收条款要点：
  - 翻译结果应尽量便于业务确认与推进
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/render_feedback_pdf.py`
  - 函数：`fit_dense_inline_rows()`、`create_dense_inline_overlay()`、`create_dense_review_pages()`
- 说明：
  - 当前已经支持“同页空白区优先，剩余下沉 review 页”
  - 但密集 TP/BOM 页仍可能有重要项下沉到补充页
- 最小修订建议：
  - 为 dense row 增加更强的业务优先级排序
  - 例如优先 `fabric / zipper / logo / seam / trim`，再放数字和单位类行
  - 若业务确认“原页不可被覆写”，则正式 PDF 应改成 marker + review 页优先，而不是继续压 inline 中文块

### 8. `test02` 的 sketch/comment 验收已不再以“是否逐字相同”为准，而应以“语义对、术语像、样式稳”为准

- 验收条款要点：
  - 识别和翻译效果要接近人工稿，而不是机械追求逐字一致
- 当前实现状态：部分满足，且收敛方向已验证有效
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/lib/test02-harness.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/translation-pipeline.ts`
  - 样本：
    - `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260328-calibrate-m422123-v2/`
    - `/Users/weitao/Documents/buildworld/aigc/export-agent/data/test02/runs/20260329-m445033-online-v2/`
- 说明：
  - `m422123`、`m445033` 已证明：通过短标签归一、材料/里布/填充短句模板化、meta 噪音降级，可以把 sketch/comment 样本从“看起来像漏翻”收敛到接近人工稿
  - 尤其 `m445033` 已从 `fail` 提升到 `pass`，指标达到 `referenceRecallPct=88`、`aiPrecisionPct=68`
  - 因此当前剩余样本若未通过，优先排查：
    - 是否被长说明拉低 comparison
    - 是否把 header / context / admin 信息当成业务候选
    - 是否缺少颜色/面料/里布/填充/五金类短句归一
  - `mixed` 样本这轮进一步确认：
    - 人工稿经常把一个业务块拆成 2 到 3 行中文短句，因此 comparison 需要允许参考侧相邻短句合并
    - AI 侧则只应按明确多列/多块拆分；若把逗号短句和规格残片过度拆分，会显著拉低 precision
    - `m4e002` 在该口径下已从 `referenceRecallPct=38 / aiPrecisionPct=29` 提升到 `63 / 35`，说明主问题已经从“识别不到”收敛为“Page 2/5 结构批注和 mixed 噪音控制还不够像人工稿”
- 最小修订建议：
  - 保持“线上优先，本地 B 兜底”的样本推进方式
  - 对未过线样本继续补术语表、短句模板和 comparison canonicalization
  - 等 `ata019 / hanna / m4e002` 这类剩余样本也达线后，再宣称全集通过

### 9. 正式 PDF 已新增“安全渲染”约束：不得因中文标注遮挡原稿细节

- 验收条款要点：
  - 服装图细节、英文批注、尺码框信息必须保持可读
- 当前实现状态：已收敛到更安全的默认策略
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/render_feedback_pdf.py`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/translation-pipeline.ts`
- 说明：
  - 默认不再对非 dense 页直接铺浮动蓝字，而是用小号 marker + 右侧说明栏
  - dense 页默认改为 marker + review 页，避免底部 inline 区覆盖原页
  - `FITTING / VOLUME`、`SIZE ... BASE ...`、`common designated size` 等误导性尺码框已从正式 annotated 输出剔除

### 8. `needsHumanReview` 当前只提供 camelCase；若未来需要对外兼容 snake_case，仍需显式映射

- 验收条款要点：
  - 输出 schema 应保持稳定
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/types.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/execution.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
- 说明：
  - 当前仓库内部已经统一使用 `metadata.needsHumanReview`
  - 这对仓库内 UI/API 足够，但若后续要面向外部兼容 snake_case，需要单独序列化映射
- 最小修订建议：
  - 维持内部 camelCase 不变
  - 仅在外部协议层按需增加兼容字段

## Low

### 9. 抽取层的“同段合并”是 section-scoped，不是全局通用

- 验收条款要点：
  - 翻译应尽量按自然段或完整工艺语义输出
- 当前实现状态：部分满足
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-source.ts`
  - 函数：`consolidateSectionSegments()`
- 说明：
  - 当前合并规则主要作用于 `details-op1 / details-op2 / inner-shorts`
  - 对其他 section 没有同等强度的续行合并
- 最小修订建议：
  - 逐步把合并规则从 section 特例扩成更稳定的段落启发式

### 10. PDF 渲染模式的真实依据是页面密度，不是显式文档类型

- 验收条款要点：
  - 输出应针对不同文档形态可读
- 当前实现状态：OK，但文档表述需收口
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/render_feedback_pdf.py`
  - 常量：`DENSE_PAGE_NOTE_THRESHOLD`
- 说明：
  - 当前实现按 `len(notes_for_page) > DENSE_PAGE_NOTE_THRESHOLD` 分流
  - 实际效果上常常对应 sketch vs TP/BOM，但代码不是按文档类型显式切换
- 最小修订建议：
  - 保持实现不变
  - 只修文档表述，避免把“密度驱动”写成“文档类型驱动”

## Confirmed Passes

### 1. 分块翻译与 provider 路由已实现

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/llm/router.ts`
- 说明：
  - 当前已支持 section / chunk 分批调用
  - provider 顺序可配置，默认优先 `modelscope`

### 2. 当前 memory / bridge 约束已对齐到真实实现

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/.codex-bridge.json`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/memory/acceptance-criteria.md`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/memory/execution-boundaries.md`
- 说明：
  - 当前 bridge 只映射现存的 `execution-boundaries.md`
  - 验收基线已统一为真实状态机、确认项模型和 metadata 命名

### 3. 提交审核与导出门控已正确收口

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/app/api/tasks/[taskId]/submit/route.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/app/api/tasks/[taskId]/export/route.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
- 说明：
  - `required` / `returned` 待确认项未清空时不能提交审核
  - 只有 `approved` 后才能导出

### 4. PDF 编号与 dense overflow 策略已落地

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/scripts/render_feedback_pdf.py`
- 说明：
  - 编号全局递增
  - dense 页已支持同页空白区优先 + overflow review 页兜底

### 5. A/B 模型拆分与 PDF pipeline-first 已落地

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/qwen-client.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/translation-pipeline.ts`
- 说明：
  - A 模型负责视觉/OCR补强
  - B 模型负责结构化 segment 翻译
  - PDF feedback 任务默认优先走 `pdf-pipeline`
  - 页面所选 `translationModelOverride` 已开始真实传递到 pipeline
### 6. `comment-translator + comment-merger` 组合链已可触发真实翻译

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - 函数：`maybeRunRealFeedbackTranslation()`
  - 实测：`selectedSkillIds=["comment-translator","comment-merger"]` 的最小请求已返回真实翻译结果和 provider metadata
- 说明：
  - 当前真实翻译不再因为 `comment-merger` 存在而整体短路
  - merger 仍未变成真实第二阶段，但 translator 已能稳定前移执行

### 7. `metadata.needsHumanReview` 与规则型 pending 兜底已落地

- 实现状态：OK
- 证据落点：
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/types.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/execution.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/feedback-translation.ts`
  - `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
- 说明：
  - reply 已带 `metadata.needsHumanReview`
  - 已加入价格/交期/认证/付款/物流与“无法确定”规则型 pending 兜底

## Recommended Fix Order

1. 先修翻译主链真实缺口：
- 数据库并发写入死锁
- 解析失败时的细粒度等待确认降级

2. 再做协议与可读性优化：
- 视外部集成需要决定是否补 `needs_human_review` snake_case 映射
- dense 页高价值项优先
- 更强的 section / paragraph 合并启发式
