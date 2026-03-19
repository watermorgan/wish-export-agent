---
name: export-agent-bootstrap
description: 用于启动外贸助手智能体开发，包括范围收敛、工作流拆分、工具优先级和评测基线设计。
---

# Export Agent Bootstrap Skill

## 推荐流程
1. 明确首批主链路：询盘 intake -> 客户资格 -> 报价准备 -> 跟进草拟
2. 定义业务对象：lead、inquiry、product_request、quote_readiness
3. 为每条链路定义输入、输出、工具依赖和人工接管条件
4. 先做只读工具，再做写操作
5. 为每条链路准备最小评测样本

## MCP 选择建议
- 文档检索：`context7`
- 仓库操作：`filesystem`
- 复杂设计：`sequential-thinking`
- 代码托管：`github`（可选）

## 不要做
- 一开始就接真实生产系统
- 未定义字段就开始写 prompt
- 把业务规则散落在多个提示词里且没有版本化

