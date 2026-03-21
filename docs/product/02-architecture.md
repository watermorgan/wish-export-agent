# 外贸助手 V1 架构文档

## 1. 架构目标
为 V1 提供一套安全可控、可扩展、便于后续接 bot 渠道的系统分层。架构必须支持：
- Web 工作台主入口
- 技能目录与人工触发组合
- 中间结果可视化与人工确认
- 审计留痕
- 未来渠道扩展但不污染核心服务

## 2. 为什么不采用自由聊天型 Agent
- 自由聊天型 Agent 难以约束输出边界，容易跳过人工确认
- 当前任务具有强结构化特征，适合技能卡片和模板编排
- 团队需要复用标准化能力，而不是复用临时对话
- 安全目标要求把“待确认”作为正式节点，而不是模型自觉

因此 V1 采用 `技能卡片 + 人工触发组合 + 核心编排器` 的形态，而不是开放式 Agent。

## 3. 系统分层
### 3.1 Web Workspace
- 提供上传、技能选择、组合执行、结果预览、审核与导出界面
- 只负责用户交互和任务发起，不承载业务编排逻辑

### 3.2 Skill Catalog (Decoupled)
- 存放技能定义、输入要求、输出结构、风险等级、可组合关系。
- **解耦模式**：每个技能对应 `src/skills/<skill-id>/` 目录，包含 `manifest.json`（元数据与参数）和 `prompt.md`（Markdown 提示词指令）。
- 系统在启动时通过静态加载器读取并校验 Schema。
- 支持主管配置与发布。

### 3.3 Skill Composer
- 根据用户选择和模板规则生成技能执行链
- 负责前后置依赖检查和阻断条件判断

### 3.4 Core Agent Orchestrator
- 统一接收执行请求
- 调用解析、知识检索、模型生成和结果整理
- 统一输出结构化结果和待确认项

### 3.5 Document Parsing Layer
- 负责文档解析、文本提取、结构化字段抽取
- 对工艺单、表格、批注、文本资料形成统一中间表示

### 3.6 Audit / Review / Artifact Layer
- 保存中间结果、最终结果、人工编辑版本、审核状态和引用来源
- 提供主管审核与回溯能力

### 3.7 Channel Adapter Layer
- 负责 Web、Feishu、Slack、企微等入口的协议适配
- 只做解析、标准化和结果格式化
- 不承载业务规则

### 3.8 Model Gateway
- 统一管理模型调用
- 负责提示词模板、工具调用边界、风险标签注入和返回格式控制

### 3.9 Storage
- 文件存储
- 执行记录存储
- 技能定义存储
- 审核与产物存储

### 3.10 ASCII 架构图
```text
+----------------------------------------------------------------------------------+
|                                Entry / Channel Layer                             |
|                                                                                  |
|   [Web Workspace (V1 主入口)]          [Feishu / Slack / 企微 Adapter (预留)]    |
+--------------------------------------+-------------------------------------------+
                                       |
                                       v
+----------------------------------------------------------------------------------+
|                             Request / Composition Layer                          |
|                                                                                  |
|   [ExecutionRequest Builder] -> [Skill Composer] -> [Blocking Validator]         |
|                                                                                  |
|   负责：输入标准化、技能选择、模板组合、依赖检查、阻断条件判断                    |
+--------------------------------------+-------------------------------------------+
                                       |
                                       v
+----------------------------------------------------------------------------------+
|                              Core Agent Orchestrator                             |
|                                                                                  |
|   [Step Runner] -> [Review Checkpoint Inserter] -> [Result Normalizer]          |
|                                                                                  |
|   负责：按步骤执行技能、插入人工确认点、统一结果结构和待确认项                    |
+--------------+-----------------------+--------------------------+----------------+
               |                       |                          |
               v                       v                          v
        +-------------+         +-------------+          +----------------------+
        | Document    |         | Model       |          | Skill Catalog /      |
        | Parsing     |         | Gateway     |          | Workflow Templates   |
        | Layer       |         |             |          |                      |
        +-------------+         +-------------+          +----------------------+
               \                       |                          /
                \                      |                         /
                 +---------------------+------------------------+
                                       |
                                       v
+----------------------------------------------------------------------------------+
|                             Audit / Review / Artifact Layer                      |
|                                                                                  |
|   [Intermediate Results] [Pending Confirmations] [Edited Versions] [Citations]  |
|   [Review Decision]      [Return Reasons]       [Export Status]                  |
+--------------------------------------+-------------------------------------------+
                                       |
                                       v
+----------------------------------------------------------------------------------+
|                                      Storage                                     |
|                                                                                  |
|   [File Store] [Execution Records] [Review Logs] [Template Store] [Artifacts]   |
+----------------------------------------------------------------------------------+
```

## 4. 核心数据流
1. 用户在 Web 工作台上传文件并选择技能
2. Web Workspace 生成 `ExecutionRequest`
3. Skill Composer 校验技能、组合关系与前置条件
4. Core Agent Orchestrator 调用 Document Parsing Layer 和 Model Gateway
5. 系统生成中间结果、待确认项和最终草稿
6. Audit / Review / Artifact Layer 保存执行产物
7. 业务员或主管进行人工确认与审核
8. 系统导出最终结果，或将结果保留给未来 bot/外部系统使用

### 4.1 ASCII 执行流程图
```text
[业务员上传资料 + 输入目标]
            |
            v
[选择单技能或技能链模板]
            |
            v
[系统校验输入 / 依赖 / 阻断条件]
            |
     +------+------+
     |             |
     | 失败/阻断   | 通过
     v             v
[提示补资料/改模板]   [执行解析与技能链]
     |             |
     |             v
     |      [输出中间结果 + 待确认项 + 草稿]
     |             |
     |             v
     |      [业务员人工确认 / 补录 / 修改]
     |             |
     |      +------+------+
     |      |             |
     |      | 未完成确认   | 已完成确认
     |      v             v
     | [保存草稿并继续补充] [提交主管审核]
     |                           |
     |                           v
     |                    [主管通过 / 退回]
     |                     |           |
     |                     |退回       |通过
     |                     v           v
     |              [返回业务员修改] [导出结果]
     |                                 |
     +---------------------------------+
                                       |
                                       v
                              [保存审计与执行记录]
```

## 5. 核心接口/对象
### 5.1 SkillDefinition
| 字段 | 说明 |
| --- | --- |
| `id` | 技能唯一标识 |
| `name` | 技能名称 |
| `purpose` | 技能用途 |
| `inputRequirements` | 输入要求 |
| `outputSchema` | 输出结构 |
| `reviewCheckpoints` | 人工确认点 |
| `composableWith` | 可组合技能列表 |
| `riskLevel` | 风险等级 |

### 5.2 WorkflowTemplate
| 字段 | 说明 |
| --- | --- |
| `id` | 模板唯一标识 |
| `goal` | 模板目标任务 |
| `scenarios` | 适用场景 |
| `steps` | 步骤序列 |
| `allowedSkills` | 可用技能 |
| `blockingConditions` | 阻断条件 |
| `deliverables` | 完成产物 |

### 5.3 ExecutionRequest
| 字段 | 说明 |
| --- | --- |
| `channel` | 来源渠道 |
| `user` | 发起用户 |
| `conversation` | 会话信息 |
| `uploadedFiles` | 上传文件 |
| `selectedSkills` | 选中技能 |
| `goal` | 本次任务目标 |
| `contextNotes` | 上下文说明 |

### 5.4 ExecutionArtifact
| 字段 | 说明 |
| --- | --- |
| `requestId` | 对应执行请求 |
| `intermediateResults` | 中间结果 |
| `finalResult` | 最终结果 |
| `editedVersions` | 人工编辑版本 |
| `reviewStatus` | 审核状态 |
| `citations` | 引用来源 |

### 5.5 ReviewCheckpoint
| 字段 | 说明 |
| --- | --- |
| `type` | 检查类型 |
| `requiredConfirmationItems` | 必须人工确认项 |
| `decision` | 通过/退回 |
| `reason` | 原因说明 |

### 5.6 ChannelAdapter
| 字段 | 说明 |
| --- | --- |
| `eventParser` | 渠道事件解析 |
| `normalizer` | 标准化消息 |
| `responseFormatter` | 结果格式化 |
| `asyncDeliveryBoundary` | 异步发送边界 |

## 6. 部署与边界
### 6.1 部署模式
- 默认按内网/私有部署设计
- 不按公网多租户或开放 SaaS 设计

### 6.2 安全边界
- 文件、执行记录、审计结果默认在受控环境中存储
- 模型调用必须经过 Model Gateway，不允许前端直连模型
- 所有对外承诺类内容必须被打上“待确认”标签
- 不向未授权外部系统发送客户资料

### 6.3 渠道边界
- Web 工作台是 V1 标准入口
- Feishu、Slack、企微等后续统一走 `Channel Adapter -> Normalized Request -> Core Agent`
- 渠道层不共享渠道协议，但共享核心服务与执行对象

## 7. V1 模块拆分建议
- `workspace`: 页面工作台
- `skills`: 技能目录与技能模板
- `execution`: 编排、执行请求和执行链路
- `parsing`: 文件解析与抽取
- `review`: 审核与审计
- `channels`: 多入口适配
- `model`: 模型网关和提示词资产
