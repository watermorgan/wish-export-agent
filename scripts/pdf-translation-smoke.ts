/**
 * PDF 翻译主链冒烟：runPdfTranslationPipeline（抽取 → A → B → 物化）。
 *
 * 本机 OpenAI 兼容端点（llama.cpp）与仓库内 ModelScope 并存时，请设置：
 *   LLM_PREFER_OPENAI_COMPAT=1
 *   OPENAI_BASE_URL=http://<host>:<port>/v1
 *   OPENAI_API_KEY=<仅本机>
 *   QWEN_MODEL=gemma-4-31B-it   （或与 /v1/models 一致的 id）
 *
 * 可选：MODEL_API_TIMEOUT_MS=180000、maxSegments 限制耗时。
 */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import { runPdfTranslationPipeline } from '../src/lib/assistant/translation-pipeline';

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  let pdfPath = '';
  let maxSeg = Number(process.env.TRANSLATE_SMOKE_MAX_SEGMENTS ?? '40');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-segments' && argv[i + 1]) {
      maxSeg = Number(argv[++i]);
    } else if (!a.startsWith('-')) {
      pdfPath = a;
    }
  }
  if (!pdfPath) pdfPath = path.join('data', 'test02', 'M422123.pdf');
  const maxSegmentsForTranslation = Number.isFinite(maxSeg) && maxSeg > 0 ? maxSeg : 40;

  if (!existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const fileName = path.basename(pdfPath);
  console.log(`[translate:smoke] file=${pdfPath}`);
  console.log(
    `[translate:smoke] LLM_PREFER_OPENAI_COMPAT=${process.env.LLM_PREFER_OPENAI_COMPAT ?? '(unset)'} model=${process.env.QWEN_MODEL ?? process.env.MODELSCOPE_MODEL ?? '(default)'}`
  );
  console.log(`[translate:smoke] maxSegmentsForTranslation=${maxSegmentsForTranslation}`);

  const started = Date.now();
  const result = await runPdfTranslationPipeline({
    filePath: path.resolve(pdfPath),
    fileName,
    maxSegmentsForTranslation
  });
  const elapsed = Date.now() - started;

  const translated = result.segments.filter((s) => Boolean(s.zh)).length;
  const total = result.segments.length;
  const pct = total ? Math.round((translated / total) * 100) : 0;

  console.log(JSON.stringify(result, null, 2));
  console.log(
    `[translate:smoke] done in ${elapsed}ms success=${result.success} translated=${translated}/${total} (${pct}%) strategy=${result.outputStrategy}`
  );

  if (flags.has('--fail-on-partial') && result.success && translated < total) {
    process.exit(2);
  }
  if (!result.success) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
