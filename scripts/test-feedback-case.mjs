import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const caseId = process.env.FEEDBACK_CASE_ID ?? 'case-001';
const caseDir = path.resolve(process.cwd(), 'data', 'feedback-translation', caseId);
const inputPdfPath = path.join(caseDir, 'input', 'Hanna Lightweight Skirt.pdf');
const outputDir = path.resolve(process.cwd(), '.tmp', caseId);

function wrapHtml(content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${caseId} bilingual output</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; background: #f6f4ef; color: #17261d; padding: 32px; }
    main { max-width: 960px; margin: 0 auto; }
    .bilingual-block { padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid rgba(23,38,29,0.08); margin-bottom: 10px; }
    .source-line { margin: 0; font-weight: 600; line-height: 1.7; white-space: pre-wrap; }
    .translation-line { margin: 6px 0 0; color: #1c5f8c; line-height: 1.7; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <h1>${caseId} 双语翻译输出</h1>
    ${content}
  </main>
</body>
</html>`;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const fileBuffer = await readFile(inputPdfPath);
  const formData = new FormData();
  formData.append('role', 'sales');
  formData.append('taskType', 'feedback');
  formData.append('question', '请保留英文原文，在每段下方增加中文翻译，仅做翻译，不做归并。');
  formData.append('selectedSkillIds', JSON.stringify(['comment-translator']));
  formData.append(
    'files',
    new File([fileBuffer], path.basename(inputPdfPath), {
      type: 'application/pdf'
    })
  );

  const response = await fetch(`${baseUrl}/api/assistant`, {
    method: 'POST',
    body: formData
  });

  const payload = await response.json();
  await writeFile(
    path.join(outputDir, 'response.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );

  if (!response.ok) {
    throw new Error(`Case run failed: ${JSON.stringify(payload)}`);
  }

  const richHtml =
    payload.artifacts?.[0]?.fields?.find((field) => typeof field.richTextHtml === 'string')
      ?.richTextHtml ?? '<p>未找到双语 HTML 输出。</p>';

  await writeFile(path.join(outputDir, 'preview.html'), wrapHtml(richHtml), 'utf8');

  console.log(
    JSON.stringify(
      {
        savedJson: path.join(outputDir, 'response.json'),
        savedPreview: path.join(outputDir, 'preview.html'),
        summary: payload.summary,
        artifacts: payload.artifacts?.length ?? 0,
        pendingConfirmations: payload.pendingConfirmations?.length ?? 0
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
