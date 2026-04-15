# Prompt 01: 新会话续接

```text
你现在在项目目录 `/Users/weitao/Documents/buildworld/aigc/export-agent` 下工作。

请先阅读这些文件，再继续任务：
1. `README.md`
2. `docs/product/01-prd.md`
3. `docs/product/02-architecture.md`
4. `docs/product/03-workflows.md`
5. `docs/product/04-skills-and-orchestration.md`
6. `docs/setup/channels.md`

项目背景如下：
- 这是一个内部私有部署的外贸 AI 工作台，不是开放式泛聊天机器人
- 产品形态参考统一外贸工作台模式
- 能力组织参考 CoPaw 的 workspace + skill catalog + manual composition
- V1 用户是业务员和主管
- V1 主入口是 Web 工作台，Feishu/Slack/企微等 bot 仅作为后续扩展层预留
- V1 首批技能固定为：工艺单/BOM 整理、意见翻译与归并、客户回复草拟
- 技能编排采用人工触发组合，不允许无确认的自动连续执行
- 所有价格、交期、认证、付款、物流等内容都必须显式标记为“待确认”

请先输出：
1. 你对当前项目的简短理解
2. 当前代码和文档的现状摘要
3. 你建议的下一步

不要跳过阅读，不要直接开始泛泛实现。
```
