# Gemma4 Hybrid Comparison (2026-04-07)

## 范围

本轮对比只验证以下混合路径：

- A 模型：线上 `Qwen/Qwen3.5-35B-A3B`
- B 模型：本地 `gemma-4-31B-it-Q3_K_M.gguf`
- 本地额外参数：
  - `VISION_LOCAL_MAX_RENDER_SIZE=900`
  - `VISION_PAGE_RETRY_LIMIT=0`
  - `B_MODEL_MAX_TOKENS=900`
  - `B_MODEL_SEG_TEXT_MAX_CHARS=220`

目的不是验证“全本地 A/B”是否可替代线上，而是确认 `gemma4` 作为本地 B 时，能否在复杂样本上形成稳定、可比较的正式 PDF。

## 样本与产物

- 本地 hybrid 输出目录：
  - `.tmp/gemma4-hybrid-review/`
- 当前线上阶段版目录：
  - `.tmp/business-review-pdfs/`

## 结果摘要

| 样本 | Hybrid 结果 | 业务预览 | 结论 |
| --- | --- | --- | --- |
| `M422123` | `10/10` translated, business `6/6` | `ready` | 可用，但覆盖面明显低于当前阶段版 |
| `M441083` | `20/20` translated, business `12/12` | `ready` | 可形成可读 PDF，适合继续对比 |
| `M445033` | `9/24` translated, business `0/15` | `not ready` | 明显不足，不能作为业务预览替代 |
| `M415013` | `18/18` translated, business `0/0` | `not ready` | 形式上有中文，但没有形成有效业务预览 |

## 关键观察

1. 本地 `gemma4` 作为 B 模型时，已经不再是“完全不可跑”。
   - `M422123` 与 `M441083` 都能在有界时间内生成正式 PDF。

2. 但它还不能替代当前线上阶段版。
   - `M445033` 和 `M415013` 仍然没有形成有效 business preview。
   - 这说明问题不只是 token 或页图尺寸，而是本地 `gemma4` 在复杂 segment 批次上的稳定性与风格约束仍然不够。

3. 本轮 mixed / sketch 的瓶颈已经和主链架构无关。
   - Web 入口、snapshot、renderer 都正常。
   - 差距集中在 B 模型对复杂业务段的稳定输出能力。

4. 本地 vision 单图探针可用，但不等于本地整份 PDF 主链可用。
   - 单页图片请求能返回有效中文描述。
   - 真实 PDF 主链则需要同时处理多页、segment 预算、格式化输出，这仍然会暴露吞吐与稳定性问题。

## 当前判断

- `gemma4` 现在可以继续作为：
  - 本地 B 实验路径
  - 局部样本成本优化路径
- 但还不能作为：
  - 当前 sketch/comment 阶段版的默认替代模型
  - 复杂样本的正式默认本地 B

## 下一步建议

1. 若继续优化本地 `gemma4`：
   - 优先收 B 端 prompt / 结构化输出稳定性
   - 不要继续把主要精力放在本地多模态 A 上

2. 若目标是尽快拿到更多可对比结果：
   - 保持 `A 线上 + B 本地 gemma4`
   - 优先补 `M445033 / M415013` 的业务段选择和输出风格

3. 若目标是阶段性交付：
   - 当前仍以 `.tmp/business-review-pdfs/` 里的线上阶段版作为业务确认主基线
   - 本地 `gemma4` 输出只作为实验对比，不替代当前业务确认稿

## 纠偏补充：B-only 固定 A/segment 的对比（2026-04-07）

由于同日线上 A（ModelScope）实测返回 `401 Unauthorized`，直接跑新的 `A 线上 + B 本地 gemma4` 会让结果退化成“只有文本层页眉”，不适合作为可信对比。

因此新增了更可信的对比口径：

- 固定使用已成功 run 的 `pipeline-result.json`
- 复用既有 A 输出和同一批 `segments`
- 只替换 B 为本地 `gemma-4-31B-it-Q3_K_M.gguf`
- 再重写 snapshot 并重新渲染正式 PDF

对应脚本：

- `scripts/retranslate-pipeline-with-local-b.ts`

对应产物目录：

- 早期目录：`.tmp/gemma4-b-only-review/`
- refined 目录：`.tmp/gemma4-b-only-review-refined/`

### B-only 结果

| 样本 | translated | business | 业务预览 |
| --- | --- | --- | --- |
| `M422123` | `24/24` | `19/19` | `ready` |
| `M441083` | `46/46` | `38/38` | `ready` |
| `M445033` | `60/60` | `36/36` | `ready` |
| `M415013` | `48/48` | `30/30` | `ready` |

### refined 补充

- 在 `scripts/retranslate-pipeline-with-local-b.ts` 里补了两项约束后，又重跑了一轮 refined 版本：
  - 译文写回前先过 `normalizeFashionTranslation()`
  - 若阶段版对应 item 原本是空 `zh`，本地 B-only 结果也保持为空，不重新翻出 suppress 项
- refined 目录：
  - `.tmp/gemma4-b-only-review-refined-v3/`
- 这轮重跑后，4 个样本的“有效已翻条数”与阶段版完全一致：
  - `M422123`: `19 / 24`
  - `M441083`: `38 / 46`
  - `M445033`: `36 / 60`
  - `M415013`: `30 / 48`
- 这说明当前本地 `gemma4` 作为 B 的差异已经更可信地收敛到：
  - 术语更直译
  - 人工稿式短句压缩不足
  - 某些业务黑话（如 `顺色 / OP1 / OP2 / 新主标`）不如阶段版成熟
- 当前 refined-v4 的剩余差异量级：
  - `M422123`: `5` 条
  - `M441083`: `2` 条
  - `M445033`: `4` 条
  - `M415013`: `1` 条
- 这些差异已经主要是“译法选择”问题，不再是条目漂移或 suppress 失控

### 解释

- 这组结果反映的是：
  - 当 A 和 segment 集合固定为当前阶段版结果时
  - 本地 `gemma4` 作为 B 已经能完整承接 4 个 sketch/comment 代表样本
- 因此当前更准确的判断应拆成两层：
  1. **本地 `gemma4` 作为 B：可比较、可继续优化**
  2. **本地 `gemma4` 作为复杂样本的 A/B 全本地主链：仍不稳定**

### 结论

- 若目标是继续做“本地版 vs 当前阶段版”的翻译风格/术语差异比较，优先使用这组 **B-only 固定 A** 结果。
- 若目标是验证“是否可全量切到本地 gemma4”，当前答案仍是否定的。
- 具体术语/风格差异已整理到：
  - `docs/project/gemma4-b-only-diff-notes.md`
