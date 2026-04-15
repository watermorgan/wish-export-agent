# Ting PDF Skill Adapter（最小接入说明）

更新时间：2026-04-10

## 目的

让 Ting 外贸助手或其他外部代理在不理解完整 `AssistantReply` 内部结构的前提下，直接消费 PDF 翻译结果。

## 当前最小入口

- 先通过现有 `/api/assistant` 或任务详情链路得到 `taskId`
- 再调用：

`GET /api/tasks/[taskId]/skill-payload`

当前仓库也已补出一个面向 Ting/CLI 的薄壳调用面：

`npm run ting:pdf-service -- <command>`

当前仓库也已补出一个面向 Ting 外贸助手的 round-1 MCP server：

`npm run ting:pdf-mcp-server`

仓库内也已补出项目本地 skill 说明：

- `skills/pdf-translation-delivery/SKILL.md`

## 当前返回结构

返回对象：

- `kind = ting_pdf_translation_v1`
- `task`
- `result`

其中 `result` 直接承载稳定结果协议 `pdf_translation_skill_v1`。

## `pdf_translation_skill_v1` 当前关键字段

- `summary`
- `reviewRequired`
- `deliveryPdfUrl`
- `artifactLinks`
- `humanReviewGuide`
- `snapshot`
- `diagnostics`

## 外部代理推荐用法

1. 用 `summary` 做任务完成摘要
2. 只用 `deliveryPdfUrl` 作为最终交付 PDF 入口
3. `artifactLinks` 仅作为预览 / xlsx / 降级排查入口，不再让外部代理自行挑选最终 PDF
4. 用 `humanReviewGuide` 指导人工复核
5. 用 `diagnostics.businessPreviewReady` 判断是否适合直接给业务预览

## CLI 服务面（推荐给 Ting 本地代理）

推荐顺序：

1. 启动当前仓库服务实例
2. 再通过 CLI 壳调用同一 task service

当前命令：

- `npm run ting:pdf-service -- submit --base-url http://127.0.0.1:3000 --stdin`
- `npm run ting:pdf-service -- get-task --base-url http://127.0.0.1:3000 <taskId>`
- `npm run ting:pdf-service -- get-skill-payload --base-url http://127.0.0.1:3000 <taskId>`

当前 `/api/tasks` / CLI submit 语义：

- submit 不再保证同步等到翻译完成
- 对真实翻译任务，可能先返回 `status: validating`
- 后续通过 `get-task` / `get-skill-payload` 轮询

当前验证：

- `npm run verify:ting-service-cli`
- `npm run verify:ting-skill-payload`

## MCP 服务面（推荐给 Ting 外贸助手）

round-1 MCP 形态：

- transport：local command
- backend：只走已运行的 export-agent 服务实例
- 业务协议：仍然只看 `result: pdf_translation_skill_v1`

当前工具：

- `submit_pdf_translation_task`
- `get_pdf_translation_task`
- `get_pdf_translation_skill_payload`

当前推荐轮询语义：

1. 先 `submit_pdf_translation_task`
2. 若返回 `status: validating`
3. 继续轮询：
   - `get_pdf_translation_task`
   - `get_pdf_translation_skill_payload`
4. 直到拿到可消费的最终结果或明确错误

当前验证：

- `npm run verify:ting-mcp-server`

## 当前边界

- 这只是最小 adapter，不负责重新执行翻译
- 它只暴露当前任务已经产生的稳定主链结果
- 当前 canonical 最终交付字段为 `result.deliveryPdfUrl`，值等于原文档标注式翻译 PDF 下载地址
- 若当前任务未生成 `pdf_translation_skill_v1`，接口返回 `409`
- CLI 薄壳优先面向已运行的服务实例（`--base-url`），避免跨进程内存态漂移
- MCP wrapper 同样必须面向已运行的服务实例，不允许直接 import/export-agent 内部 task service 形成第二执行路径

## 后续可扩展项

- skill 直接触发任务执行的创建入口
- Ting 专用 prompt / manifest 映射
- 按业务场景裁剪字段视图
