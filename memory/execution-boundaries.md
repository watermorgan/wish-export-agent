# 执行边界 (Execution Boundaries) - Export Agent V1

## 1. 业务员可执行的动作

- 手动发起 3 条 V1 技能链路：
  - BOM 整理
  - 意见翻译 / 归并
  - 客户回复草拟
- 编辑输入内容、重新提交任务、处理待确认项。
- 在任务进入 `pending_user_confirmation` 或 `returned` 时继续确认 / 退回字段。
- 在任务满足条件后提交主管审核。
- 在任务已 `approved` 后执行导出。

## 2. 主管可执行的动作

- 查看任务执行结果、确认项、审计留痕和审核历史。
- 对 `pending_supervisor_review` 状态任务执行：
  - `approved`
  - `returned`
- 决定任务是否进入正式导出阶段。

## 3. 系统可自动执行的动作

- 抽取输入文件文本并整理成结构化 source。
- 在用户已选择技能后执行翻译、整理和草拟。
- 识别明显的待确认风险项，并生成 `pendingConfirmations`。
- 生成审计留痕、任务状态、导出前结果预览。
- 在 PDF 中生成编号和中文辅助说明，但仅作为内部确认材料。

## 4. 系统绝不能自动执行的动作

- **NO_EXTERNAL_COMMUNICATION**：不得自动发送任何真实外部消息。
- **NO_EXTERNAL_WRITEBACK**：不得自动写入外部 ERP / CRM / 第三方业务系统。
- **NO_AUTONOMOUS_CHAINING**：不得在没有人工确认的情况下自动连续启动下一个技能。
- **NO_BUSINESS_GUESSING**：不得在信息缺失时自行决定价格、交期、付款、认证、物流等商业条款。

## 5. 必须人工确认的内容

- 价格、交期、认证、付款、物流相关内容。
- 模型输出中的“无法确定 / 待确认 / not sure / to be confirmed”类内容。
- 对客户回复草稿中的核心商务承诺。
- BOM / 工艺单中不确定的规格、数量、颜色、材料结论。

## 6. 必须主管审核的动作

- 所有正式导出前的最终审核。
- 业务员提交到 `pending_supervisor_review` 的任务。
- 被主管退回后再次提交的任务。

## 7. 当前真实状态机边界

- 系统允许编辑的状态：
  - `draft`
  - `validating`
  - `blocked`
  - `pending_user_confirmation`
  - `returned`

- 系统允许更新确认项的状态：
  - `pending_user_confirmation`
  - `returned`

- 系统允许提交审核的状态：
  - `pending_user_confirmation`
  - `returned`

- 系统允许审核的状态：
  - `pending_supervisor_review`

- 系统允许导出的状态：
  - `approved`

## 8. 当前 V1 非目标

- 不做统计报表型运营后台。
- 不做低风险免审口子。
- 不做自动报价。
- 不做自动对外回复。
- 不做自动写 ERP / CRM。
