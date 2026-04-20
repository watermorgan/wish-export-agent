# Review Object 选择决策

## 实现状态

该决策已按当前代码基线落地：

- task 是唯一 review object
- revision 只用于 lineage / current control / retrieval
- submit/review/export 没有切到 revision 级语义

## 结论

选择 `task` 作为唯一 review object。

补充机制：

- `revision` 作为 task 内部执行版本
- `successor-task` 只用于已批准/已导出结果的后续改稿

因此最终决策不是 “iteration 作为审核对象”，也不是 “successor-task 作为默认返工对象”，而是：

- `review object = task`
- `revision object = internal lineage`

## 为什么不是 iteration

如果把 iteration 作为审核对象，会直接冲击当前实现：

- `POST /api/tasks/:taskId/review` 现在只认识 task
- `canReviewTaskStatus()` 的守卫绑定 task 状态
- `reviewHistory` 记录也绑定 task
- 数据库存储和 fallback store 都是 task-centric

把 iteration 升格成审核对象会引入：

- 新审核端点
- 新状态机
- 新 review history 归属
- 主管界面和导出门控重写

这和“保留现有审核语义不变”的目标冲突。

## 为什么不是 successor-task

如果把每次返工都建成 successor-task，会带来三个问题：

- task 列表会被大量局部修改淹没
- 原始任务与返工版本的人工审核上下文被切碎
- Ting 需要额外判断“当前应该看哪个 task”，增加外部策略漂移

successor-task 适合以下场景：

- 原任务已经 `approved` 或 `exported`
- 历史交付需要重新开案
- 必须保留原审核结论不可变

这不是 Phase 1/2 的默认路径。

## 为什么 task 最合适

task 作为审核对象有三个直接优势：

1. 与当前代码和状态机完全一致
2. 外部消费方不必重新理解审核实体
3. 可以把 override/rework 限定为 task 的“当前版本变化”

主管真正审核的是：

- 这个 task 的当前可交付结果

而不是：

- 某个中间 revision
- 某个孤立的 successor-task 分支

## 推荐模型

```ts
Task
  - status / reviewStatus / reviewHistory
  - currentRevisionId
  - baseRevisionId

TaskRevision
  - kind: base | override | rework
  - parentRevisionId
  - controls / instruction
  - snapshotRef / artifactRef
```

语义：

- task 负责对外业务状态
- revision 负责内部版本轨迹
- review 永远针对 task.currentRevisionId 对应结果

## 状态语义

### 创建 base revision

- 新任务创建时自动生成 `base` revision

### 产生 override / rework

- 生成新 revision
- `task.currentRevisionId` 指向新 revision
- task 状态回到 `pending_user_confirmation`

### 提交审核

- 不审核 revision id
- 仍审核 task 当前版本

### 主管退回

- 退回的是 task
- revision 保留为历史证据，不单独进入 returned

## 对外接口影响

保留：

- `POST /api/tasks/:taskId/submit`
- `POST /api/tasks/:taskId/review`

新增：

- `POST /api/tasks/:taskId/overrides`
- `POST /api/tasks/:taskId/rework`
- `GET /api/tasks/:taskId/revisions/:revisionId`

这保证：

- 审核面稳定
- 返工面明确
- lineage 可追溯

## 决策后的边界规则

- Task 是唯一审核对象
- Revision 不是审核对象
- Successor-task 不是常规返工路径
- 已批准或已导出的任务若需改稿，才允许新建 successor-task

## 需要补的工程项

- 为 task 增加 `currentRevisionId/baseRevisionId/revisionCount`
- 新增 revision store/table
- 在 `skill-payload` 和 revision 查询结果里暴露当前 revision 元数据
- 在审计日志中记录“谁因为什么创建了哪次 override/rework”
