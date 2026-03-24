# Vision-Assisted Extraction Phase 1 设计结论

## 一、设计结论（简短）

### 页面类型识别
- **先做**：轻量 heuristic，不做模型分类器
- 基于：行密度、数字/尺寸占比、标签模式、表结构节奏
- 输出：`sketch` | `table` | `reference` | `mixed`，供后续策略分流

### 视觉辅助抽取层
- **职责**：统一接口，输出 (pageNumber, region, text, bbox, confidence, sourceType)
- **第一版**：骨架 + fallback，不强制接真实 OCR，结构可后续接 provider
- **不接**：真实多模态/OCR 服务（P2）

### 融合层
- **职责**：把 text_layer 主链产出 + 未来 vision 产出合并，统一 `sourceType` 标记
- **第一版**：仅跑主链，融合层做占位逻辑（透传 text_layer）

### 进入结构化结果的信息
- 每 segment：`sourceType`、`layoutConfidence`、`mergeConfidence`、`regionId`
- 每页：`pageLayoutType`
- region/block 边界（供规则使用，不必全部透出到最终 schema）

### 先不做的能力
- 真实 OCR / 多模态 provider 调用
- 复杂页面区域切分（先按“整页 + 类型”分流）
- UI 完整展示置信度
- 单文档特判
