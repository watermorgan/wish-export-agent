# Prompt 04: 技能设计

```text
请为这个项目设计外贸任务技能体系。

先阅读：
- `docs/product/01-prd.md`
- `docs/product/02-architecture.md`
- `docs/product/04-skills-and-orchestration.md`
- `skills/export-agent-bootstrap/SKILL.md`
- `skills/foreign-trade-domain/SKILL.md`

设计原则：
- 技能是最小业务能力单元
- 技能必须有清晰输入、输出和人工确认点
- 技能可以组合，但 V1 不允许无人工确认的自动串行执行
- 主管负责发布技能和模板，业务员负责调用

请输出：
1. V1 技能清单
2. 每个技能的 SkillDefinition 草案
3. 推荐技能链
4. 每个技能的高风险字段和阻断条件
5. 后续可扩展但不进入 V1 的技能列表

优先围绕这三类任务：
- 工艺单/BOM 整理
- 意见翻译与归并
- 客户回复草拟
```
