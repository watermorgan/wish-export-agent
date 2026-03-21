# 验收准则 (Acceptance Criteria) - Export Agent V1

## 1. 适用范围

本文档定义当前仓库 V1 的工程与产品验收底线。所有 UI、API、workflow 与文档调整都应以当前代码真实状态机、真实 schema 与 V1 边界为准，不得继续沿用已废弃字段或旧状态名。

## 2. V1 核心行为准则

- **人工干预优先**：系统负责整理、翻译、草拟，不负责替用户做商务决策。
- **显式待确认**：任何涉及价格、交期、认证、付款、物流等商业承诺的信息，在未人工确认前都必须显式标记为待确认。
- **原子化执行**：技能必须由用户显式触发，不允许无确认自动串联连续执行。
- **原文保留优先**：翻译链必须保留英文原文，不得把负面意见美化、改写为结论或删除责任信息。

## 3. 明确的验收标准

### 3.1 技能实现

- **BOM 整理**：
  - 输出必须包含结构化物料字段。
  - 对不确定项必须显式标记为待确认，不得自行补齐。

- **意见翻译与归并**：
  - translator-only 场景必须能生成“英文原文 + 中文翻译”的结构化结果。
  - 若叠加 `comment-merger`，翻译阶段仍应先执行；归并可作为后续步骤继续消费翻译结果。
  - 价格、交期、认证、付款、物流、不确定表述命中时，必须进入待确认项。

- **客户回复草拟**：
  - 输出只能是草稿，不得直接对外发送。
  - 核心商务条款必须保留待确认语义。

### 3.2 UI 交互

- 确认项状态必须使用当前真实模型：
  - `required`
  - `recommended`
  - `confirmed`
  - `returned`
- 未确认项必须有清晰视觉区分。
  - 当前样式基线为 `.confirmation-item.status-required`、`.status-returned`、`.status-recommended`
- 用户必须能对确认项执行“确认 / 退回”。
- 审核历史、审计摘要和任务状态必须可回查。

### 3.3 数据与 API

- `AssistantReply` 必须包含：
  - `pendingConfirmations`
  - `artifacts`
  - `auditTrail`
  - `status`
  - `reviewStatus`
- 当前 metadata 基线为：
  - `metadata.needsHumanReview`
  - 可选 `metadata.providerHits`
  - 可选 `metadata.translationMode`
- 若后续系统需要兼容 snake_case，应通过兼容映射实现，而不是在当前代码中混用两套命名。

### 3.4 工作流门控

- 任务状态机必须对齐 `TaskStatus`：
  - `draft`
  - `validating`
  - `blocked`
  - `pending_user_confirmation`
  - `pending_supervisor_review`
  - `approved`
  - `returned`
  - `exported`
  - `archived`
  - `failed`
- 提交审核前必须清空所有 `required` 与 `returned` 确认项。
- 只有 `approved` 后才能导出正式产物。

## 4. 明确的禁止行为

- **NO_AUTO_SEND**：禁止任何真实的自动外部发送，包括 Email、Feishu、Slack、企微、WhatsApp。
- **NO_AUTO_WRITE_DB**：禁止自动写入外部 ERP / CRM，仅允许导出、复制或人工同步。
- **NO_LOOP_EXECUTION**：禁止无人工确认的自动循环、递归、自主连续执行。
- **NO_DECISION_MAKING**：禁止在信息缺失时猜测价格、交期、付款方式、认证结论或物流安排。

## 5. 审核与人工确认要求

- 业务员可以：
  - 发起任务
  - 编辑任务输入
  - 处理确认项
  - 提交审核
- 主管可以：
  - 审核通过
  - 退回任务
  - 决定任务是否可导出
- 所有人工确认或审核操作都必须保留时间与审计痕迹。

## 6. 翻译链专项要求

- 翻译执行必须优先基于结构化 source，而不是直接把整份原始 PDF 字节流送给模型。
- translator-only 与 translator+merger 都应优先走真实 translator 阶段。
- 规则型 pending 兜底至少应覆盖：
  - 价格
  - 交期
  - 认证
  - 付款
  - 物流
  - “无法确定 / not sure / to be confirmed” 类表达
- PDF 输出必须保证业务可确认性：
  - 原文附近保留编号
  - 中文结果优先放同页空白区
  - 密集页允许下沉到补充 review 页，但不得破坏原页主可读性
