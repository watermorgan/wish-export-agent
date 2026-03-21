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
