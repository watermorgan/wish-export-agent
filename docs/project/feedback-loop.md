# 反馈闭环设计

## 0. 部署边界

- **export-agent**（本仓库）是独立产品，拥有 Web 工作台、任务状态机、PDF 翻译 pipeline、反馈存储等全部能力。
- **Ting 外贸助手** 是 OpenClaw 平台上的业务智能体，属于 export-agent 的**外部消费方**之一，通过 MCP / REST 调用 export-agent 的 API。
- Ting **不能**直接读写 export-agent 的文件系统。所有数据交互必须通过 HTTP 接口完成。
- Web 工作台的用户直接使用 export-agent 本身，不经过 Ting。

## 0.1 当前已落地范围

当前 Phase 1 已落地的是“收集 -> 落盘 -> 开发侧筛选 -> 术语候选提取 -> 人工决定如何修复”的闭环，不包含自动修复：

- 原始反馈通过 `POST /api/feedback` 写入 `data/feedback-cases/`
- 工作台结果区已接入紧凑反馈录入入口
- 开发侧可用脚本筛选 open cases
- 开发侧可把 open 的 `term_correction` 提取到 `data/glossary/candidates.json`
- 最终规则/术语修改仍由开发者人工落地

## 1. 原则

- 业务侧（Ting / Web 工作台）只负责**收集**反馈，不负责**处理**反馈
- 反馈的消费方是开发智能体（阿呆）、离线脚本、或开发者本人
- 反馈闭环的核心输出是：术语更新、归一规则更新、布局参数校准、prompt 调优
- 当前阶段不做反馈自动修复，不做 feedback -> glossary `core.json` 的自动合入

## 2. 反馈分类

| 类别 | 说明 | 消费方 |
|------|------|--------|
| `translation_error` | 某条翻译不准确 | 术语/归一规则更新 |
| `term_correction` | 术语建议（应翻成什么） | `data/glossary/candidates.json` |
| `layout_issue` | 布局问题（压字、位置不对） | `config/layout-config.json` 校准 |
| `missing_content` | 漏翻（应该翻但没翻） | 识别/选段策略调优 |
| `noise_content` | 噪音（不该翻但翻了） | suppress 规则更新 |
| `general_quality` | 整体满意度/泛评价 | 产品决策参考 |

## 3. 反馈数据结构

参见 `data/feedback-cases/schema.json`。

核心字段：

```json
{
  "id": "fb-20260415-001",
  "category": "translation_error",
  "priority": "high",
  "status": "open",
  "source": {
    "taskId": "task_xxx",
    "fileName": "M422123.pdf",
    "pageNumber": 1,
    "segmentId": "seg-p1-003",
    "sourceText": "Back elasticated waistband",
    "currentTranslation": "后部弹性腰带",
    "expectedTranslation": "后腰部橡筋"
  },
  "reporter": "ting-user",
  "reportedAt": "2026-04-15T10:00:00Z",
  "tags": ["术语", "M422123"],
  "resolution": null
}
```

## 4. 文件结构

```
data/feedback-cases/
  schema.json            # JSON Schema 定义
  fb-20260415-001.json   # 单条反馈
  fb-20260415-002.json
  ...

scripts/
  review-feedback-cases.ts   # 开发侧审阅工具：列出、筛选、统计反馈
  resolve-feedback-case.ts   # 开发侧回写工具：安全更新状态和 resolution
  promote-feedback-terms.ts  # 从 open term_correction 提取术语候选
```

当前开发命令：

```bash
npm run test:feedback
npm run feedback:review -- --status=open
npm run feedback:review -- --status=open --priority=high
npm run feedback:review -- --status=open --category=term_correction
npm run feedback:resolve -- --id fb-20260417-001 --status resolved --action normalize_rule_update --detail "..." --by dev-user
npm run feedback:promote-terms
```

## 5. 闭环流程

### 5.1 收集阶段（Ting / Web 工作台）

业务员通过以下方式产生反馈：
1. 在翻译结果上标记"不准确"并填写修正建议
2. 在 humanReviewGuide 的 hint 上标记"已确认/有问题"
3. 审核退回时附带 reviewComment

反馈写入路径：
- **Web 工作台用户**：前端直接调用 `POST /api/feedback`，由 export-agent 服务端落盘到 `data/feedback-cases/`。
- **Ting 外贸助手**：Ting 在 OpenClaw 侧通过 MCP 工具调用 `POST /api/feedback`，同样由 export-agent 服务端落盘。Ting 不直接写 export-agent 文件系统。
- **人工补录**：开发者可以直接在 `data/feedback-cases/` 下按 schema 手写 JSON 文件。
- **状态回写**：开发者处理完成后统一用 `npm run feedback:resolve` 更新 case；不要继续手改已有 JSON。

当前工作台实现说明：

- 结果区已挂载紧凑反馈入口
- 优先从当前 reply/snapshot 中预填 `fileName`、`taskId`、`pageNumber`、`segmentId`、`sourceText`、`currentTranslation`
- 当前 UI 提供 `translation_error`、`term_correction`、`layout_issue` 三类快捷提交

### 5.2 消费阶段（开发侧）

开发者/阿呆定期执行：
```bash
npm run feedback:review -- --status=open --priority=high
```

输出待处理反馈列表，按优先级排序。

如果只看术语类反馈：

```bash
npm run feedback:review -- --status=open --category=term_correction
```

### 5.3 处理阶段

根据反馈类别执行对应操作：

| 类别 | 处理动作 |
|------|----------|
| `translation_error` | 检查是否需要更新 `normalizeFashionTranslation` 规则 |
| `term_correction` | 先执行 `npm run feedback:promote-terms` 写入 `data/glossary/candidates.json`，人工审核后再合入 `core.json` |
| `layout_issue` | 记录到布局校准样本，调整 `config/layout-config.json` 参数 |
| `missing_content` | 检查 suppress 规则是否过度，或 vision 配额是否不足 |
| `noise_content` | 更新 `shouldSuppressAnnotatedZh` 规则 |

### 5.4 回写阶段

处理完成后：
1. 更新反馈状态为 `resolved`
2. 在 `resolution` 中记录处理方式和关联 commit
3. 下一次翻译自动使用更新后的规则/术语/参数

当前实现备注：

- 提供 `feedback:resolve` CLI，原子更新单个 case 文件
- `resolved` 必须携带真实修复动作；`wont_fix` 只允许 `wont_fix` / `duplicate`
- `feedback:promote-terms` 只处理 `status === "open"` 的 case

示例：

```bash
npm run feedback:resolve -- \
  --id fb-20260417-001 \
  --status resolved \
  --action glossary_update \
  --detail "Promoted approved term candidate to glossary backlog" \
  --by dev-user \
  --commit abc1234
```

```bash
npm run feedback:resolve -- \
  --id fb-20260417-002 \
  --status wont_fix \
  --action duplicate \
  --detail "Duplicate of fb-20260417-001" \
  --by dev-user
```

## 5.5 当前最小冒烟路径

```bash
npm run dev
npm run test:feedback
curl -s http://localhost:3000/api/tasks
curl -s -X POST http://localhost:3000/api/feedback \
  -H 'content-type: application/json' \
  -d '{
    "category":"term_correction",
    "source":{
      "fileName":"M422123.pdf",
      "sourceText":"Back elasticated waistband",
      "expectedTranslation":"后腰部橡筋"
    },
    "reporter":"smoke"
  }'
npm run feedback:review -- --status=open --category=term_correction
npm run feedback:resolve -- \
  --id fb-20260417-001 \
  --status resolved \
  --action glossary_update \
  --detail "Promoted approved term candidate" \
  --by smoke
```

预期：

- `POST /api/feedback` 成功写入新的 case 文件
- `feedback:review` 能立即列出该记录
- `feedback:resolve` 能把目标 case 安全更新为最终状态并写入 resolution 元数据
- 若继续运行 `npm run feedback:promote-terms`，候选会进入 `data/glossary/candidates.json`

## 6. 暂不做

- 不做反馈自动处理（不让模型自己决定修复方式）
- 不做反馈 → prompt 的自动回写
- 不做在线 A/B 测试框架
- 不做跨仓库的反馈同步

## 7. 后续可扩展

- 引入"反馈任务池"：高频同类反馈自动聚合为一个改进任务
- 引入"问题样本池"：反馈关联的 PDF 自动进入 `data/test02` 回归集
- 引入反馈驱动的自动评测：新规则部署后，自动对关联样本重跑 comparison
