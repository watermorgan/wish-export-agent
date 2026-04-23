# comment-merger

**用途**：对翻译结果或原始意见做去重、冲突整理和主题分组。

## 输入假设

- 输入可以是 `comment-translator` 的原文/译文对照，也可以是业务员手工粘贴的意见列表。
- `taskType = 'feedback'`。
- 建议明确 `goal`：是做「按主题归并」、「冲突识别」还是「按优先级排序」。

## 输出契约

- `主题分组`：topic → 条目列表。
- `归并列表`：按 topic 去重后的清单，保留每条的来源链接。
- `冲突项`：同一 topic 下互相矛盾的意见对，以及建议的仲裁方向。

## 已知限制

- 主题分组对短、零散、语义相似的意见准确度最高；对长段意见的 topic 切分偶有错位。
- 不做跨语言术语对齐；如果需要术语口径一致，请先跑 `comment-translator`，再把结果交给本 skill。
- 不输出 `pdf_translation_skill_v1`（本 skill 不是翻译交付）。

## 失败模式

- 输入完全是图片（未经 OCR）：会直接要求先跑 `comment-translator` 或手动抽文本。
- 主题聚类失败（输入全是无法分类的短语）：返回单一 "Miscellaneous" 组并在 `冲突项` 中提示人工归并。

## 升级路径

1. 加入「主管偏好」输入：让主管能在 manifest 级别固定几个优先 topic，提升一致性。
2. 与 `customer-reply-drafter` 做数据传递：把主题分组直接交给回复草拟。

## 相关代码

- manifest：`src/skills/comment-merger/manifest.json`
- prompt：`src/skills/comment-merger/prompt.md`
