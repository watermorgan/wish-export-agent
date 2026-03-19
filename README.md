# Wish Export Agent

面向非技术外贸团队的上传问答与日常办公助手。

## 已完成骨架
- 独立 Git 仓库
- Codex bridge / memory / skills 基线
- `Next.js + PWA + 上传问答` 前后端骨架
- 一个可替换的服务端 mock agent 接口

## 运行
```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 当前目录结构
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
- 输入外贸工作问题
- 服务端返回摘要、建议动作、风险提示和回复方向
- PWA manifest 已就位，后续可继续完善离线与安装体验
- 已预留 bot 扩展层，网页端和 Feishu 可复用同一套 agent 服务

## 下一步建议
1. 明确首批 3 条业务工作流：
   询盘总结、英文回复草拟、报价前检查
2. 接入真实文件解析与知识检索
3. 将 `src/app/api/assistant/route.ts` 替换成真实模型编排
4. 加入登录、团队工作台和历史记录
5. 把 `src/app/api/channels/[channel]/webhook/route.ts` 接到 Feishu 真实回调和发送器
