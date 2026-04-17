# Feedback Learning Runbook

## 1. 适用范围

本文档描述当前已落地的 Phase 1 反馈闭环操作路径：

- Web 工作台在结果区提供反馈录入入口
- 服务端通过 `POST /api/feedback` 把反馈落盘到 `data/feedback-cases/`
- 开发侧通过脚本筛选反馈、提取术语候选，并手动把高价值结论转成规则或术语更新

当前阶段**不做**自动修复、自动回写 prompt、自动修改 glossary `core.json`。

## 2. 反馈入口

### 2.1 Web 工作台

当前工作台会在翻译结果区域挂载一个紧凑反馈入口，优先预填这些上下文：

- `fileName`
- `taskId`
- `pageNumber`
- `segmentId`
- `sourceText`
- `currentTranslation`

当前 UI 暴露的反馈类型：

- `translation_error`
- `term_correction`
- `layout_issue`

提交时前端会调用 `POST /api/feedback`，并默认带上：

- `reporter: "workspace-user"`
- `priority: "high"` for `translation_error`
- `priority: "medium"` for 其他当前 UI 类型

### 2.2 外部消费方 / 手工写入

- Ting / 其他外部消费方必须继续通过 HTTP 调用 `POST /api/feedback`
- 不允许外部方直接写本仓库文件系统
- 开发者若需要补录，可按 schema 手工创建 `data/feedback-cases/fb-YYYYMMDD-NNN.json`
- case 创建后，后续状态回写统一走 `npm run feedback:resolve`，不要继续手改 JSON

## 3. API 约定

### 3.1 写入接口

`POST /api/feedback`

最小示例：

```json
{
  "category": "term_correction",
  "source": {
    "fileName": "M422123.pdf",
    "sourceText": "Back elasticated waistband",
    "expectedTranslation": "后腰部橡筋"
  },
  "reporter": "workspace-user"
}
```

当前服务端行为：

- 请求体必须是 JSON
- 请求体上限是 `1 MB`
- 服务端会做标准化和文件名安全校验
- 成功后返回 `201` 和 `{ "id": "...", "path": "data/feedback-cases/....json" }`

### 3.2 落盘位置

- 原始反馈目录：`data/feedback-cases/`
- schema：`data/feedback-cases/schema.json`
- 术语候选暂存区：`data/glossary/candidates.json`

## 4. 开发侧日常操作

### 4.1 看新增反馈

```bash
npm run feedback:review -- --status=open
```

按优先级继续筛选：

```bash
npm run feedback:review -- --status=open --priority=high
```

只看术语纠正：

```bash
npm run feedback:review -- --status=open --category=term_correction
```

当前脚本输出格式为逐条摘要 + 汇总计数，例如：

```text
[high] fb-20260417-001 translation_error M422123.pdf Back elasticated waistband
total=1
```

### 4.2 提取术语候选

```bash
npm run feedback:promote-terms
```

当前脚本行为：

- 只读取 `status === "open"` 的反馈
- 从 `term_correction` 里抽取候选
- 合并写入 `data/glossary/candidates.json`
- 不直接修改 `data/glossary/core.json`

### 4.3 人工决策处理路径

开发者需要基于反馈类别手动决定进入哪条改进路径：

- `translation_error` -> 归一规则、翻译规则、术语核对
- `term_correction` -> 候选术语人工审核后再合入 glossary
- `layout_issue` -> 布局参数或渲染策略调整
- `missing_content` -> 选段、OCR、vision 预算或 suppress 规则检查
- `noise_content` -> suppress 规则收敛
- `general_quality` -> 产品体验问题归档

## 5. 处理完成后的回写

当前仓库提供 `feedback:resolve` CLI，用于安全回写处理结果。常见用法：

```bash
npm run feedback:resolve -- \
  --id fb-20260417-001 \
  --status resolved \
  --action normalize_rule_update \
  --detail "Aligned waistband wording with approved glossary phrasing" \
  --by dev-user \
  --commit abc1234
```

判定为不修复或重复问题时：

```bash
npm run feedback:resolve -- \
  --id fb-20260417-002 \
  --status wont_fix \
  --action duplicate \
  --detail "Duplicate of fb-20260417-001" \
  --by dev-user
```

CLI 行为：

- 只更新目标 case 文件，不需要手工编辑 JSON
- 自动写入 `resolution.resolvedAt`（也可显式传 `--resolved-at`）
- 要求 `resolved` case 使用真实修复动作
- 要求 `wont_fix` case 使用 `wont_fix` 或 `duplicate` 动作

推荐把 `commitRef` 指向实际落地改动，避免后续重复处理同一问题。

## 6. 冒烟操作

本阶段文档推荐的最小人工冒烟路径：

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
  --by smoke \
  --commit HEAD
```

预期结果：

- 开发服务器可启动
- `test:feedback` 通过
- `GET /api/tasks` 返回带 `tasks` 数组的 JSON
- `POST /api/feedback` 返回新建 case 的 `id`
- review 脚本能立即读到新写入的记录
- resolve CLI 会把目标 case 更新为带 `resolution` 元数据的最终状态
