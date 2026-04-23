# Override / Rework / Feedback 路由矩阵实现规范

## 当前实现状态

截至 2026-04-20：

- `override` 已通过 `POST /api/tasks/:taskId/overrides` 落地
- `rework` 已通过 `POST /api/tasks/:taskId/rework` 落地
- `feedback` 仍保持 `POST /api/feedback` + CLI 治理链
- `rework` 的当前执行语义是「把目标页/段转成 revision 控制并重新运行翻译阶段」，不重跑 vision / OCR，也不是 extractor 级增量计算；若要重新 OCR 请用 override 的 forceVisionPages（见 `docs/project/ting-system-prompt-20260420.md`）

## 1. 目标

给 Ting 和 export-agent 一个确定性路由规则，避免同类问题在不同会话里漂移。

三类动作定义：

- `override`：当前任务内页面级覆盖
- `rework`：当前任务内受控返工
- `feedback`：系统级学习输入

## 2. 主矩阵

### 走 `override`

满足全部条件时走 `override`：

- 只影响当前任务
- 用户给的是页面级或明确可表达的覆盖输入
- 不要求重新做知识沉淀
- 不要求重新 OCR / vision / 抽取 / 翻译
- 不涉及 forceVisionPages / force_vision

典型话术：

- 第 8/9 页太糊，可以不翻
- 这页保留原文，不要出中文
- 这页跳过翻译

禁止话术（必须走 rework）：

- 第 10 页请翻译（force_vision）
- 重新识别这一页
- 这页要重新抽取

### 走 `rework`

任一条件成立时走 `rework`：

- 需要重新 OCR / vision / segment 抽取
- 需要重新翻译现有内容
- 用户指出“翻错了，按这个意思重做”
- 当前问题不能仅靠页级显示抑制解决

典型话术：

- 第 10 页这段翻错了，重做
- 重新识别这一页，忽略页眉
- 只重翻这两个 segment

### 走 `feedback`

任一条件成立时走 `feedback`：

- 用户要求“以后都这样翻”
- 这是术语、规则、抑噪、布局类可复用知识
- 需要阿呆/开发侧进入长期治理

典型话术：

- 以后 `elasticated waistband` 一律这样翻
- 这类页眉以后都不要翻
- 这种布局总压字，需要系统优化

## 3. 组合规则

### `override + feedback`

场景：

- “第 10 页这次补翻；以后遇到同类图也优先翻”

处理：

1. 先执行 `override`
2. 再提交 `feedback`

原因：

- 当前交付优先
- 长期学习不能阻塞当前结果修正

### `rework + feedback`

场景：

- “这段现在重做；以后也按这个术语”

处理：

1. 先执行 `rework`
2. 再提交 `feedback`

### `override + rework`

场景：

- 同一页既要求补翻，又指出当前识别错误

处理优先级：

1. `rework`
2. 如果重跑后仍需页级强制包含/排除，再叠加 `override`

禁止直接同时并发执行两个动作。

## 4. 状态前置条件

### 允许执行 override / rework 的 task 状态

- `draft`
- `validating`
- `blocked`
- `pending_user_confirmation`
- `returned`

### 不允许直接执行 override / rework 的 task 状态

- `pending_supervisor_review`
- `approved`
- `exported`
- `archived`

处理规则：

- `pending_supervisor_review`：先撤回或等待主管退回，不在 Phase 1/2 自动支持
- `approved` / `exported`：新建 successor-task

## 5. 输入判定规则

### 页面级输入

当用户只给出页码且意图是：

- 不翻也可以
- 保留原文

则生成：

```json
{
  "pageOverrides": {
    "skipTranslationPages": [],
    "pageDirectives": []
  }
}
```

注意：`forceVisionPages` 和 `force_vision` 不允许出现在 override 中，请改用 rework。

### 当前 rework 输入边界

当前实现只接受页级 rework：

```json
{
  "scope": "pages",
  "pageNumbers": [],
  "instruction": ""
}
```

### 未来规则输入

当用户表达长期偏好时，生成：

```json
{
  "category": "term_correction | translation_error | layout_issue | missing_content | noise_content | general_quality",
  "source": {
    "taskId": "",
    "fileName": "",
    "pageNumber": 0,
    "segmentId": "",
    "sourceText": "",
    "currentTranslation": "",
    "expectedTranslation": ""
  }
}
```

## 6. Ting 侧最小决策树

1. 先问自己：用户是在修当前结果，还是在定义未来规则？
2. 若是修当前结果，再问：是否需要重新识别/重翻？
3. 只需页级控制就能解决：`override`
4. 需要重新抽取/重翻：`rework`
5. 可沉淀成未来规则：补一个 `feedback`

## 7. 冲突消解

### 同一页同时出现在 `forceVisionPages` 和 `skipTranslationPages`

判为无效请求，返回 400。

### `pageNumbers` 为空

判为无效 `rework` 请求，返回 400。

### `translation_error` 自动升级为术语候选

禁止。

只有 `term_correction` 才能进入 `feedback:promote-terms` 候选主链。

### 低清晰页是否自动 skip

禁止。

低清晰只是 `humanReviewGuide` 的建议来源，不是 override 的自动来源。

## 8. 服务端实现要求

- `override` 和 `rework` 都必须写入审计日志
- revision 必须记录 `parentRevisionId`
- 每次 revision 结果必须可通过 `taskId + revisionId` 追溯
- `feedback.source.taskId/pageNumber/segmentId` 为空时只能降级，不得伪造

## 9. 失败处理

### override 失败

- 保持旧 `currentRevisionId`
- task 不进入新状态

### rework 失败

- revision 状态标记 `failed`
- task 保持上一个可用 revision

### feedback 写入失败

- 不回滚已经成功的 override / rework
- 向 Ting 返回“当前交付已更新，但长期学习未写入”
