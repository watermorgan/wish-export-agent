# Prompt 07: Feishu / Bot 扩展规划

```text
请为当前项目规划 Feishu 等 bot 渠道扩展方案，但不要把它纳入 V1 交付。

先阅读：
- `docs/product/02-architecture.md`
- `docs/setup/channels.md`
- `src/lib/channels/`
- `src/lib/assistant/service.ts`

要求：
- Web 工作台仍然是主入口
- bot 入口只作为后续扩展层
- 渠道层只做协议转换，不承载业务规则
- 所有渠道都复用同一套核心 agent 服务

请输出：
1. Feishu bot 的接入目标
2. 当前代码中已经预留了什么
3. 还缺哪些模块
4. Feishu webhook、鉴权、异步发送、消息格式化的建议设计
5. 如何保证与 Web 工作台共用核心能力而不耦合协议

重点说明哪些能力现在只应作为“预留扩展”，不应提前实现。
```
