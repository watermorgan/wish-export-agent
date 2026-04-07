# 验收准则 (Acceptance Criteria) - Export Agent V1

## 1. 适用范围

本文档定义当前仓库 V1 的工程与产品验收底线。所有 UI、API、workflow 与文档调整都应以当前代码真实状态机、真实 schema 与 V1 边界为准，不得继续沿用已废弃字段或旧状态名。

## 2. V1 核心行为准则

- **人工干预优先**：系统负责整理、翻译、草拟，不负责替用户做商务决策。
- **显式待确认**：任何涉及价格、交期、认证、付款、物流等商业承诺的信息，在未人工确认前都必须显式标记为待确认。
- **原子化执行**：技能必须由用户显式触发，不允许无确认自动串联连续执行。
- **原文保留优先**：翻译链必须保留英文原文，不得把负面意见美化、改写为结论或删除责任信息。

## 3. 明确的验收标准

### 3.1 技能实现

- **BOM 整理**：
  - 输出必须包含结构化物料字段。
  - 对不确定项必须显式标记为待确认，不得自行补齐。

- **意见翻译与归并**：
  - translator-only 场景必须能生成“英文原文 + 中文翻译”的结构化结果。
  - 若叠加 `comment-merger`，翻译阶段仍应先执行；归并可作为后续步骤继续消费翻译结果。
  - 价格、交期、认证、付款、物流、不确定表述命中时，必须进入待确认项。

- **客户回复草拟**：
  - 输出只能是草稿，不得直接对外发送。
  - 核心商务条款必须保留待确认语义。

### 3.2 UI 交互

- 确认项状态必须使用当前真实模型：
  - `required`
  - `recommended`
  - `confirmed`
  - `returned`
- 未确认项必须有清晰视觉区分。
  - 当前样式基线为 `.confirmation-item.status-required`、`.status-returned`、`.status-recommended`
- 用户必须能对确认项执行“确认 / 退回”。
- 审核历史、审计摘要和任务状态必须可回查。

### 3.3 数据与 API

- `AssistantReply` 必须包含：
  - `pendingConfirmations`
  - `artifacts`
  - `auditTrail`
  - `status`
  - `reviewStatus`
- 当前 metadata 基线为：
  - `metadata.needsHumanReview`
  - 可选 `metadata.providerHits`
  - 可选 `metadata.translationMode`
- 若后续系统需要兼容 snake_case，应通过兼容映射实现，而不是在当前代码中混用两套命名。

### 3.4 工作流门控

- 任务状态机必须对齐 `TaskStatus`：
  - `draft`
  - `validating`
  - `blocked`
  - `pending_user_confirmation`
  - `pending_supervisor_review`
  - `approved`
  - `returned`
  - `exported`
  - `archived`
  - `failed`
- 提交审核前必须清空所有 `required` 与 `returned` 确认项。
- 只有 `approved` 后才能导出正式产物。

## 4. 明确的禁止行为

- **NO_AUTO_SEND**：禁止任何真实的自动外部发送，包括 Email、Feishu、Slack、企微、WhatsApp。
- **NO_AUTO_WRITE_DB**：禁止自动写入外部 ERP / CRM，仅允许导出、复制或人工同步。
- **NO_LOOP_EXECUTION**：禁止无人工确认的自动循环、递归、自主连续执行。
- **NO_DECISION_MAKING**：禁止在信息缺失时猜测价格、交期、付款方式、认证结论或物流安排。

## 5. 审核与人工确认要求

- 业务员可以：
  - 发起任务
  - 编辑任务输入
  - 处理确认项
  - 提交审核
- 主管可以：
  - 审核通过
  - 退回任务
  - 决定任务是否可导出
- 所有人工确认或审核操作都必须保留时间与审计痕迹。

## 6. 翻译链专项要求

- 翻译执行必须优先基于结构化 source，而不是直接把整份原始 PDF 字节流送给模型。
- translator-only 与 translator+merger 都应优先走真实 translator 阶段。
- PDF feedback 主链默认优先走 `pdf-pipeline`；页面选择的翻译模型必须真实传递到 pipeline，而不是只改变前端显示。
- A 模型与 B 模型必须解耦：
  - A 模型负责 OCR / 多模态识别 / 位置补强
  - B 模型只负责结构化 segment/block 翻译
- 若启用本地 OpenAI-compatible 模型：
  - A 模型仅在本地实例明确支持 image input / multimodal / mmproj 时才可替代线上视觉模型
  - 本地 `llama.cpp` / OpenAI-compatible 部署必须稳定把最终答案写入 `choices[0].message.content`
  - 若只返回 `reasoning_content` / `thinking` 而没有最终 `message.content`，则视为不满足主链接入条件
  - 若频繁返回 `finish_reason=length`，则视为部署侧输出预算不足，不满足稳定上线条件
  - B 模型允许优先走本地以节省线上 token，但应允许更高 `max_tokens` 与更保守 batch，避免 reasoning 内容挤占最终 JSON 输出
- 对 `sketch_comment` 且文本层稀疏的页面，必须强制触发整页视觉识别；不得因为抽到少量 header 文本就判定“无需 OCR”。
- 规则型 pending 兜底至少应覆盖：
  - 价格
  - 交期
  - 认证
  - 付款
  - 物流
  - “无法确定 / not sure / to be confirmed” 类表达
- PDF 输出必须保证业务可确认性：
  - 中文结果优先放同页空白区或原文附近的页内标注
  - 稀疏页不应默认退化成整页右侧说明栏
  - 密集页允许下沉到补充 review 页，但不得破坏原页主可读性
  - 正式 PDF 默认不得附加 `Unassigned Notes` 诊断页
  - 正式 PDF 不应渲染低业务价值页眉/状态元信息，例如 season、`EN ATTENTE`、`DOSSIER STYLE` 之类标题栏
  - 从 pipeline 导出到 `response.json` 的 helper / 中间脚本必须保留 OCR `bbox`；若丢失 `bbox` 导致已翻译业务块无法页内落标，则视为未通过验收
  - 正式 PDF 下载接口不得仅因 task 目录里已存在旧 `annotated.pdf` 就直接复用；若当前 structuredData / renderer 已更新，必须重新渲染，避免业务看到历史旧稿
  - 正式 PDF 的重渲染必须基于冻结的 `translation_snapshot_v1`；渲染层不得再依赖旧 `sections` 结构，也不得通过重跑 A/B 来“顺带刷新内容”
  - 第一阶段收口后，B 模型稳定性必须有固定样本门槛：至少应通过 `npm run smoke:pdf` 这类冒烟检查，并显式记录 `translatedSegmentCount`、`zhPopulationPct`、`bModelBatchJsonOk/bModelBatchAttempts`、`bModelLastErrorKind`
  - 若主 B 在当前环境整轮未产出中文，允许切一次有界备用 B；但必须显式记录 `bModelFallbackUsed` 与最终 `bModelActiveModel`，并在页面/报告中提示这是备用路径，不得伪装成主模型稳定通过
  - 若主 A 在当前环境触发但未完成 OCR，允许切一次有界备用 A；但必须显式记录 `aModelFallbackUsed` 与最终 `aModelActiveModel`，并在页面/报告中提示这是备用路径
  - `npm run smoke:pdf` 默认为快速集；`npm run smoke:pdf:full` 用于较慢但更接近真实环境的全量集。默认开发回归不得直接依赖全量集，避免把在线配额波动误判成脚本不可用
  - `smoke:pdf:full` 的通过标准当前是“在有界时间内稳定产出中文且 B 解析稳定”，不等同于“业务最终覆盖率已足够高”；表格重样本和 mixed 样本仍需结合 `test02` / 人工稿继续评估
  - `smoke:pdf` / `businessPreviewReady` 的通过判断不得只看所有 segment 的总中文覆盖率；必须额外按“未被 annotated suppress 的业务 segment”计算 `businessSegmentCount / translatedBusinessSegmentCount / businessTranslationCoveragePct`。仅当业务条目达标时，才可判定为可给业务预览
  - 当 `maxSegmentsForTranslation` 存在上限时，A 模型补强得到的 `vision` segments 不得被文本层长页完全挤掉；至少应保留一小部分 vision 配额进入 B 翻译
  - 在 vision 配额之外，允许再做一个小而有界的第二阶段 vision 补翻窗口，用于补译首轮预算未覆盖但业务价值高的 OCR 段；该阶段只能追加翻译，不得改写首轮已产出的 segment/zh 映射
  - 对 `mixed` 且最终走 annotated 输出的样本，B 选段时应优先保留一部分 `pageLayoutType=sketch` 的 segment 预算；否则 table/reference 页残片会系统性吞掉 sketch 批注预算
  - 对 `mixed` 文档，自动整页 vision 触发当前只应优先覆盖其中的 `sketch` 页；`reference` / `mixed` 页默认仍由 early-gate / low-confidence 诊断驱动，避免 reference 页规格残片把 vision 噪音大幅抬高
  - 对 `mixed` 且最终走 annotated 输出的样本，`table/reference` 页的条目不得默认原样进入正式稿；除非属于明显结构/工艺变更类批注，否则应在 annotated 层 suppress，避免表格碎片和参考页规格残片污染正式 PDF
  - 对 `mixed` 文档，当前允许主输出仍为 annotated，但必须额外提供一份 `table/reference` 页补充 bundle（xlsx / table-style pdf）；否则业务会在“正式稿干净”和“表格信息可追溯”之间二选一
  - 页内蓝色中文标注不得覆盖或压住原始英文；若原文附近放不下，必须外移或降级到补充区域
  - 对服装款式图、结构示意图、尺寸框等易误导区域，正式 PDF 默认不得再用浮动蓝字直接覆写原页；应优先使用小号 marker + 页外说明栏 / review 页
  - 正式 annotated 的 marker 锚点不得机械固定在 `bbox.x0` 左侧；对宽文本块应优先放在框上方居中，对竖向长条 callout 应优先贴近条带中部，避免出现 marker 明显脱离原始英文位置
  - 当单页 business note 数量已明显拥挤时，正式 annotated 应自动切到 dense 分组模式：同一业务框里的连续 OCR 行应尽量合并成区间标号，并通过 review 页承接详情；不得继续把 `7,8,9,10,11...` 这样的长串小号直接堆在原页上
  - `FITTING / VOLUME`、`SIZE ... BASE ...`、`common designated size` 这类尺码/版型框若只是原稿信息展示，不得当作中文翻译标注输出
  - B 模型结果允许先经过术语/风格归一后再进入正式 PDF；目标是稳定贴近服装工艺单人工稿表达，而不是完全保留模型自由发挥
  - 款号、SKU、style code、纯代码型文本不应作为中文翻译标注重复输出
  - 正式 annotated 输出不得把 `graphiste / styliste / buyer / ERP / price / sales / date / page header` 等管理元信息当作业务翻译候选；若进入页内蓝字或 comparison 候选，视为未通过
  - 同理，人员姓名、职能头衔、样式单页眉等非业务元信息不得继续占用 marker 编号；若会显著抬高单页标号密度，应优先 suppress
  - `data/test02` 的 AI vs 人工评测不得只按索引顺序并排比较；必须允许“一条 AI 批注对应多条人工短句”或“多条 AI 批注汇总对应一条人工短句”，否则会系统性低估真实业务覆盖率
  - 当前 `data/test02` gate 口径：
    - `m422123`、`m445033` 应作为 sketch/comment pass 标杆
    - `m415013`、`m441083` 至少达到 `warn`，否则视为术语/拆句/噪音控制仍未收敛
    - 阶段尾可给业务确认时，期望 sketch 四个代表样本达到：
      - `m422123`: `pass`
      - `m445033`: `pass`
      - `m441083`: `pass` 或高位 `warn`
      - `m415013`: `pass` 或至少 `referenceRecallPct >= 75` 且 `aiPrecisionPct >= 60`
    - `ata019-shell-jacket`、`hanna-lightweight-skirt`、`m4e002-soft-puffy-down-jkt` 至少达到 `warn`，否则不得宣称“全集通过”
    - `ata001-smock-jacket` 当前仅做 smoke，不进入人工参考 match gate
  - 对 sketch/comment 样本，若通过“短标签归一 + 噪音降级 + 一对多 comparison”后仍有大面积 unmatched，才判定为识别/翻译硬缺陷；否则应优先继续收敛术语和样式，而不是先换模型
  - 对 `mixed` 样本，comparison 不得直接按版面断行逐条硬比：
    - 允许人工参考中的相邻短句按语义合并后再匹配 AI 条目
    - 允许 AI 同行多列内容按 `|`/业务短标签拆成多个 comparison 候选
    - 但不得把逗号短句、规格残片、页眉元信息无限细拆，否则会虚高 `aiCandidateCount` 并误伤 precision
  - 对 `mixed` 样本，正式 annotated 与 comparison 候选都应优先保留：
    - 面料/里布/袋布/填充/拉链/按扣/版型/长度/结构改动
    - 应压掉 standalone `款号 / 成分 / 克重 / 幅宽 / 创建更新时间 / 版权 / Original Sample / 后视图` 等非人工稿主信息
  - `PROTO #1 / PROTO #2 / OP1 / OP2` 这类方案标签若在页面上可见，不得默认当成低价值字段抑制；对 sketch/comment 样本，它们属于可追溯的业务标签，应允许进入 `segments` / snapshot / comparison 主链
  - 对页级 vision OCR，请求端必须强制用当前目标页号重写模型回包中的 `pageNumber`，并生成本地稳定的 `regionId`；不得直接信任模型自填的 `pageNumber / regionId`，否则多页样本会出现批注挂错页，污染 comparison 和 page-level 选段
  - 对同一页的多种 vision fallback 模式（`full / focused / business_crop`），不得复用同一个 `regionId` 前缀；否则不同 OCR 结果会在 id 层互相覆盖，污染 B 的 `segment -> zh` 映射和 comparison 候选。至少应把 `mode` 编进 `regionIdPrefix`
  - 当 sketch/comment comparison 使用 AI 候选时，孤立 `颜色 / 面料` 与 `品牌 / 款名 / 客户 / 款号:` 这类标签或管理信息不得继续作为高价值候选参与匹配；否则会系统性拉低 precision，并掩盖真实业务短句是否已回到主链
  - 相反，`尺寸 / 版型 / 前袋 / 双针 / OP1 / OP2 / 刺绣 / 码标` 等短业务句必须保留为高价值 comparison 候选；若被 `attachment sample`、页眉或 reference sample 规则误杀，则视为比较口径缺陷
  - 对 sketch/comment comparison，`前身袋鼠兜，顶部缝合在身内`、`前袋缝在身内`、`双针加固` 这类同一业务点的相邻短句，允许通过 canonicalization 归到同一高价值候选；不得因为模型把“口袋位置”和“加固做法”写在同一句，就误判成未覆盖
  - 对 `m415013` 这类已确认 page1/page2 OCR 可回主链的样本，若新增 `right/lower crop` 仅增加主标/成分/克重等噪音而没有显著抬高 recall，应停止继续堆 page 级裁切模式，优先回到 comparison 候选与术语对齐
  - 对私网本地 vision fallback，请求超时不得简单伪装成“VPN 未连接”；需要区分 `AbortError/timeout` 与真实网络不可达。对本地多模态模型，vision timeout 也不得与线上模型共用过低默认值，否则会把“慢但可用”的 OCR 请求误判为失败
  - 对本地私有化多模态 fallback，允许单独使用更小的页图渲染尺寸；不得强制与线上 A 共用 `VISION_MAX_RENDER_SIZE`。若复杂 PDF 在本地模型上长时等待，应优先调小本地页图尺寸，而不是先牺牲线上识别分辨率
