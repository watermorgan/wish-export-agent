# CoPaw 代码库研究报告

> 研究日期: 2026-03-19
> 目的: 为 export-agent (外贸助手 AI 工作台) 项目提供架构参考和可复用能力分析

---

## 一、架构概述

### 1.1 技术栈

| 语言 | 占比 | 用途 |
|------|------|------|
| Python | 72.6% | 核心 Agent 逻辑、技能执行 |
| TypeScript | 21.1% | Console Web 界面 |
| 其他 | 6.3% | 配置、文档等 |

### 1.2 核心组件

| 组件 | 说明 |
|------|------|
| **AgentScope** | 底层 Agent 框架（ReAct agent、tools、memory）|
| **SKILL.md** | YAML front matter + Markdown 的技能自发现格式 |
| **ReMe** | 长期记忆实现 |
| **MCP Protocol** | Model Context Protocol 支持 |
| **Working Directory** | `~/.copaw/` 作为数据根目录 |

### 1.3 目录结构

```
~/.copaw/
├── skills/           # 自定义技能目录
│   └── *.md         # SKILL.md 格式文件
├── memory/           # 记忆存储
│   ├── vector.db    # 向量数据库
│   └── bm25.idx     # BM25 索引
└── MEMORY.md        # 长期记忆文件
```

### 1.4 多渠道适配器

CoPaw 支持以下渠道的统一接口：

- 钉钉 (DingTalk)
- 飞书 (Feishu)
- QQ
- Discord
- iMessage

---

## 二、可复用能力清单

### P0 - 必须实现 (Critical)

#### 2.1 SKILL.md 自动发现格式

```yaml
---
id: bom-organizer
name: BOM 整理
description: 将 BOM 数据整理成结构化格式
triggers:
  - bom
  - 物料清单
parameters:
  - name: input_format
    type: string
    default: excel
---

## 任务指令
你是一个专业的 BOM 整理助手...

## 输入格式
...

## 输出格式
...
```

**核心特性**：
- YAML front matter 定义元数据
- Markdown 编写指令
- 自动加载自定义技能目录
- 触发词匹配

#### 2.2 混合检索记忆系统

```python
# 检索策略：向量 + BM25 融合
def hybrid_search(query: str, k: int = 10):
    # 向量检索 (权重 0.7)
    vector_results = vector_store.search(query, k=k)
    
    # BM25 检索 (权重 0.3)
    bm25_results = bm25_index.search(query, k=k)
    
    # 融合排序
    fused = fuse_results(
        vector_results, 
        bm25_results,
        vector_weight=0.7, 
        bm25_weight=0.3
    )
    return fused
```

**优势**：
- 向量检索：语义相似性
- BM25：关键词精确匹配
- 融合排序：提升召回率和准确率

#### 2.3 任务状态机

```
draft → validating → blocked → pending_user_confirmation 
     → pending_supervisor_review → approved/returned 
     → exported → archived
```

**状态说明**：
| 状态 | 说明 |
|------|------|
| draft | 草稿，任务创建中 |
| validating | 验证输入数据 |
| blocked | 存在阻塞性问题 |
| pending_user_confirmation | 等待业务员确认 |
| pending_supervisor_review | 等待主管审批 |
| approved | 审批通过 |
| returned | 审批退回 |
| exported | 已导出 |
| archived | 已归档 |
| failed | 执行失败 |

---

### P1 - 重要能力 (High)

#### 2.4 人工确认节点

**业务员确认** (`pending_user_confirmation`):
```typescript
interface PendingConfirmation {
  id: string;
  label: string;        // 确认项标题
  reason: string;       // 需要确认的原因
  owner: 'user';        // 确认责任人
  status: 'pending' | 'confirmed' | 'rejected';
}
```

**主管审批** (`pending_supervisor_review`):
```typescript
interface ReviewRequest {
  taskId: string;
  summary: string;      // 任务摘要
  riskAlerts: RiskAlert[];  // 风险提示
  artifacts: Artifact[];    // 产出物预览
}
```

#### 2.5 审计追踪

```sql
CREATE TABLE task_audit_events (
  task_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, event_index)
);
```

**审计事件类型**：
- `task_created` - 任务创建
- `validation_completed` - 验证完成
- `confirmation_requested` - 确认请求
- `confirmation_responded` - 确认响应
- `review_submitted` - 提交审批
- `review_completed` - 审批完成
- `task_exported` - 任务导出

#### 2.6 多渠道消息格式化

```typescript
interface ChannelAdapter {
  // 格式化输出消息
  format(task: TaskSnapshot): ChannelMessage;
  
  // 解析输入消息
  parse(incoming: RawMessage): AssistantRequest;
  
  // 渠道标识
  readonly channel: 'dingtalk' | 'feishu' | 'qq' | 'discord' | 'imessage' | 'web';
}
```

---

### P2 - 增强特性 (Medium)

#### 2.7 定时任务调度

```python
# 使用 APScheduler 或类似库
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

@scheduler.scheduled_job('cron', hour=9, minute=0)
async def daily_report():
    # 每日报告生成
    pass
```

#### 2.8 云端记忆同步

- 支持本地优先策略
- 云端备份和同步
- 多设备记忆共享

#### 2.9 MCP 工具集成

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/root"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

---

## 三、关键代码模式

### 3.1 技能定义格式 (SKILL.md)

```yaml
---
# 元数据区
id: comment-translator
name: 评论翻译
version: 1.0.0
description: 将客户评论翻译成中文
author: export-agent-team
triggers:
  - 翻译
  - translate
  - 评论
parameters:
  - name: source_language
    type: string
    default: auto
    description: 源语言，auto 表示自动检测
  - name: target_language
    type: string
    default: zh-CN
    description: 目标语言
---

# 技能指令

你是一个专业的跨境电商评论翻译助手。

## 任务
将客户评论从外语翻译成中文，保持原意和情感色彩。

## 规则
1. 保留原文中的产品名称和型号
2. 保留数字和日期格式
3. 适当调整语序以符合中文表达习惯
4. 标注不确定的翻译

## 示例

输入: "The product arrived on time and works great!"
输出: "产品按时到达，非常好用！"
```

### 3.2 记忆检索实现

```python
from typing import List, Tuple
import numpy as np

class HybridMemoryStore:
    """混合检索记忆存储"""
    
    def __init__(
        self,
        vector_weight: float = 0.7,
        bm25_weight: float = 0.3
    ):
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight
        self.vector_store = VectorStore()
        self.bm25_index = BM25Index()
    
    async def search(
        self, 
        query: str, 
        k: int = 10
    ) -> List[MemoryItem]:
        """混合检索"""
        
        # 并行执行两种检索
        vector_task = self.vector_store.search(query, k=k*2)
        bm25_task = self.bm25_index.search(query, k=k*2)
        
        vector_results, bm25_results = await asyncio.gather(
            vector_task, bm25_task
        )
        
        # 融合排序 (RRF)
        return self._reciprocal_rank_fusion(
            vector_results, 
            bm25_results, 
            k
        )
    
    def _reciprocal_rank_fusion(
        self,
        vector_results: List[Tuple[str, float]],
        bm25_results: List[Tuple[str, float]],
        k: int
    ) -> List[MemoryItem]:
        """RRF 融合算法"""
        scores = {}
        rrf_k = 60  # RRF 常数
        
        for rank, (doc_id, _) in enumerate(vector_results):
            scores[doc_id] = scores.get(doc_id, 0) + \
                self.vector_weight / (rrf_k + rank + 1)
        
        for rank, (doc_id, _) in enumerate(bm25_results):
            scores[doc_id] = scores.get(doc_id, 0) + \
                self.bm25_weight / (rrf_k + rank + 1)
        
        # 按分数排序
        sorted_items = sorted(
            scores.items(), 
            key=lambda x: x[1], 
            reverse=True
        )
        
        return [self._get_memory_item(doc_id) 
                for doc_id, _ in sorted_items[:k]]
```

### 3.3 执行计划生成

```typescript
interface ExecutionStep {
  id: string;
  name: string;
  skillId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  summary: string;
}

function buildExecutionPlan(
  taskType: TaskType,
  selectedSkills: SkillDefinition[]
): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  
  for (let i = 0; i < selectedSkills.length; i++) {
    const skill = selectedSkills[i];
    steps.push({
      id: `step-${i}`,
      name: skill.name,
      skillId: skill.id,
      status: 'pending',
      summary: ''
    });
  }
  
  return steps;
}
```

---

## 四、Gap 分析 (export-agent vs CoPaw)

### 4.1 能力对比矩阵

| 能力 | CoPaw | export-agent | 状态 | 优先级 |
|------|-------|--------------|------|--------|
| 类型系统 | 动态 | ✅ 完整 (types.ts) | **超越** | - |
| 技能目录 | SKILL.md | ✅ catalog.ts | **对等** | - |
| 执行引擎 | ReAct Agent | ✅ execution.ts | **对等** | - |
| 持久化 | 文件 | ✅ PostgreSQL | **超越** | - |
| 人工确认 | ✅ | ✅ PendingConfirmation | **对等** | - |
| 审批流程 | ✅ | ✅ ReviewStatus (4状态) | **对等** | - |
| 审计追踪 | ✅ | ✅ task_audit_events | **对等** | - |
| API 路由 | ✅ | ✅ Next.js API Routes | **对等** | - |
| 多渠道 | 5+ | 🔄 formatters.ts 脚手架 | **差距** | P1 |
| 记忆系统 | ReMe | ❌ 无 | **差距** | P1 |
| SKILL.md 格式 | ✅ | ❌ TypeScript 定义 | **差距** | P2 |
| 定时任务 | ✅ | ❌ 无 | **差距** | P2 |

### 4.2 详细差距分析

#### 多渠道适配 (Gap: 中等)

**CoPaw 实现**：
- 完整的钉钉、飞书、QQ、Discord、iMessage 适配器
- 统一的消息格式转换层

**export-agent 现状**：
- `formatters.ts` 仅有脚手架代码
- 需要实现完整的渠道适配器

**建议方案**：
```typescript
// src/lib/channels/adapters/
├── base.ts           # 基类定义
├── dingtalk.ts       # 钉钉适配器
├── feishu.ts         # 飞书适配器
├── web.ts            # Web 适配器
└── index.ts          # 统一导出
```

#### 记忆系统 (Gap: 较大)

**CoPaw 实现**：
- ReMe 长期记忆框架
- 向量 + BM25 混合检索
- ~/.copaw/memory/ 持久化

**export-agent 现状**：
- 无记忆系统
- 每次请求独立处理

**建议方案**：
```typescript
// src/lib/memory/
├── store.ts          # 记忆存储接口
├── vector.ts         # 向量检索 (使用 pgvector)
├── bm25.ts           # BM25 检索
├── hybrid.ts         # 混合检索
└── index.ts          # 统一导出
```

#### SKILL.md 格式 (Gap: 小)

**CoPaw 实现**：
- YAML front matter + Markdown
- 自动发现和加载

**export-agent 现状**：
- TypeScript 代码定义
- catalog.ts 硬编码

**建议方案**：
- 保持现有 TypeScript 定义（类型安全）
- 可选：支持从 SKILL.md 文件导入

---

## 五、实施建议

### Phase 1 - 完善核心 (已完成 90%)

**已完成**：
- ✅ 类型系统 (types.ts)
- ✅ 技能目录 (catalog.ts)
- ✅ 执行引擎 (execution.ts)
- ✅ 数据库持久化 (db.ts, task-store.ts)
- ✅ 审批流程 (ReviewStatus)
- ✅ 审计追踪 (task_audit_events)
- ✅ API 路由

**待完成**：
- 🔄 前端工作台界面
- 🔄 导出功能实现

### Phase 2 - 渠道扩展 (预计 2 周)

**目标**：实现钉钉、飞书渠道适配器

```typescript
// 实现步骤
1. 定义 ChannelAdapter 接口
2. 实现 BaseChannelAdapter 基类
3. 实现 DingTalkAdapter
4. 实现 FeishuAdapter
5. 集成到 API 路由
```

**接口定义**：
```typescript
interface ChannelAdapter {
  readonly channel: ChannelType;
  
  // 格式化任务快照为渠道消息
  format(snapshot: TaskSnapshot): Promise<ChannelMessage>;
  
  // 解析渠道消息为助手请求
  parse(message: RawChannelMessage): Promise<AssistantRequest>;
  
  // 发送消息到渠道
  send(message: ChannelMessage): Promise<void>;
}
```

### Phase 3 - 记忆系统 (预计 2 周)

**目标**：实现基于 PostgreSQL + pgvector 的记忆系统

```typescript
// 实现步骤
1. 启用 pgvector 扩展
2. 创建 memory_items 表
3. 实现向量嵌入 (OpenAI embeddings)
4. 实现混合检索
5. 集成到执行引擎
```

**数据库 Schema**：
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON memory_items 
USING ivfflat (embedding vector_cosine_ops);
```

### Phase 4 - 生产优化 (预计 1 周)

**目标**：生产环境准备

- 定时任务（使用 node-cron 或 trigger.dev）
- 监控告警（集成 Sentry）
- 日志聚合
- 性能优化
- 安全加固

---

## 六、结论

### 6.1 项目进度评估

| 阶段 | 进度 | 说明 |
|------|------|------|
| 核心架构 | 90% | 类型、执行、持久化已完成 |
| 审批流程 | 100% | 完整实现 |
| 审计追踪 | 100% | 完整实现 |
| 渠道适配 | 20% | 仅有脚手架 |
| 记忆系统 | 0% | 未开始 |
| **总体** | **70%** | 核心功能完备 |

### 6.2 关键里程碑

```
[✅] M1: 核心类型系统        - 2026-03-15
[✅] M2: 执行引擎            - 2026-03-16
[✅] M3: 数据持久化          - 2026-03-17
[✅] M4: 审批流程            - 2026-03-18
[🔄] M5: 前端工作台          - 进行中
[  ] M6: 渠道适配器          - 预计 2026-03-25
[  ] M7: 记忆系统            - 预计 2026-04-01
[  ] M8: 生产部署            - 预计 2026-04-08
```

### 6.3 总结

export-agent 已经实现了 CoPaw 的**核心架构**，在以下方面甚至**超越** CoPaw：

1. **类型安全** - 完整的 TypeScript 类型系统
2. **持久化** - PostgreSQL 优于文件存储
3. **可维护性** - 清晰的模块划分

主要差距集中在：

1. **多渠道适配** - 需要实现钉钉/飞书等渠道
2. **记忆系统** - 需要引入向量检索增强上下文
3. **SKILL.md 格式** - 可考虑迁移到声明式技能定义（可选）

**建议优先级**：
1. 完成前端工作台（当前阻塞点）
2. 实现渠道适配器（P1）
3. 引入记忆系统（P1）
4. 生产环境优化（P2）

---

## 附录

### A. 参考链接

- CoPaw 官网: https://copaw.agentscope.io/
- CoPaw GitHub: https://github.com/modelscope/agentscope
- AgentScope 文档: https://agentscope.io/
- MCP Protocol: https://modelcontextprotocol.io/

### B. 相关文件

- `src/lib/assistant/types.ts` - 类型定义
- `src/lib/assistant/catalog.ts` - 技能目录
- `src/lib/assistant/execution.ts` - 执行引擎
- `src/lib/assistant/db.ts` - 数据库层
- `src/lib/assistant/task-store.ts` - 任务存储
- `src/lib/channels/formatters.ts` - 渠道格式化

---

*报告生成: Claude Code*
*最后更新: 2026-03-19*
