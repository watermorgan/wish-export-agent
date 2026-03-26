# data/test02/（稳定业务回归数据集）

这是已恢复的业务级训练/验证数据集，包含原始工艺单与人工/业务翻译结果。

这批数据是后续以下工作的稳定输入：
- 自回归验证
- 抽取/翻译质量对比
- 导出效果人工复核
- Cursor / Codex 共享回归基线

## 推荐目录约定

- 当前目录根：只放稳定原始样本与人工参考件
- `manifest.json`：样本索引入口
- `runs/<run_id>/exports/`：当前算法实际导出的 HTML / PDF / XLSX
- `runs/<run_id>/samples/<sample_id>/pipeline-result.json`：每个样本的完整算法输出和中间结构
- `runs/<run_id>/reports/summary.json`：机器可读汇总
- `runs/<run_id>/reports/summary.md`：人工查看汇总
- `reviews/`：后续人工评分、复核记录、问题归档

原则：
- 原始业务资料和人工参考件不写入 `runs/`
- 算法产物、中间过程、临时评估结果都不回写到样本根目录
- `.tmp/` 继续只作为运行期缓存，不再当作正式归档

## 保护要求

- 不要把本目录样本迁回 `.tmp/`
- 不要把本目录作为“临时上传缓存”使用
- 不要随意重命名文件；如确需调整，先同步更新 `manifest.json`
- 新增样本时，按 `source_pdf / reference_pdf / reference_xlsx` 角色补齐到 `manifest.json`

## 当前样本

- `ata001-smock-jacket`
  - 仅有原始 PDF，当前无参考翻译件
- `ata019-shell-jacket`
  - 原始 PDF + 参考翻译 Excel
- `hanna-lightweight-skirt`
  - 原始 PDF + 参考翻译 PDF
- `m415013`
  - 原始 PDF + 参考翻译 PDF
- `m422123`
  - 原始 PDF + 参考翻译 PDF
- `m441083`
  - 原始 PDF + 参考翻译 PDF
- `m445033`
  - 原始 PDF + 参考翻译 PDF
- `m4e002-soft-puffy-down-jkt`
  - 原始 PDF + 参考翻译 PDF

## 使用方式

- 单独跑这批样本的全链路评估：
  - `npx tsx scripts/eval-fullchain.ts data/test02/manifest.json`
- 如果要和其他数据集一起跑：
  - `npx tsx scripts/eval-fullchain.ts data/test02/manifest.json data/local/manifest.json`
- 用当前算法对 `test02` 跑一轮稳定归档：
  - `npx tsx scripts/run-test02-regression.ts data/test02/manifest.json`
  - 或 `npm run eval:test02`

## 说明

- `manifest.json` 是这批数据的正式索引入口
- `runs/` 是算法输出与中间过程的正式归档区
- `LATEST_RUN.json` 会记录最近一次归档运行的位置
- 后续如需扩展为更完整的训练/验证集，优先在本目录内保持“原始样本 + 参考结果 + manifest”同目录管理
