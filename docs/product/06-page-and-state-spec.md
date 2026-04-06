# 外贸助手 V1 页面与状态规格

## 1. 文档目标
把 V1 的页面信息架构、任务状态机、关键页面字段和角色操作边界定成可直接进入 UI 设计和前后端拆分的规格。

## 2. 页面信息架构

### 2.1 一级页面
- `工作台 / Workspace`
- `任务详情 / Task Detail`
- `审核队列 / Review Queue`
- `模板管理 / Template Library`

### 2.2 V1 页面关系
```text
[工作台]
  |-- 新建任务
  |-- 最近任务
  |-- 技能/模板入口
  |-- 风险提示摘要
         |
         v
[任务详情]
  |-- 原始资料与引用
  |-- 执行步骤与中间产物
  |-- 待确认项与操作区
         |
         +--> [审核队列]
         |
         +--> [导出]

[审核队列]
  |-- 待审核
  |-- 已退回
  |-- 已通过
  |-- 全部

[模板管理]
  |-- 模板列表
  |-- 模板详情
  |-- 发布/归档
```

## 3. 任务状态机

### 3.1 正式状态
| 状态 | 说明 | 主要操作者 | 可执行动作 |
| --- | --- | --- | --- |
| `draft` | 任务已创建但未执行 | 业务员 | 编辑任务、上传文件、选择技能/模板 |
| `validating` | 系统正在做执行前校验 | 系统 | 无人工动作 |
| `blocked` | 输入或规则不满足，不能继续执行 | 业务员 | 补资料、换模板、改任务目标 |
| `pending_user_confirmation` | 已生成中间结果，等待业务员处理待确认项 | 业务员 | 补录、确认、修改、保存草稿、提交审核 |
| `pending_supervisor_review` | 业务员已提交，等待主管审核 | 主管 | 通过、退回、补充审核意见 |
| `returned` | 审核退回，等待业务员重新处理 | 业务员 | 修改、重新提交审核 |
| `approved` | 审核通过，可导出 | 主管、业务员 | 查看、导出 |
| `exported` | 已导出正式产物 | 业务员、主管 | 查看记录、继续回查 |
| `failed` | 某一步执行或导出异常 | 系统、业务员 | 查看错误、重试、保留草稿 |

### 3.2 状态流转规则与守卫 (Guards)
```text
draft
  -> validating
     -> blocked (若校验未通过)
     -> pending_user_confirmation (若校验通过且生成中间结果)

pending_user_confirmation
  -> pending_supervisor_review (强制守卫：必须完成所有 required 待确认项)
  -> failed (执行异常)

pending_supervisor_review
  -> approved (主管通过)
  -> returned (主管退回，必填退回原因)

returned
  -> pending_user_confirmation

approved
  -> exported
```

#### 3.2.1 强制迁移守卫逻辑
- **提交审核守卫**：
  - 触发条件：业务员点击“提交审核”。
  - 校验项：`count(pendingConfirmations where status='required' and confirmationStatus!='confirmed') == 0`。
  - 拦截行为：若有未处理的 `required` 项，阻止提交并高亮未处理项。
- **导出守卫**：
  - 触发条件：业务员/主管点击“导出”。
  - 校验项：`task.status == 'approved'`。
  - 拦截行为：未通过审核的任务仅允许“复制草稿（带水印/警告）”，不允许生成正式导出产物。


### 3.3 阻断规则
- 命中阻断规则时，状态必须进入 `blocked`
- `blocked` 只允许修正输入，不允许跳过阻断直接导出或提交审核
- `BOM 整理` 缺少工艺单或说明文件时直接阻断
- `客户回复草拟` 缺少上下文时不阻断，但结果只能停留在内部草稿，不可进入可外发态

## 4. 关键页面规格

### 4.1 工作台
#### 页面目标
让业务员或主管从明确任务类型出发，完成任务发起和手动编排。

#### 核心区块
- 新建任务区
- 角色切换区
- 任务类型选择区
- 技能卡片区
- 模板推荐区
- 文件上传区
- 最近任务区
- 风险与待确认摘要区

#### 必显字段
- 当前角色
- 任务类型
- 已选技能
- 已选模板
- 文件数量与状态
- 任务目标文本
- 最近任务状态

### 4.2 任务详情
#### 页面布局
- 左栏：原始资料、文件清单、引用来源
- 中栏：执行步骤时间线、中间产物、冲突项、缺失项
- 右栏：待确认项、人工备注、状态标签、操作按钮

#### 必显字段
- 任务状态
- 审核状态
- 技能链
- 每一步执行摘要
- 中间产物
- 待确认项状态
- 人工修改记录
- 审计摘要

#### 操作按钮
- 保存草稿
- 提交审核
- 退回修改
- 审核通过
- 导出

### 4.3 审核队列
#### 页面目标
让主管快速定位高风险任务并完成审核。

#### 默认筛选
- 待审核
- 已退回
- 已通过
- 全部

#### 默认排序
- 最后更新时间倒序

#### 列表字段
- 任务标题
- 任务类型
- 发起人
- 风险等级
- 待确认项数量
- 当前状态
- 最后更新时间

### 4.4 模板管理
#### 页面目标
让主管基于高质量任务沉淀模板并发布给业务员。

#### 关键模块
- 模板列表
- 模板详情
- 模板版本记录
- 发布状态

#### 必显字段
- 模板名称
- 适用场景
- 步骤顺序
- 阻断条件
- 人工确认点
- 来源任务
- 当前版本
- 发布状态

## 5. 角色权限边界

### 5.1 业务员
- 可创建任务
- 可编辑任务目标和中间结果
- 可处理待确认项
- 可提交审核
- 可查看自己的任务和导出结果
- 不可审核任务
- 不可发布模板

### 5.2 主管
- 可查看待审任务
- 可通过或退回任务
- 可创建模板和发布模板
- 可查看审核记录和风险摘要

## 6. 页面字段清单

### 6.1 任务基础字段
- `taskId`
- `taskType`
- `taskTitle`
- `role`
- `status`
- `reviewStatus`
- `goal`
- `selectedSkillIds`
- `selectedTemplateId`
- `uploadedFiles`
- `updatedAt`

### 6.2 中间产物字段
- `artifactSection.title`
- `artifactSection.kind`
- `artifactSection.summary`
- `artifactField.label`
- `artifactField.value`
- `artifactField.citation`
- `artifactField.confirmationStatus`

### 6.3 待确认项字段
- `confirmation.id`
- `confirmation.label`
- `confirmation.reason`
- `confirmation.owner`
- `confirmation.status`

### 6.4 审核字段
- `reviewer`
- `reviewDecision`
- `reviewComment`
- `reviewedAt`

## 7. V1 必做与后置

### V1 必做
- 工作台
- 任务详情
- 审核队列
- 模板发布与复用
- 状态机和待确认项

### V1.1 后置
- 主管复盘看板
- 技能卡片全量配置后台
- 渠道 Bot 真正交付
- 多格式导出
