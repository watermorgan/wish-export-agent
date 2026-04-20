# 阿呆运维与优化 SOP

## 1. 角色定义

阿呆负责：

- 维护 export-agent 的 API / MCP / 状态机合同
- 消费 open feedback
- 判断哪些问题进入术语、规则、抑噪、布局治理
- 做证据化验证
- 回写处理结果

阿呆不负责：

- 代替 Ting 做业务问询
- 代替用户做页清晰度判断
- 自动把反馈直接升级成生产规则

## 2. 日常巡检节奏

### 每日

```bash
npm run service:health
npm run feedback:review -- --status=open
npm run feedback:review -- --status=open --priority=high
```

### 针对术语类

```bash
npm run feedback:review -- --status=open --category=term_correction
```

### 针对 PDF 主链稳定性

```bash
npm run smoke:pdf
npm run verify:pdf-e2e
npm run verify:ting-skill-payload
```

## 3. 处理流程

### Step 1. 收集证据

对每个 open case 先确认：

- 是否能定位到 `taskId`
- 是否有 `pageNumber`
- 是否有 `segmentId`
- 是否属于当前交付修正，还是长期治理问题

如果缺失上下文：

- 不补造字段
- 保持 feedback 可读，但按“证据不足”处理

### Step 2. 分类处理

#### `term_correction`

- 先进入候选，不直接改核心术语
- 命令：

```bash
npm run feedback:promote-terms
```

#### `translation_error`

- 优先检查 normalize / prompt / 分段策略
- 不自动升级为术语候选

#### `layout_issue`

- 优先检查 snapshot -> render 链路
- 核对是否属于 bbox、anchor、dense-page 策略问题

#### `missing_content`

- 检查 visionTargetPages、A 模型 fallback、B 模型覆盖率

#### `noise_content`

- 检查 suppress 规则和 comparison 候选过滤

## 4. 修复后验证

最小验证集：

```bash
npm run lint
npm run build
npm run test:feedback
npm run smoke:pdf
npm run verify:pdf-e2e
npm run verify:ting-mcp-server
```

按改动范围追加：

```bash
npm run verify:ting-service-cli
npm run verify:ting-skill-payload
npm run verify:async-task-submit
npm run eval:test02
```

验收要求：

- 不只看命令退出码，还要看输出是否证明了 claim
- 如果只修 feedback 逻辑，至少跑 `test:feedback`
- 如果动了 PDF 主链，至少跑 `smoke:pdf` + `verify:pdf-e2e`
- 如果动了 MCP / 外部适配层，至少跑 `verify:ting-mcp-server`

## 5. 回写处理结果

修复后必须执行 `feedback:resolve`，不要手改 JSON。

已解决：

```bash
npm run feedback:resolve -- \
  --id fb-YYYYMMDD-NNN \
  --status resolved \
  --action normalize_rule_update \
  --detail "Updated page suppression rule and verified with smoke:pdf" \
  --by adai \
  --commit <sha>
```

不处理：

```bash
npm run feedback:resolve -- \
  --id fb-YYYYMMDD-NNN \
  --status wont_fix \
  --action wont_fix \
  --detail "Insufficient evidence to reproduce" \
  --by adai
```

## 6. 与 Ting 的接口协作规则

- Ting 负责采集最小必要信息
- 阿呆不要求 Ting 解释内部技术原因
- Ting 提交的 override/rework/feedback 如果字段不足，服务端应返回结构化错误
- 阿呆负责维护路由矩阵和 schema，不把策略判断外包给 Ting

## 7. 上线前回归命令

### 合同与任务主链

```bash
npm run verify:async-task-submit
npm run verify:pdf-e2e
npm run verify:ting-skill-payload
```

### MCP 适配层

```bash
npm run verify:ting-mcp-server
npm run verify:ting-service-cli
```

### 反馈治理链

```bash
npm run test:feedback
npm run feedback:review -- --status=open
```

## 8. 事故处理

### MCP 适配层异常

先执行：

```bash
npm run service:preflight
npm run service:status
npm run service:sync-ting-mcp
```

### PDF 正式稿异常

先检查：

- `GET /api/tasks/:taskId/skill-payload`
- `GET /api/tasks/:taskId/translation-pdf`
- 是否缺失 `translation_snapshot_v1`

### feedback 堆积

先按高优先级与类别切片：

```bash
npm run feedback:review -- --status=open --priority=high
npm run feedback:review -- --status=open --category=term_correction
```

## 9. 交付记录要求

每次处理完成都应在提交说明或运行记录中写明：

- 处理的 feedback id
- 属于 override/rework/feedback 哪一类后果
- 改了什么规则或契约
- 运行了哪些验证命令
- 哪些风险暂未覆盖
