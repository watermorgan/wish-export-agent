# Channel Extension Layer

当前仓库已经把“页面入口”和“机器人入口”拆开，后续接 Feishu、Slack、企微时不需要改核心 agent 逻辑。

## 当前结构
- `src/lib/assistant/service.ts`
  统一的 agent 服务入口。网页端和 bot 渠道都走这里。
- `src/lib/channels/types.ts`
  渠道标准化对象，包括入站消息、挑战请求和渠道响应。
- `src/lib/channels/adapters/`
  每个渠道各自做协议适配，目前内置：
  - `web`
  - `feishu`
- `src/app/api/channels/[channel]/webhook/route.ts`
  统一 bot webhook 入口。

## 当前 Feishu 预留能力
- 支持 `url_verification` 挑战响应
- 支持解析 `im.message.receive_v1` 文本消息
- 支持把消息标准化成统一 agent 请求
- 支持输出 Feishu 文本消息预览

## 还没做的部分
- Feishu 签名校验
- 调用 Feishu 发消息 API 的真实发送器
- 图片、文件、卡片消息
- 群聊 @ 机器人、消息去重、重试和异步任务

## 建议接入方式
1. 保持 webhook 路由只做鉴权、解析和快速 ack
2. 把真实发消息与耗时任务放到异步 worker
3. 渠道层只负责协议转换，不承载业务规则
4. `runAssistant()` 只处理统一业务输入输出

## 参考项目
- Lark/Feishu 官方 Node SDK：
  https://github.com/larksuite/node-sdk
- Lark OpenAPI 文档与消息事件模型：
  https://open.feishu.cn/
- 一个统一 bot 入口常见做法：
  webhook -> adapter -> normalized request -> core agent -> channel formatter -> async sender
