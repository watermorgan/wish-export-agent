# PDF 标注布局策略设计

## 1. 问题

当前布局决策的核心困难不是"全页翻译 vs 全放右侧"的二选一，而是：

- 内容少时，应该贴近英文旁边（近场旁注）
- 内容多时，应该退到右侧栏或补充 review 页
- **不知道"多少算太多"**——阈值依赖文档类型、页面留白、bbox 密度

## 2. 分层决策模型

### Level 1：近场旁注（优先）

译文直接放在英文原文最近的空白处。

**触发条件**：
- `noteCount <= config.byDocumentType[type].nearFieldThreshold`
- 每条 note 的近场候选位置不与原文 bbox 或已放置中文重叠
- 页面 `freeSpaceRatio >= config.levelDecision.minFreeSpaceRatio`

**特点**：
- 最佳可读性——工厂人员可以直接对照
- 但在 note 多或空白少时会失败

### Level 2：右侧说明栏 / 侧边面板

单条 note 在近场放不下时，降级到页面右侧 marker + 说明栏。

**触发条件**：
- 单条 note 近场空间不足
- 但整页尚未触发 dense 模式

**特点**：
- 仍在同页可见
- 需要 marker 编号做对照

### Level 3：补充 review 页

整页 note 太多，连侧边栏也放不下。

**触发条件**：
- `noteCount > config.byDocumentType[type].densePageNoteThreshold`
- 或 `bboxDensity > config.levelDecision.bboxDensityThreshold`
- 或侧边栏 overflow

**特点**：
- 原页只保留 marker 编号
- 中文详情在补充审阅页

## 3. 决策指标

| 指标 | 计算方式 | 最适合判断什么 |
|------|----------|---------------|
| `noteCount` | 该页 business note 数量 | 粗粒度拥挤度 |
| `avgZhLen` | 该页所有 note 的平均中文字符数 | 单 note 大小 |
| `bboxDensity` | Σ(bbox 面积) / 页面面积 | 原文占用多少空间 |
| `freeSpaceRatio` | 1 - bboxDensity - marginRatio | 可用空白 |
| `overlapRisk` | 候选位置与已有 bbox 的重叠率 | 精确判断"放不放得下" |

**最适合决定阈值的指标**：`noteCount` × `avgZhLen` 的组合效果最好——单用 `noteCount` 会忽略短 note 页实际很宽松的情况。

## 4. 按文档类型分策略

| 类型 | 特点 | 策略侧重 |
|------|------|----------|
| `sketch_comment` | 空白多、note 少但可能分散 | 大幅放宽近场阈值，优先贴近原文 |
| `mixed` | 变化大、sketch 页和 table 页混合 | 中等阈值，按页级分治 |
| `tp_bom_table_heavy` | 表格密集、空白极少 | 快速降级到 dense/review |

参数详见 `config/layout-config.json`。

## 5. 样本校准方法

### 5.1 数据收集

对 `data/test02` 的每个样本、每一页，提取：

```json
{
  "sample": "M422123",
  "page": 1,
  "documentType": "sketch_comment",
  "noteCount": 12,
  "avgZhLen": 8.5,
  "bboxDensity": 0.22,
  "freeSpaceRatio": 0.45,
  "renderResult": {
    "nearFieldPlaced": 12,
    "sidebarPlaced": 0,
    "reviewOverflow": 0,
    "anyOverlap": false
  },
  "humanJudgment": "all_near_field_ok"
}
```

### 5.2 校准步骤

1. 对所有页面指标做统计，找到 `noteCount` 和 `bboxDensity` 的分布
2. 标注 ground truth：哪些页"近场足够"，哪些页"应该退侧栏"
3. 用简单决策树拟合阈值分界线
4. 验证：新阈值下，所有已知"近场 OK"的页仍然走近场，所有已知"应该退"的页确实退了

### 5.3 最小实现

```bash
# 第一步：提取页面指标（dry-run，不改 PDF）
npx tsx scripts/calibrate-layout-params.ts --mode extract --output tmp/layout-metrics.json

# 第二步：人工标注 humanJudgment（编辑 JSON）

# 第三步：拟合并输出推荐参数
npx tsx scripts/calibrate-layout-params.ts --mode fit --input tmp/layout-metrics.json --output config/layout-config.json
```

## 6. 接入路径

### 6.1 Python 侧 (`render_feedback_pdf.py`)

当前 `DENSE_PAGE_NOTE_THRESHOLD` 等硬编码常量改为从 `config/layout-config.json` 读取：

```python
import json
CONFIG_PATH = Path(__file__).parent.parent / "config" / "layout-config.json"
_config = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}

def get_layout_param(doc_type: str, key: str, default):
    by_type = _config.get("byDocumentType", {}).get(doc_type, {})
    return by_type.get(key, _config.get("global", {}).get(key, default))
```

### 6.2 TS 侧 (`translation-pipeline.ts`)

`shouldUseInlineAnnotatedNote` 中的 `combinedLength > 140 || zh.length > 26` 改为从配置读取。

### 6.3 环境变量覆盖

保留现有 `FEEDBACK_RENDER_INLINE_NOTES` 等环境变量作为 override，JSON 配置作为 baseline。

## 7. 暂不做

- 不做页面级 AI 布局决策（让模型决定布局）
- 不做动态字体大小调整
- 不做跨页内容合并/重排
