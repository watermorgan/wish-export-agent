import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type PipelineResult = Awaited<
  ReturnType<typeof import('../src/lib/assistant/translation-pipeline').runPdfTranslationPipeline>
>;

async function main() {
  const inputPdf = path.resolve(process.argv[2] ?? 'data/test02/M422123.pdf');
  const outputPdf = path.resolve(
    process.argv[3] ?? '.tmp/exports/M422123.current.annotated.pdf'
  );
  const responseJson = path.resolve(
    process.argv[4] ?? '.tmp/exports/M422123.current.response.json'
  );

  const { runPdfTranslationPipeline } = await import('../src/lib/assistant/translation-pipeline');
  const result: PipelineResult = await runPdfTranslationPipeline({
    filePath: inputPdf,
    fileName: path.basename(inputPdf)
  });
  const snapshot = result.outputs.annotatedPdf?.snapshot;
  if (!snapshot) {
    throw new Error(
      `Current pipeline output for ${path.basename(inputPdf)} does not contain annotated translation_snapshot_v1`
    );
  }

  const responsePayload = {
    summary: `${path.basename(inputPdf)} current pipeline result`,
    artifacts: [
      {
        title: '原文保留式双语翻译',
        kind: 'text',
        summary: '基于当前 A/B 模型组合生成正式 PDF。',
        fields: [
          {
            label: 'PDF Pipeline 结果',
            value: `${path.basename(inputPdf)} current pipeline result`,
            citation: path.basename(inputPdf),
            structuredData: snapshot
          }
        ]
      }
    ]
  };

  await mkdir(path.dirname(responseJson), { recursive: true });
  await writeFile(responseJson, JSON.stringify(responsePayload, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        success: result.success,
        responseJson,
        outputPdf,
        diagnostics: result.diagnostics
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
