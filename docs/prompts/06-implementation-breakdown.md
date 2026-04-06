# Prompt 06: 开发任务拆解

```text
请把当前项目拆成可执行的开发任务。

先阅读：
- `docs/product/01-prd.md`
- `docs/product/02-architecture.md`
- `docs/product/03-workflows.md`
- `docs/product/04-skills-and-orchestration.md`
- `src/` 下现有代码结构

要求：
- 只拆 V1 范围
- 优先支持 Web 工作台
- 不先做真实 Feishu bot 集成，只保留扩展接口
- 拆解结果要能直接进入开发排期

请输出：
1. 按里程碑拆解任务
2. 每个任务的目标、输入、产出、依赖
3. 哪些任务先做页面，哪些先做服务端，哪些先做技能与解析
4. 测试与验收建议

优先给出从当前仓库状态继续推进的顺序，而不是从零开始的理想顺序。
```
