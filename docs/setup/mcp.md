# MCP Bootstrap

本仓库提供了项目级 `.mcp.json` 模板，用于收敛外贸助手研发阶段最常用的 MCP。

## 推荐启用
- `context7`: 查 SDK、框架和工具文档
- `filesystem`: 将访问范围限制在本仓库
- `sequential-thinking`: 用于复杂工作流与 prompt 编排
- `github`: 可选，用于 PR / issue，同步前先补 PAT

## 当前环境说明
- 你的全局 Codex 已启用 `playwright` 和 `obsidian`
- 本仓库不直接改写 `~/.codex/config.toml`
- 如果你的运行器支持项目级 MCP，可直接读取 `.mcp.json`
- 如果只支持全局 MCP，请把 `.mcp.json` 中需要的条目合并到你的全局配置

## 建议
- MCP 总数控制在 4 个左右，避免上下文噪音
- 涉及密钥的服务只保留占位符，不要提交真实值
- 对外部 CRM、邮件、ERP 的接入，先从只读工具开始

