# PDF Translation Delivery

## Purpose

把 PDF 批注/工艺页翻译能力作为可复用 skill 使用，统一产出：

- 正式 PDF / 预览入口
- 结构化人工复核建议
- 稳定 skill 结果协议 `pdf_translation_skill_v1`

## When To Use

- 需要把 PDF 翻译能力交给代理直接调用
- 需要页面、任务系统、外部代理共享同一份结果协议
- 需要给业务员或工厂提供“可直接看图 + 知道哪里要人工确认”的结果

## Input

- PDF 文件
- 任务目标
- 可选 A/B 模型配置

## Output

- `pdf_translation_skill_v1`
- 正式 PDF / 预览 / 表格产物入口
- `humanReviewGuide`

## Current Invocation Pattern

1. 通过 `/api/assistant` 发起任务
2. 得到 `taskId`
3. 读取：
   - `/api/tasks/[taskId]`
   - 或更轻的 `/api/tasks/[taskId]/skill-payload`

## Stable Fields

优先消费：

- `summary`
- `artifactLinks`
- `humanReviewGuide`
- `snapshot`
- `diagnostics`

## Review Rule

如果 `humanReviewGuide` 存在：

- 优先看 `focusPages`
- 再看高优先级 `hints`
- 若 `diagnostics.businessPreviewReady !== true`，不得直接当完整终稿使用
