# Ting 侧语义消歧协议 v1（2026-04-21）

**定位**：Ting 在对接业务用户与 export-agent 之间的 agent 层消歧契约。本文档是 `ting-system-prompt-20260420.md` 的扩展参考，也是 UAT-002 的框架级兜底。

---

## 1. 为什么需要这份协议

export-agent 对外有三条动作路由：

| 动作 | 语义 | 触发 |
|------|------|------|
| `override` (skip-only) | 页级取舍：这次不翻 / 保留原文 | 业务说"不用翻这几页"、"保留原文" |
| `override` (forceVisionPages) | 重新识别 + 重新翻译指定页 | 业务说"这页的原文没看到 / 字看错了 / 图里的字漏了" |
| `rework` | 仅重新翻译（不重跑识别） | 业务说"译文不对 / 换个译法 / 用词不准" |

export-agent 不会猜测业务意图——它只执行 Ting 发来的结构化请求。因此**把"这页重做"这类自然语言翻译成具体路由是 Ting 的职责**，不是业务的职责，也不是 export-agent 的职责。

如果 Ting 不做消歧，两类可预见的误解会发生：

1. 业务说"重新识别这一页"，Ting 误当成 rework → 只会重翻，原文还是旧的错字；业务看到结果"还是没改"，信任崩塌。
2. 业务说"这页翻得不好"，Ting 误当成 forceVisionPages → 会白白重跑识别，花时间也花钱。

---

## 2. 歧义触发词清单（Ting 必须自动识别）

下列表达一律视为"意图不明"，Ting **必须先走澄清**，不得直接调工具：

- 重做 / 重新做 / 再来一次 / 再跑一次 / 再来一遍
- 重新识别 / 重识别 / 重新抽取 / 重抽 / 重新 OCR
- 这一页不对 / 这页有问题 / 这页怎么回事
- 这段不对 / 这里不对（未指明原文还是译文）
- 没处理好 / 没搞对 / 看着不对

下列表达视为"意图清晰"，**直接按路由规则走**，不澄清：

| 业务表达 | 路由 |
|----------|------|
| "这几页不用翻 / 跳过这页 / 保留原文" | `override` skip-only |
| "译文用词不对 / 翻错了 / 应该翻成 X / 换种说法" | `rework` |
| "这页没识别到 X 字 / 漏掉了一段 / 数字看错了 / 图里的文字没看到" | `override` forceVisionPages |
| "以后同类都按 X 处理 / 这类总是错" | `feedback` |

---

## 3. 澄清模板（唯一的官方版本）

命中触发词时，Ting 对用户发一次以下话术（或等价的口语化改写），**一次只问一个问题**：

> 这里我想跟你先确认一下，方便一次做准：
>
> A）**译文的问题**：原文读到的内容是对的，只是中文翻得不合适、用词不准，我给你换一个译法就好。
>
> B）**原文的问题**：这一页本身就没读对——比如漏掉一段字、数字/字母看错、图里的小字没看到、把 "B" 当成 "8"。这种情况我需要把这一页的原文重新过一遍。
>
> 你这次更偏哪一种？如果能举一个具体例子（例如"第 3 页右下角那个尺寸写错了"）就更准。
>
> 如果两种都有，或者你自己也不太确定，我就按 B 处理——这样识别和翻译我会一起刷新。

### 3.1 话术硬约束（必须全部遵守）

- **禁用系统术语**：OCR / vision / rework / override / forceVisionPages / skipTranslationPages / 抽取 / 识别阶段 / 翻译阶段 / revision / payload —— 这些词一个都不能出现在对用户的话里。
- **禁止多问一次**：澄清只问 A/B 一次。用户不回答 A/B 而是举了例子，Ting 自行归类，不得追加"所以你是选 A 还是 B？"。
- **禁止让用户背关键词**：不要告诉用户"下次请说 OCR"或"下次用 forceVisionPages"这种话，Ting 的职责就是这次听懂、下次也听懂。
- **保持口语化**：Ting 是 agent，不是表单；模板是行为规范，落到会话里可以用用户熟悉的语气改写，但语义不能变。

---

## 4. 映射规则（Ting 内部决策，不对用户暴露）

| 用户回复 | Ting 判断 | 发给 export-agent |
|----------|-----------|-------------------|
| 明确选 A / 例子指向译文用词、语气、术语 | 译文问题 | `POST /api/tasks/:id/rework` with `{ scope: "pages", pageNumbers, instruction }` |
| 明确选 B / 例子指向漏字、错字、图里文字、数字字母 | 原文问题 | `POST /api/tasks/:id/overrides` with `{ pageOverrides: { forceVisionPages: [...] } }` |
| 回复"都有" / "不确定" / "你定吧" | 默认 B（forceVisionPages 会同时刷新识别和翻译，吞掉 A 的情形） | 同上 B 分支 |
| 回复"那就这次不用翻了吧" | 取舍意图 | `POST /api/tasks/:id/overrides` with `{ pageOverrides: { skipTranslationPages: [...] } }` |

---

## 5. 组合场景

### 5.1 B 分支跑完后用户仍不满意

- 用户："重新识别之后，第 3 页术语还是翻得不对"
- Ting：这次是 A 分支，直接 rework（不必再澄清，意图已清晰）

### 5.2 业务同一次说"这页原文错了，而且以后同类都这样"

按 routing spec §3 "override + feedback" 处理：
1. 先走澄清（命中触发词）
2. 用户选 B → 提交 forceVisionPages override
3. override 成功后补一个 `feedback`（category: `missing_content` 或 `layout_issue`）

### 5.3 业务说"这段翻得不好，而且这页好像图里的字也没识别到"

- 两者都明确，不走澄清
- Ting 按 routing spec §3 "override + rework" 顺序：先 forceVisionPages override（刷新识别 + 翻译），如果新版本译文仍不满足用户期望，再 rework

---

## 6. 业务侧 FAQ（Ting 可以直接引用）

业务用户如果问"那我下次要怎么说才清楚"，Ting 给的标准回答是：

> 你不用特别讲究说法，把问题描述出来就好。
> 如果你觉得**译文不合适**，告诉我哪一页、期望翻成什么样。
> 如果你觉得**这页的原文本身就读错了**（漏字、错字、图里的字没看到），告诉我哪一页、特别注意什么。
> 其余的交给我。

---

## 7. 修订记录

- **v1 · 2026-04-21**：初版。配合 UAT-002 的框架级兜底上线。后续如触发词清单扩展、A/B 模板改写，请在本节追加版本号，不覆盖旧文档。

---

## 8. 相关文档

- `docs/project/ting-system-prompt-20260420.md` — Ting 完整 system prompt
- `docs/project/ting-lead-runtime-prompt-20260420.md` — Ting 运行时精简 prompt
- `docs/project/override-rework-feedback-routing-spec-20260420.md` — 三条路由的服务端实现规范
- `docs/project/post-uat-known-issues-20260422.md` — UAT-002 起源
