# Wish Export Agent

面向非技术外贸团队的技能卡片式外贸工作台。

## 已完成骨架
- 独立 Git 仓库
- Codex bridge / memory / skills 基线
- `Next.js + PWA + Web 工作台` 前后端骨架
- 静态 `Skill Catalog + Workflow Template + Execution Plan` 底层结构
- 一个可替换的服务端 mock 编排接口，已支持待确认项和执行摘要

## 运行
```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## PostgreSQL 持久化
应用现在支持两种 PostgreSQL 配置方式：
- `DATABASE_URL=postgresql://user:password@host:port/dbname`
- `DATABASE_JDBC_URL + DATABASE_USERNAME + DATABASE_PASSWORD + DATABASE_NAME`

初始化库表：
```bash
npm run db:init
```

如果只提供了 JDBC 地址而没有库名，默认会创建并使用 `export_agent`。

## 当前目录结构
- `docs/product/`: 产品需求、架构、流程与技能编排基础文档
- `src/app/`: Next.js App Router 页面、PWA manifest、API routes
- `src/components/`: 前端工作台组件
- `src/lib/assistant/`: 智能体 mock 逻辑与输入校验
- `src/lib/channels/`: 渠道扩展层，预留 Feishu / Slack / 企微 bot 接入
- `public/`: 图标等静态资源
- `memory/`: 本地记忆、角色约束、验收基线
- `skills/`: 项目本地技能
- `docs/setup/`: 环境与 MCP 接入说明

## 当前能力
- 上传多文件
- 选择任务类型、技能卡片和模板链
- 服务端返回执行计划、中间产物、待确认项和审计摘要
- 已支持任务持久化接口、最近任务列表、提交审核、主管通过/退回、导出动作
- PWA manifest 已就位，后续可继续完善离线与安装体验
- 已预留 bot 扩展层，网页端和 Feishu 可复用同一套 agent 服务

## 当前翻译链基线

### A/B 模型拆分

当前 PDF 意见翻译链按两类模型拆分，并建议采用“本地优先、线上兜底”的低维护路由：

- A 模型：视觉/OCR/多模态辅助识别
- B 模型：结构化 segment 翻译

推荐环境变量：

```bash
A_MODEL_NAME=Gemma-4-31B-it
A_MODEL_API_URL=http://172.16.71.201:8001/v1
A_MODEL_API_KEY=

B_MODEL_NAME=Gemma-4-31B-it
B_MODEL_API_URL=http://172.16.71.201:8001/v1
B_MODEL_API_KEY=

B_MODEL_FALLBACK_NAME=openrouter/free
B_MODEL_FALLBACK_API_URL=https://openrouter.ai/api/v1
B_MODEL_FALLBACK_API_KEY=your-openrouter-key

VISION_API_KEY=...
VISION_API_URL=http://172.16.71.201:8001/v1
VISION_MODEL=Gemma-4-31B-it

TRANSLATION_API_KEY=
TRANSLATION_API_URL=http://172.16.71.201:8001/v1
TRANSLATION_MODEL=Gemma-4-31B-it
```

当前建议的底层路由：

1. A 模型：只走本地 `Gemma-4-31B-it`
2. B 模型：优先本地 `Gemma-4-31B-it`
3. 若本地 B 超时、空内容、整轮 0 翻译，则自动切 `openrouter/free`

说明：

- 当前仓库已支持私网 OpenAI-compatible 端点无鉴权直连；若无法连接 `172.16.71.201:8001`，会明确提示先连接 VPN。
- 当前建议组合：
  - A：`Gemma-4-31B-it`（本地 OpenAI-compatible）
  - B：`Gemma-4-31B-it`（本地 OpenAI-compatible）
  - B fallback：`openrouter/free`
- 这样 A 不依赖外部配额，B 只有在本地失败或空翻译时才消耗线上额度。
- 当前本地实例已经作为默认 A/B 联调入口；OpenRouter 仅保留为自动兜底补充。
- 页面里选择的 `translationModelOverride` 必须真正传递到 PDF pipeline，而不只是 UI 展示。
- 若 `qwen3.5-27b` 后续额度或稳定性不足，再切 `Qwen/Qwen3.5-397B-A17B` 或 `MiniMax/MiniMax-M2.1` 做线上验证。

### 当前 PDF 翻译输出策略

- `feedback` 的 PDF 任务优先走 `pdf-pipeline`
- 对 `sketch/comment` 类页面，优先“页内蓝色中文贴近原文”
- 稀疏页不默认显示右侧整栏 `CN Notes`
- `Unassigned Notes` 只保留为诊断能力，正式 PDF 默认不显示
- 款号、SKU、style code、纯代码类内容不作为翻译标注输出

### 当前识别优先级

当前主矛盾不是“先把模型翻得更花”，而是“先把该识别的块找全”。

- 对 `sketch_comment` 且文本层稀疏的页面，必须强制触发整页视觉识别
- 颜色、面料、辅料、拉链、按扣、工艺处理、针距、版型、批注说明优先保留
- logo、页码、版权、编辑日期、重复页头默认视为低价值噪音

## 下一步建议
1. 把 `src/lib/assistant/execution.ts` 的 mock 编排替换成真实技能执行
2. 把当前 PostgreSQL 持久化从单表快照升级成领域表结构和审计子表
3. 接入真实文件解析、知识检索和引用片段
4. 增加模板发布、版本记录和审核队列页面
5. 加入登录、团队工作台和历史记录
6. 把 `src/app/api/channels/[channel]/webhook/route.ts` 接到 Feishu 真实回调和发送器

## 产品文档
- [产品文档索引](./docs/product/README.md)

## 提示词
- [提示词包索引](./docs/prompts/README.md)
