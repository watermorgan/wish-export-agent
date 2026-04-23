# export-agent

> AI 外贸工作台：把工艺单 / BOM / 客户意见 PDF 转成结构化双语交付物，并通过任务化闭环与 Ting 外贸助手、ADai 反馈系统打通。

**当前状态**：UAT 已通过（`docs/project/post-uat-known-issues-20260422.md`），Go-Live 可用。
**最新里程碑**：AI 披露 v1（`skillPayload.disclosure` + PDF 水印 + xlsx 披露 + UI Banner）。

## 快速启动

```bash
npm install
npm run dev              # http://localhost:3000
```

PostgreSQL 持久化（可选）：

```bash
export DATABASE_URL=postgresql://user:password@host:port/dbname
npm run db:init
```

支持两种 PostgreSQL 配置：`DATABASE_URL` 或 `DATABASE_JDBC_URL + DATABASE_USERNAME + DATABASE_PASSWORD + DATABASE_NAME`。

## 核心能力（按交付闭环看）

1. **PDF 翻译主链**：A 模型（视觉识别辅助）+ B 模型（结构化翻译），对 sketch/comment、TP/BOM、reference、structured xlsx 分别分流到 annotated PDF、bilingual xlsx、table-style PDF。
2. **任务化闭环**：创建任务 → 执行翻译 → 提交审核 → revision 迭代（override / rework / feedback）→ 审核通过交付。每次 revision 都可追溯，失败路径保留 `failedRevisionId` 与 `revisionLookupUrl`。
3. **三条外部接入通道**：
   - HTTP：`/api/tasks/*` REST 接口
   - Ting CLI：`scripts/verify-ting-service-cli.ts` 样例 + `ting_pdf_translation_v1` 结构
   - Ting MCP：MCP server 封装（详见 `docs/project/ting-pdf-skill-adapter-20260410.md`）
4. **AI 披露（v1）**：每份对外 payload 都带 `disclosure`（中英文 + 审核状态感知）；每页 PDF 页脚 + xlsx Summary + UI Banner 都落水印。详见 [AI 披露政策](./docs/product/07-ai-disclosure-policy.md)。
5. **反馈学习回路（ADai）**：人工修订经 feedback 路由回传，挖掘成术语 / 规则候选，进入 glossary 流程。

## 外部协议

- 对外 skill payload：`pdf_translation_skill_v1`（源头 `src/lib/assistant/feedback-translation.ts`）
- Ting 消费 wrapper：`ting_pdf_translation_v1`（源头 `src/lib/assistant/pdf-translation-skill.ts`）
- 三条业务路由契约：[`docs/project/override-rework-feedback-routing-spec-20260420.md`](./docs/project/override-rework-feedback-routing-spec-20260420.md)
- Ting 侧语义消歧协议 v1（业务只说业务语言，路由归 Ting）：[`docs/project/ting-disambiguation-protocol-20260421.md`](./docs/project/ting-disambiguation-protocol-20260421.md)
- 审核对象（task not revision）：[`docs/project/review-object-decision-20260420.md`](./docs/project/review-object-decision-20260420.md)

## 目录结构（关键位置）

- `src/app/api/tasks/*`：任务 HTTP 接口，包括 override / rework / revisions / translation-pdf / skill-payload
- `src/app/api/assistant/*`：工作台前端调用的 assistant 执行接口与 artifact 下载
- `src/components/workspace.tsx`：Web 工作台，内嵌 AI 披露 Banner
- `src/lib/assistant/`：翻译主链、任务存储、revision 管理、反馈处理、disclosure 常量
- `src/lib/channels/`：渠道扩展层（Feishu / Slack / 企微）
- `scripts/`：运行期辅助脚本与 verify 套件
- `data/`：业务样本归档（含 manifest）
- `docs/project/`：工程侧文档（路线图、路由契约、UAT 问题）
- `docs/product/`：产品文档（PRD、架构、AI 披露政策）
- `memory/`：角色约束、验收基线
- `skills/`：本地技能卡片

## 翻译链模型配置

参考 `docs/project/ting-service-stability-20260415.md` 与 `.env.example`。推荐：

```bash
# A 模型：视觉/OCR/多模态辅助识别
VISION_API_URL=http://172.16.71.201:8001/v1
VISION_MODEL=Gemma-4-31B-it

# B 模型：结构化 segment 翻译
TRANSLATION_API_URL=http://172.16.71.201:8001/v1
TRANSLATION_MODEL=Gemma-4-31B-it

# B 模型兜底（本地失败 / 空翻译自动切换）
B_MODEL_FALLBACK_NAME=openrouter/free
B_MODEL_FALLBACK_API_URL=https://openrouter.ai/api/v1
B_MODEL_FALLBACK_API_KEY=...

# AI 披露开关（仅影响渲染侧水印；payload 字段始终保留）
# EXPORT_AGENT_AI_DISCLOSURE=off
```

## 验证脚本

```bash
npm run lint
npm run verify:task-revision-flow          # revision 生命周期 & 失败路径 diagnostics
npm run verify:ting-service-cli            # Ting CLI 通道：payload + 失败诊断
npm run verify:ting-mcp-server             # Ting MCP 通道：payload + 失败诊断
npm run verify:ting-skill-payload          # 对外 skill payload 三层（helper/wrapper/HTTP）
npm run verify:disclosure-watermark        # AI 披露水印（PDF + xlsx + 开关）
npx tsc --noEmit                           # 类型检查
node --import tsx --test src/lib/assistant/__tests__/*.test.ts   # 单元测试
```

## 路线图

见 [`docs/project/plan.md`](./docs/project/plan.md)（四栏：Completed / In Progress / Backlog / Performance Milestones）。

## 产品文档索引

- [产品文档索引](./docs/product/README.md)
- [AI 披露政策](./docs/product/07-ai-disclosure-policy.md)
- [提示词包索引](./docs/prompts/README.md)

## 合作约束

继承自 `memory/acceptance-criteria.md`：

- 不允许把主链改成「整份 PDF 直接多模态翻译」；A 模型仅辅助识别。
- 不允许为任一单点样本写路径/文件名特判。
- 未完成的能力不得写成已完成；必须贴真实脚本输出作为证据。
- AI 披露不允许移除或默认关闭（详见披露政策 §5–§7）。
