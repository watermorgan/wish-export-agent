# Project Plan

## Status Board

### Done

1. 项目范围与原则收口
- 状态：已完成

2. 产品文档阅读与现状审计
- 状态：已完成

3. V1 功能需求细化
- 状态：已完成

4. 页面与状态规格整理
- 状态：已完成

5. 架构文档补充 ASCII 图
- 状态：已完成

6. 技能目录与模板骨架
- 状态：已完成

7. 执行编排 mock 骨架
- 状态：已完成

8. Web 工作台重构
- 状态：已完成

9. 任务资源 API
- 状态：已完成

10. PostgreSQL 持久化接入
- 状态：已完成

11. 数据库初始化脚本
- 状态：已完成

12. 任务持久化模型升级
- 状态：已完成

13. 实库验证
- 状态：已完成

14. 构建与校验
- 状态：已完成

15. P0 前端确认项操作面板
- 状态：已完成
- 说明：工作台已支持待确认项的确认/退回操作，并与后端状态守卫联动。

16. P1 审核历史与审计留痕基础展示
- 状态：已完成
- 说明：工作台已展示审核历史、审核意见和审计摘要，支持任务回查。

17. 首个真实案例评测规范 (Case-001)
- 状态：已完成
- 说明：已定义 `data/feedback-translation/case-001/` 的标准答案规范、评测 Rubric，并完成了 Translator/Merger 的 Prompt 精调。

### Doing

1. `memory/` 目录重构与漂移修复 (P0)
- 状态：进行中
- 说明：已完成核心文件收缩，正在修复与现有代码状态机的描述漂移。

### Todo

#### P0: 核心闭环与解耦
1. 技能目录外部文件加载器 (Markdown 化)
- 说明：当前已完成 manifest 静态 import，仍需将 `prompt.md` 接线至真实执行引擎 (`execution.ts`)。

#### P1: 运营与留痕
1. 模板发布与版本管理
- 说明：支持数据库存储模板，支持主管微调并发布。

#### P2: 记忆与扩展
1. 结构化业务记忆
- 说明：建立客户库、术语库、偏好库，优先通过 SQL 精确匹配。
2. 真实文件解析与模型执行接入
- 说明：从 mock 转向真实 LLM 调用和文件解析。
3. `pgvector` 混合检索
- 说明：在真实数据丰富后，引入语义检索增强。
4. 渠道适配器标准化与飞书接入
- 说明：标准化 Adapter 契约，支持 V1.1 扩展。

## Work Breakdown

### Frontend
- [x] 待确认项逐项编辑与确认 UI (P0)
- [x] 审核历史与审计留痕 UI (P1)
- [ ] 审核队列独立页面 (P1)
- [ ] 模板管理页面 (P1)

### Backend
- [x] 待确认项细粒度更新 API (P0)
- [x] 状态迁移守卫逻辑 (P0)
- [ ] 技能目录外部文件加载器 (P0)
- [ ] 模板持久化与版本管理 API (P1)
- [ ] 结构化记忆服务 (P2)
- [ ] 真实解析器集成 (P2)
- [ ] 真实 LLM Orchestrator (P2)

### Database
- [ ] 确认项动作历史表 (P1)
- [ ] 模板版本表 (P1)
- [ ] 客户/术语/偏好表 (P2)
- [ ] `pgvector` 扩展与索引 (P2)

## Recommended Next Steps

1. **文档防漂移**：完成 `memory/` 目录下状态机、路径引用和导出规则的修复。
2. **页面扩展**：补独立审核队列和模板管理页面。
3. **Prompt 接入**：将 `skills/*/prompt.md` 接入真实执行链（`execution.ts`）。

## Team Vibe-Coding Protocol

### Source Of Truth

1. 本文件是当前 Codex / Gemini / 人工分工的统一执行基线。
- 说明：所有任务分派、优先级调整、完成判定，默认都以 `plan.md` 为准。

2. V1 边界不得被擅自扩大。
- 说明：仍然只服务业务员和主管，以 Web 工作台为主入口，不引入自动报价、自动外发、自动写 ERP / CRM。

3. 当前优先级保持稳定。
- 说明：P0 仍然是“待确认项闭环 + 状态迁移守卫 + 技能解耦第一阶段”。

### Role Split

1. Codex 负责主实现与最终收口。
- 范围：核心 API、数据库 schema、状态机守卫、前后端联调、构建修复、实库验证、最终集成。

2. Gemini 负责可并行的方案和草稿产出。
- 范围：页面结构建议、技能声明文件草案、Prompt 拆分、`memory/`/`skills/` 文档化内容、可独立的代码草稿。

3. 影响状态机、持久化和审核流的最终合入标准，以 Codex 实现为准。
- 说明：避免双边同时改同一条主链路导致模型漂移。

### File Ownership

1. Codex 优先负责核心文件。
- `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/task-store.ts`
- `/Users/weitao/Documents/buildworld/aigc/export-agent/src/lib/assistant/db.ts`
- `/Users/weitao/Documents/buildworld/aigc/export-agent/src/app/api/tasks/`
- `/Users/weitao/Documents/buildworld/aigc/export-agent/src/components/workspace.tsx`

2. Gemini 优先负责非冲突区域。
- `/Users/weitao/Documents/buildworld/aigc/export-agent/docs/`
- `/Users/weitao/Documents/buildworld/aigc/export-agent/skills/`
- `/Users/weitao/Documents/buildworld/aigc/export-agent/memory/`
- 新增的技能声明文件、页面文案草稿、测试用例草稿

3. 不要让 Codex 和 Gemini 同时修改同一核心文件。
- 说明：如果 Gemini 需要动核心文件，应先说明目标、影响面和假设，再由 Codex 决定是否合并。

### Task Assignment Rules

1. 每次任务分派必须边界清晰。
- 推荐格式：`Task`、`Files`、`Assumptions`、`Output`、`Verification`。

2. 可并行的任务优先分配给 Gemini。
- 示例：`skills/` 目录规范草案、技能 Markdown 拆分、`memory/` 收缩、审核历史页面结构稿。

3. 关键闭环任务优先分配给 Codex。
- 示例：确认项 PATCH API、状态迁移守卫、数据库迁移、任务详情真实读写、审计链路联调。

4. 任何输出如果与 `plan.md` 冲突，默认以 `plan.md` 为准。

### Handoff Format

1. Gemini 向 Codex 交付时建议使用固定格式。
- `Task`: 本次任务目标
- `Files`: 涉及文件
- `Assumptions`: 前提假设
- `Output`: 产出内容
- `Risks`: 风险或冲突点
- `Verification`: 验证方式

2. Codex 合入前的检查标准。
- 是否符合当前 P0 / P1 / P2 优先级
- 是否突破 V1 边界
- 是否与现有状态机或 schema 冲突
- 是否具备最小验证路径

### Definition Of Done

1. 代码任务完成必须满足以下条件。
- 已落仓库
- 与 `plan.md` 一致
- 不突破 V1 边界
- 至少通过 `npm run lint`

2. 核心代码路径的完成标准更高。
- 涉及运行路径：尽量通过 `npm run build`
- 涉及数据库写入：至少完成一次实库验证

3. 文档任务完成必须满足以下条件。
- 文件位置明确
- 范围清晰
- 能直接被后续实现消费

### Current Suggested Parallel Split

1. 交给 Codex
- 确认项细粒度 PATCH API
- 状态迁移守卫
- 任务详情真实读写收口

2. 交给 Gemini
- `skills/` 目录规范和技能声明式文件草案
- Prompt 从 `catalog.ts` 外置的首版草案
- 审计留痕和确认项编辑 UI 的结构稿

3. 共同后续推进
- 模板版本管理
- 结构化记忆
- 真实解析器和真实模型执行
