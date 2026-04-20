# 翻译自迭代闭环分阶段上线计划与回滚策略

## 当前落地状态

- Phase 1 已落地：页级 override + revision metadata
- Phase 2 已部分落地：rework route、revision retrieval、外部适配层入口
- 尚未落地的部分主要是更深的底层增量计算与更完整的历史 revision artifact 冻结

## 1. 上线策略

按三阶段上线，每阶段都必须可单独回滚。

建议使用 feature flags：

- `ENABLE_TASK_OVERRIDES`
- `ENABLE_TASK_REWORK`
- `ENABLE_TASK_REVISION_READ_API`
- `ENABLE_EXTERNAL_REVISION_TOOLS`

## 2. Phase 1

### 范围

- 发布 `POST /api/tasks/:taskId/overrides`
- 仅支持页级：
  - `forceVisionPages`
  - `skipTranslationPages`
- task 仍是审核对象
- MCP 暂不暴露自动多步能力

### 目标

- 验证“人类清晰度判断可以稳定注入当前任务”
- 验证 freeze snapshot 下的结果可重现

### 验收

- 合同测试通过
- review API 零变更
- override 后 PDF 可重复渲染
- 一条真实客户样本完成“用户指令 -> override -> 新 PDF -> 用户确认”

### 回滚

1. 关闭 `ENABLE_TASK_OVERRIDES`
2. Ting 停止调用 override 工具
3. 外部方退回到“只提交任务 + 拉取结果”

回滚后保留：

- 既有任务数据
- feedback 主链

## 3. Phase 2

### 范围

- 发布 `POST /api/tasks/:taskId/rework`
- 发布 revision store
- 发布 `GET /api/tasks/:taskId/revisions/:revisionId`

### 目标

- 验证局部返工不会误伤全量任务
- 建立 task 内 revision lineage

### 验收

- 有界 scope 命中率正确
- page/segment 级返工可追溯
- 返工后 task 仍通过原 submit/review 流程审核

### 回滚

1. 关闭 `ENABLE_TASK_REWORK`
2. 关闭 `ENABLE_TASK_REVISION_READ_API`
3. 保留 Phase 1 override 能力
4. 外部返工临时降级回 `PATCH /api/tasks/:taskId` 的人工使用方式

注意：

- 不删除已生成 revision 数据
- 只停用入口，不做 destructive 清理

## 4. Phase 3

### 范围

- MCP 暴露：
  - `submit_task_overrides`
  - `request_task_rework`
  - `get_task_revision`
  - `submit_feedback_case`
- Ting system prompt 上线
- 阿呆治理 SOP 生效

### 目标

- 打通 Ting × export-agent × 阿呆 的完整人工闭环

### 验收

- Ting 不产生自治循环
- Ting 能最小追问并正确选路
- 阿呆能处理 open feedback 并回写 resolve
- 至少一条真实客户链路跑通：
  - 用户提意见
  - Ting 结构化提交
  - export-agent 产出新版本
  - 用户确认
  - 阿呆完成可复用反馈治理

### 回滚

1. 关闭 `ENABLE_EXTERNAL_REVISION_TOOLS`
2. Ting prompt 回退到 legacy 三工具模式
3. export-agent 仅保留内部 API，不再对 MCP 暴露 override/rework

## 5. 数据回滚原则

- 不回滚 `feedback-cases` 文件
- 不回滚已批准任务的 review history
- 不删除已生成 revision，只允许标记 superseded
- 回滚时优先关闭入口与路由，不做数据擦除

## 6. 发布前检查单

```bash
npm run lint
npm run build
npm run test:feedback
npm run smoke:pdf
npm run verify:pdf-e2e
npm run verify:ting-skill-payload
npm run verify:ting-mcp-server
npm run verify:ting-service-cli
npm run verify:async-task-submit
```

如果动了 test02 主链，再补：

```bash
npm run eval:test02
```

## 7. 灰度建议

先按消费方和样本灰度：

1. Web 工作台内部人工使用
2. Ting 测试环境单用户
3. Ting 生产灰度客户
4. 全量开放

灰度期间重点监控：

- override / rework 调用量
- rework 的 scope 分布
- feedback 分类分布
- 返回 4xx 的 schema 错误率
- `translation-pdf` 重渲染失败率

## 8. 失败阈值

出现以下任一情况立即停止放量：

- review 流程出现状态破坏
- rework 误触发全量重跑
- Ting 出现连续自治调用
- 正式 PDF 渲染结果不一致
- feedback 追溯丢失 `taskId/pageNumber/segmentId`

## 9. 成功判定

满足以下条件才算阶段完成：

- 用户可表达“这页翻 / 不翻 / 重做 / 以后都这样”
- 系统能稳定路由到 override / rework / feedback
- 审核流不变
- 结果可追溯、可回滚、可验证
