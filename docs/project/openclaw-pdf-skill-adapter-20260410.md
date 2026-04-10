# OpenClaw PDF Skill Adapter（最小接入说明）

更新时间：2026-04-10

## 目的

让 OpenClaw 或其他外部代理在不理解完整 `AssistantReply` 内部结构的前提下，直接消费 PDF 翻译结果。

## 当前最小入口

- 先通过现有 `/api/assistant` 或任务详情链路得到 `taskId`
- 再调用：

`GET /api/tasks/[taskId]/skill-payload`

仓库内也已补出项目本地 skill 说明：

- `skills/pdf-translation-delivery/SKILL.md`

## 当前返回结构

返回对象：

- `kind = openclaw_pdf_translation_v1`
- `task`
- `result`

其中 `result` 直接承载稳定结果协议 `pdf_translation_skill_v1`。

## `pdf_translation_skill_v1` 当前关键字段

- `summary`
- `reviewRequired`
- `artifactLinks`
- `humanReviewGuide`
- `snapshot`
- `diagnostics`

## 外部代理推荐用法

1. 用 `summary` 做任务完成摘要
2. 用 `artifactLinks` 作为正式 PDF / 预览 / 表格产物入口
3. 用 `humanReviewGuide` 指导人工复核
4. 用 `diagnostics.businessPreviewReady` 判断是否适合直接给业务预览

## 当前边界

- 这只是最小 adapter，不负责重新执行翻译
- 它只暴露当前任务已经产生的稳定主链结果
- 若当前任务未生成 `pdf_translation_skill_v1`，接口返回 `409`

## 后续可扩展项

- skill 直接触发任务执行的创建入口
- OpenClaw 专用 prompt / manifest 映射
- 按业务场景裁剪字段视图
