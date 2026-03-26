# runs/

这里用于存放基于 `data/test02/manifest.json` 的每次算法归档运行结果。

每次运行建议生成：
- `runs/<run_id>/exports/`
- `runs/<run_id>/samples/<sample_id>/pipeline-result.json`
- `runs/<run_id>/reports/summary.json`
- `runs/<run_id>/reports/summary.md`

不要把原始业务 PDF、人工翻译 PDF/XLSX 放到这里。
它们应长期保留在 `data/test02/` 根目录，并由 `manifest.json` 统一索引。
