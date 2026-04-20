# Ting × export-agent × 阿呆 翻译自迭代闭环最终技术方案

## 0. 2026-04-20 当前实现状态

本文件已不只是提议方案；以下能力已落地为当前基线：

- task 仍是唯一 review object
- task 内部已补 revision lineage：`base / override / rework`
- 新增：
  - `POST /api/tasks/:taskId/overrides`
  - `POST /api/tasks/:taskId/rework`
  - `GET /api/tasks/:taskId/revisions/:revisionId`
- `pdf_translation_skill_v1` 已可附带当前 revision 元数据
- Ting CLI / MCP 已补：
  - `submit_task_overrides`
  - `request_task_rework`
  - `get_task_revision`
  - `submit_feedback_case`

当前仍保留的约束：

- review 仍只接受 `approved | returned`
- revision 不是 review object
- 当前 rework 是“有界目标输入 + revision 审计 + 当前 revision 出口一致”，底层 pipeline 仍按整任务主链执行，不宣称已做真正局部 extractor 计算

## 1. 目标与边界

目标不是做一个自动自治闭环，而是把人工判断拆成 3 类受控输入：

- L0 当前任务内的页面级覆盖：只影响本次交付
- L1 当前任务内的受控返工：生成下一版结果
- L2 系统级学习：影响未来任务，不直接改当前结果

必须遵守当前仓库边界：

- 审核对象当前绑定 `TaskRecord`
- `POST /api/tasks/:taskId/review` 只接受 `approved | returned`
- `POST /api/feedback` 已存在，但 `feedback:review` / `feedback:resolve` / `feedback:promote-terms` 目前是 CLI 治理链，不是 HTTP API
- 外部消费方不能写仓库文件系统，只能走 HTTP / MCP
- 不新增自动修复、自动学习、自动外发

## 2. 当前真实实现基线

当前已经存在且必须复用的能力：

- 创建任务：`POST /api/tasks`
- 查询任务：`GET /api/tasks/:taskId`
- 编辑并重跑任务：`PATCH /api/tasks/:taskId`
- 提交审核：`POST /api/tasks/:taskId/submit`
- 审核：`POST /api/tasks/:taskId/review`
- 结果协议：`GET /api/tasks/:taskId/skill-payload`
- 正式 PDF：`GET /api/tasks/:taskId/translation-pdf`
- 反馈录入：`POST /api/feedback`

当前任务工作流守卫：

- 仅 `pending_user_confirmation` / `returned` 可提交审核
- 仅 `pending_supervisor_review` 可审核
- 仅 `draft` / `validating` / `blocked` / `pending_user_confirmation` / `returned` 可编辑
- `translation-pdf` 缺失 snapshot 时会尝试 `runAssistant(task.request)` 重跑

## 3. 总体设计

核心决策：

- `review object = task`
- `revision = task` 内部执行版本，不是新的审核对象
- `successor-task` 只用于已批准/已导出的历史结果需要重新开工时，不作为 Phase 1/2 主路径

因此系统分为两层：

1. 外层仍是现有 task-centric 状态机
2. 内层新增 revision/patch 轨迹，记录 override 和 rework 的产出版本

## 4. 数据模型

### 4.1 Task 继续承担审核语义

建议在 `TaskRecord` 和任务持久层增加以下字段：

```ts
type TaskRecordV2 = TaskRecord & {
  currentRevisionId?: string;
  baseRevisionId?: string;
  revisionCount?: number;
  lineageMode?: 'in_task_revision';
};
```

语义：

- 审核、提交、导出仍作用于 task 当前 revision
- task 只保留一套 `status` / `reviewStatus`
- 每次 override 或 rework 只推进 `currentRevisionId`

### 4.2 新增内部 Revision 实体

```ts
type TaskRevision = {
  id: string;
  taskId: string;
  parentRevisionId?: string | null;
  kind: 'base' | 'override' | 'rework';
  createdAt: string;
  createdBy: 'sales' | 'supervisor' | 'external_agent';
  state: 'running' | 'ready' | 'failed' | 'superseded';
  instruction?: string;
  pageOverrides?: {
    forceVisionPages?: number[];
    skipTranslationPages?: number[];
    pageDirectives?: Array<{
      pageNumber: number;
      action: 'force_vision' | 'skip_translation' | 'keep_original';
      note?: string;
    }>;
  };
  rework?: {
    scope: 'pages';
    pageNumbers?: number[];
    instruction: string;
  };
  sourceFeedbackIds?: string[];
  snapshotRef?: {
    version: 'translation_snapshot_v1';
    generatedAt: string;
  };
  artifactRef?: {
    deliveryPdfUrl?: string | null;
    skillPayloadUrl?: string | null;
  };
};
```

说明：

- revision 用于 lineage、追溯和取回最新版本
- revision 不引入新的 `approved` / `returned` 状态
- 审核历史继续记录在 task 上

## 5. L0 / L1 / L2 的确定义

### 5.1 L0 页面级人工覆盖

适用问题：

- 第 10 页应该翻译
- 第 8/9 页太糊，不翻译也可以
- 当前任务里只想控制呈现范围，不想改未来规则

建议最小控制量：

```json
{
  "pageOverrides": {
    "forceVisionPages": [10],
    "skipTranslationPages": [8, 9],
    "pageDirectives": [
      { "pageNumber": 10, "action": "force_vision", "note": "用户明确要求补翻" },
      { "pageNumber": 8, "action": "skip_translation", "note": "图片模糊，允许跳过" },
      { "pageNumber": 9, "action": "skip_translation", "note": "图片模糊，允许跳过" }
    ]
  }
}
```

执行语义：

- `forceVisionPages`：强制目标页进入 A 模型视觉抽取
- `skipTranslationPages`：从最终 snapshot / render 输出中抑制该页业务翻译项
- `keep_original`：保留原文但不追加中文

Phase 1 先只支持页级，不做段级 patch。

### 5.2 L1 任务级返工

适用问题：

- 需要重新抽取或重翻
- 需要局部重跑，不应走全量重做

建议请求体：

```json
{
  "scope": "pages",
  "pageNumbers": [10],
  "instruction": "重新识别并翻译第10页，优先保留业务批注，忽略页眉和管理字段"
}
```

执行语义：

- 重跑受限于 `scope`
- 产生新 revision
- task 继续是同一个 task
- 当前 revision 更新后，task 回到 `pending_user_confirmation`
- 当前已实现基线只承诺页级 rework；segment 级返工仍属于后续增强项

### 5.3 L2 系统级学习

适用问题：

- 可以复用到未来任务的术语/规则/布局知识

路径保持现有真实实现：

1. 外部方提交 `POST /api/feedback`
2. 阿呆/开发侧执行 `npm run feedback:review`
3. 需要时执行 `npm run feedback:resolve`
4. 术语类再执行 `npm run feedback:promote-terms`
5. 人工批准后进入长期规则或术语治理

## 6. API 方案

### 6.1 保留现有接口

- `POST /api/tasks`
- `GET /api/tasks/:taskId`
- `PATCH /api/tasks/:taskId`
- `POST /api/tasks/:taskId/submit`
- `POST /api/tasks/:taskId/review`
- `GET /api/tasks/:taskId/skill-payload`
- `GET /api/tasks/:taskId/translation-pdf`
- `POST /api/feedback`

### 6.2 新增接口

#### `POST /api/tasks/:taskId/overrides`

用途：L0 当前任务页面级覆盖。

请求：

```json
{
  "actor": "sales",
  "pageOverrides": {
    "forceVisionPages": [10],
    "skipTranslationPages": [8, 9],
    "pageDirectives": [
      { "pageNumber": 10, "action": "force_vision", "note": "用户要求补翻" }
    ]
  },
  "reason": "用户确认第10页清晰应翻译，第8/9页可忽略"
}
```

响应：

```json
{
  "task": {},
  "reply": {},
  "revision": {
    "id": "rev_xxx",
    "kind": "override",
    "state": "ready"
  }
}
```

#### `POST /api/tasks/:taskId/rework`

用途：L1 有界返工。

请求：

```json
{
  "actor": "sales",
  "scope": "pages",
  "pageNumbers": [10],
  "instruction": "重新识别并翻译第10页，忽略页眉"
}
```

响应同上，`revision.kind = "rework"`。

#### `GET /api/tasks/:taskId/revisions/:revisionId`

用途：读取某次 override / rework 的结果。

响应：

```json
{
  "taskId": "task_xxx",
  "revision": {
    "id": "rev_xxx",
    "kind": "rework",
    "parentRevisionId": "rev_prev",
    "state": "ready",
    "instruction": "重新识别并翻译第10页"
  },
  "result": {
    "deliveryPdfUrl": "/api/tasks/task_xxx/translation-pdf?download=1",
    "skillPayloadUrl": "/api/tasks/task_xxx/skill-payload"
  }
}
```

### 6.3 兼容性约束

- `POST /api/tasks/:taskId/review` 不改 schema
- `approved | returned` 语义不变
- `PATCH /api/tasks/:taskId` 继续保留通用编辑/重跑能力
- 新接口只是给外部方确定性语义，不替换现有 PATCH

## 7. MCP 方案

新的 MCP 名称必须去消费者耦合：

- `submit_task_overrides`
- `request_task_rework`
- `get_task_revision`
- `submit_feedback_case`

当前已存在的 legacy 工具继续保留：

- `submit_pdf_translation_task`
- `get_pdf_translation_task`
- `get_pdf_translation_skill_payload`

兼容策略：

- export-agent 内部契约一律使用通用名称
- Ting 网关层可临时把 legacy 名称映射到新通用能力
- 当出现第二个消费者时，废弃 `ting_*` 命名

## 8. 状态机影响

不改审核状态集合，只补充 revision 触发时的 task 行为：

- L0 override 成功后：task 置回 `pending_user_confirmation`
- L1 rework 成功后：task 置回 `pending_user_confirmation`
- 提交审核后：仍走 `POST /submit`
- 主管审核：仍走 `POST /review`

限制：

- `pending_supervisor_review`、`approved`、`exported` 不直接接受 override/rework
- 若已 `approved` 或 `exported` 仍需改稿，创建 successor-task，并把原 task 作为 lineage 来源

## 9. 路由与执行顺序

同一次用户反馈可能同时命中多个层级，顺序固定为：

1. 先判断是否需要当前交付修正
2. 如只影响当前任务，优先走 L0 或 L1
3. 如可沉淀为未来知识，再额外提交 L2 feedback

即：

- `override` 可以和 `feedback` 同时发生
- `rework` 可以和 `feedback` 同时发生
- `override` 与 `rework` 冲突时，`rework` 优先，override 只在重跑后仍需强行抑制/强行保留时再叠加

## 10. 分阶段实施

### Phase 1

- 只做页级 override
- 只支持 `forceVisionPages` / `skipTranslationPages`
- 不做段级 patch
- 不改 review API

### Phase 2

- 新增 `request_rework`
- 引入 `TaskRevision`
- 当前基线只支持按页有界返工

### Phase 3

- MCP 暴露 override / rework / revision 查询
- Ting SOP 与阿呆 SOP 一起上线
- 真实客户样本闭环验收

## 11. 验收标准

- 新接口合同测试通过
- 旧接口零回归
- review 仍只接收 `approved | returned`
- override 可重复渲染且结果一致
- rework 不会误触发全量重跑
- feedback 可追溯到 `taskId/pageNumber/segmentId`
- Ting 侧无自动自治环

## 12. 关键风险

- 当前 `translation_snapshot_v1` 是 item 级产物，不是完整段级 patch DSL，Phase 1 应避免直接引入复杂段级修改
- 当前 `PATCH /api/tasks/:taskId` 已有全量重跑语义，新增 `rework` 必须显式限制 scope，避免语义重叠
- `feedback linkage` 是 schema 变更，必须明确 `sourceFeedbackIds`
- 已批准任务的改稿不要直接篡改原审核记录，必须走 successor-task
