# 外贸助手产品文档索引

本文档集用于定义外贸助手 V1 的前期需求、架构、流程与技能编排基线，供后续页面设计、后端拆分、智能体编排和 bot 扩展开发直接引用。

## 文档列表
- [`01-prd.md`](./01-prd.md)
  产品需求文档，定义目标、角色、范围、成功标准和首批业务链路。
- [`02-architecture.md`](./02-architecture.md)
  系统架构文档，定义分层、对象模型、接口边界和安全策略。
- [`03-workflows.md`](./03-workflows.md)
  业务与系统流程文档，定义执行路径、人工确认、主管审核和审计沉淀。
- [`04-skills-and-orchestration.md`](./04-skills-and-orchestration.md)
  技能目录与组合规则文档，定义技能卡片、模板链路和编排边界。
- [`05-v1-functional-requirements.md`](./05-v1-functional-requirements.md)
  V1 功能需求细化文档，定义页面级能力、状态流转、异常回退和验收标准。
- [`06-page-and-state-spec.md`](./06-page-and-state-spec.md)
  V1 页面与状态规格文档，定义页面信息架构、状态机、关键字段和角色操作边界。
- [`07-ai-disclosure-policy.md`](./07-ai-disclosure-policy.md)
  AI 披露政策，定义 payload 字段、PDF/xlsx/UI 渲染层、开关与豁免条件，对应代码常量在 `src/lib/assistant/disclosure.ts`。

## 当前产品基线
- 产品形态：内部私有部署的 Web 工作台
- 用户角色：业务员、主管
- 能力组织：技能目录 + 人工触发组合
- 首批技能：工艺单/BOM 整理、意见翻译与归并、客户回复草拟
- 扩展方向：后续接 Feishu、Slack、企微等渠道，但不纳入 V1 交付范围

## 使用方式
- 做页面信息架构时，优先读取 `01-prd.md` 和 `03-workflows.md`
- 做服务端模块拆分时，优先读取 `02-architecture.md`
- 做技能中心、执行链路和后续 bot 接入时，优先读取 `04-skills-and-orchestration.md`
- 做页面设计、接口拆分和验收清单时，优先读取 `05-v1-functional-requirements.md`
- 做页面设计和任务状态流转时，优先读取 `06-page-and-state-spec.md`
