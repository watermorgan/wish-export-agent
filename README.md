# Export Agent

外贸助手智能体项目初始化仓库。

## 当前目标
- 建立独立 Git 仓库边界
- 建立 Codex bridge / memory / skills 基线
- 提供项目级 MCP 模板，便于后续接入文档检索、文件系统和浏览器自动化

## 当前目录结构
- `memory/`: 本地记忆、角色约束、验收基线
- `skills/`: 项目本地技能
- `docs/setup/`: 环境与 MCP 接入说明
- `.codex-bridge.json`: Codex 启动装配入口
- `.mcp.json`: 项目 MCP 模板

## 推荐下一步
1. 补充产品范围：目标客户、渠道、工作流和首批工具清单
2. 选择运行时：`Node.js + TypeScript` 或 `Python`
3. 按 `skills/export-agent-bootstrap/SKILL.md` 启动 MVP 设计
4. 配置 Git remote：
   `git remote add origin <your-repo-url>`

## Git 说明
- 当前仓库已独立初始化为应用仓库
- 上层 `~/workspace` 已忽略 `apps/export-agent`
- 尚未配置远程仓库，需要你后续补上

