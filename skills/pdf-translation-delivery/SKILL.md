# PDF Translation Delivery

## Purpose

把 PDF 批注/工艺页翻译能力作为可复用 skill 使用，统一产出：

- 正式 PDF / 预览入口
- 结构化人工复核建议
- 稳定 skill 结果协议 `pdf_translation_skill_v1`

## When To Use

- 需要把 PDF 翻译能力交给代理直接调用
- 需要页面、任务系统、外部代理共享同一份结果协议
- 需要给业务员或工厂提供“可直接看图 + 知道哪里要人工确认”的结果

## Input

- PDF 文件
- 任务目标
- 可选 A/B 模型配置

## Output

- `pdf_translation_skill_v1`
- 正式 PDF / 预览 / 表格产物入口
- `humanReviewGuide`

## Current Invocation Pattern

1. 通过 `/api/assistant` 发起任务
2. 得到 `taskId`
3. 读取：
   - `/api/tasks/[taskId]`
   - 或更轻的 `/api/tasks/[taskId]/skill-payload`

当前 `POST /api/tasks` 已支持 submit-then-poll：

- 提交后可能先返回 `status: validating`
- 后续通过：
  - `GET /api/tasks/[taskId]`
  - `GET /api/tasks/[taskId]/skill-payload`
 轮询结果

## Ting / CLI Invocation Pattern

当 Ting 外贸助手不直接走页面，而是通过本地命令调用时，优先使用：

1. 先启动当前服务实例（保留现有 Web/UI）
2. 再通过 CLI 壳调用同一任务服务：
   - `npm run ting:pdf-service -- submit --base-url http://127.0.0.1:3000 --stdin`
   - `npm run ting:pdf-service -- get-task --base-url http://127.0.0.1:3000 <taskId>`
   - `npm run ting:pdf-service -- get-skill-payload --base-url http://127.0.0.1:3000 <taskId>`

说明：

- CLI 只是薄壳，不重算翻译结果
- `get-skill-payload` 返回 `ting_pdf_translation_v1`
- 业务字段仍只看 `result: pdf_translation_skill_v1`
- 若 `submit` 先返回 `validating`，应继续轮询 `get-task` / `get-skill-payload`

## Ting / MCP Invocation Pattern

Ting 的 round-1 推荐形态不是直接拼 REST，也不是直接解析页面，而是：

1. 运行 export-agent 服务实例
2. 通过本地 command transport 的 MCP wrapper 调用服务
3. MCP 工具只暴露：
   - `submit_pdf_translation_task`
   - `get_pdf_translation_task`
   - `get_pdf_translation_skill_payload`

本地启动：

- `npm run ting:pdf-mcp-server`

回归验证：

- `npm run verify:ting-mcp-server`

## Stable Fields

优先消费：

- `summary`
- `artifactLinks`
- `humanReviewGuide`
- `snapshot`
- `diagnostics`

## Review Rule

如果 `humanReviewGuide` 存在：

- 优先看 `focusPages`
- 再看高优先级 `hints`
- 若 `diagnostics.businessPreviewReady !== true`，不得直接当完整终稿使用
