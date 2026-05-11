# Ting / export-agent 稳定性分析（2026-04-15）

## 现象

- Ting 上传 PDF 后，偶发返回“翻译服务连接不上”。
- 同一服务在人工排障时又可能恢复为可访问状态，表现为间歇性。
- 历史上出现过：
  - `submit_pdf_translation_task -> 503 fetch failed`
  - DB 断链后回退 memory store
  - Ting 旧会话/旧 cron 指令把 `xlsx/html` 转 PDF，污染最终交付

## 直接原因

### 1. 服务进程缺少受控生命周期

此前主要依赖人工在终端里执行 `npm start` / `next start`。
这会带来几个问题：

- 进程可能跟随交互式 shell 生命周期退出
- 没有稳定的 pid / log / status 入口
- 出现 503 时，第一现场很难判断是进程已死、端口未监听、还是仅模型超时

这次 `M441083` 历史日志里的 `503 fetch failed`，直接含义就是 Ting MCP 无法连到 `http://127.0.0.1:3000`。

### 1.5. live MCP server 文件与仓库脚本漂移

Ting 实际使用的 MCP server 文件路径是：

- `~/.openclaw/mcp-servers/ting-pdf-mcp-server.mjs`

而仓库开发改动发生在：

- `scripts/ting-pdf-mcp-server.mjs`

如果只改仓库文件、不同步到 `~/.openclaw/mcp-servers/`，则会出现：

- 仓库验证通过
- 但 Ting live 会话仍跑旧 MCP server
- 表现为 `Not connected`、缺少新字段、错误文案落后

### 1.8. gateway 心跳/连接层波动会直接表现为 `Not connected`

2026-04-15 的 gateway 日志里已出现：

- `[tools] export-agent-pdf-local__submit_pdf_translation_task failed: Not connected`
- `TERMINATE SOCKET: Ping Pong does not transfer heartbeat within heartbeat intervall`

这说明某些 `Not connected` 不是后端 HTTP 挂掉，而是：

- OpenClaw gateway 到 MCP server 的连接断开
- 或 gateway 自身重载/心跳异常后，工具通道尚未恢复

### 2. 健康检查过于薄弱

此前 `/api/health` 只返回：

- `status`
- `service`
- `mode`

无法快速判断：

- 当前进程 pid
- 当前端口
- 当前 task store 是 DB 模式还是 fallback-only

### 3. DB 链路本身不稳定

仓库里已经有证据表明 PostgreSQL 连接会出现：

- `Connection terminated unexpectedly`

虽然 task-store 已经加了 fallback 持久化，但 DB 抖动仍会造成：

- 任务状态更新延迟
- 冷启动期间 schema / reconnect 开销
- 日志噪音掩盖真正的服务可用性问题

### 4. Ting 旧记忆 / 旧 cron 指令会制造“假故障”

旧会话里存在大量历史指令，会在错误时触发：

- 重复轮询
- 把 xlsx/html 转 PDF
- 使用历史错误 taskId

这不一定让 export-agent 挂掉，但会显著放大“系统不稳定”的体感。

## 已落地的修复

### 运行保障

新增受控服务脚本：

- `npm run service:start`
- `npm run service:stop`
- `npm run service:restart`
- `npm run service:status`
- `npm run service:health`
- `npm run service:sync-ting-mcp`
- `npm run service:reload-gateway`
- `npm run service:preflight`

脚本行为：

- 固定检查 `.next` 是否存在
- 写 pid 文件到 `.tmp/service/wish-export-agent.pid`
- 通过健康探针确认启动成功
- 默认沿用当前“无 DB 也可运行”的 fallback 路线，降低演示期抖动
- 可将仓库内最新 MCP server 脚本同步到 `~/.openclaw/mcp-servers/`

### 健康检查增强

`/api/health` 现可返回：

- `generatedAt`
- `pid`
- `port`
- `taskStoreMode`
- `taskStorePersistence`

健康语义：

- 无数据库配置时，`taskStoreMode=fallback-only` 表示任务状态写入本地 `.tmp/task-store-fallback.json`，这是演示期的预期 local-file 持久化模式，不再默认视为 degraded。
- 生产环境如果必须依赖数据库任务存储，应设置 `TASK_STORE_REQUIRE_DATABASE=1`；此时缺少可用数据库会返回 degraded，并在 `readiness.degradedReasons` 中给出 `task-store-database-required`。
- 已配置数据库但 task store 因冷却/不可用进入本地回退时，会返回 `taskStoreMode=database-unavailable-fallback`，用于区分“预期无 DB 演示模式”和“配置了 DB 但当前不可用”。

便于快速判断“服务是否真在跑，以及当前是什么存储模式”。

## 当前建议的演示期运行策略

### 推荐值班模式

1. 演示前先执行 `npm run service:restart`
2. 再执行 `npm run service:sync-ting-mcp`
3. 再执行 `npm run service:health`
4. 若 Ting 刚出现 `Not connected`，重载 OpenClaw gateway
5. 再让 Ting 接收新 PDF

推荐直接执行：

```bash
npm run service:preflight
```

### 推荐存储模式

演示期优先使用：

- `fallback-only`

也就是不依赖易抖动的远端 DB，先保证：

- 服务能连
- taskId 不丢
- annotated PDF 能回

如果从演示期切到生产部署，先配置数据库连接，再加：

```bash
TASK_STORE_REQUIRE_DATABASE=1
```

这样 `/api/health` 才会把缺失/不可用的数据库明确标为 degraded。

### 推荐验收顺序

1. `curl /api/health`
2. `npm run service:status`
3. Ting 发一份真实 PDF
4. `curl /api/tasks/{taskId}/skill-payload`
5. `curl /api/tasks/{taskId}/translation-pdf?download=1`

## 后续优化建议

### P0：必须做

- 把 export-agent 挂到真正的守护层上
  - `launchd` / `pm2` / system service 三选一
- 对 Ting 的最终交付继续只保留 `deliveryPdfUrl`
- 演示期禁用历史 cron 轮询策略

### P1：应该做

- 在 `/api/health` 增加最近一次任务执行摘要
  - 最近任务时间
  - 最近失败原因
  - 最近一次 annotated PDF 是否成功
- 增加 `service:smoke`
  - 同时探测 `/api/health`、`/api/tasks`、`/api/model-health`

### P2：可选做

- 把本地模型健康状态纳入独立 readiness
- 为 task-store fallback 增加轮转备份
- 将 Ting 侧最终附件发送路径标准化为 `mediaUrl/mediaUrls`

## 结论

这次“服务连接不上”的核心不是 PDF pipeline 算法本身，而是运行层没有被当成正式服务管理。

短期最有效的治理手段是：

- 用受控脚本固定启动/重启/巡检
- 演示期默认 fallback-only
- 保持 Ting 只认 `deliveryPdfUrl`

这样能最大幅度降低“服务明明没坏，但链路表现像坏了”的概率。
