import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test, { before, describe } from 'node:test';
import * as XLSX from 'xlsx';

delete process.env.DATABASE_URL;
delete process.env.DATABASE_JDBC_URL;
delete process.env.JDBC_DATABASE_URL;

import type {
  AssistantReply,
  AssistantRequest,
  ExcelTranslationSkillPayload
} from '../types';

const tempRoot = join(process.cwd(), '.tmp', 'excel-review-tests');
let createTaskFromExecution: typeof import('@/lib/assistant/task-store').createTaskFromExecution;
let getTranslationXlsx: typeof import('../../../app/api/tasks/[taskId]/translation-xlsx/route').GET;
let getSkillPayload: typeof import('../../../app/api/tasks/[taskId]/skill-payload/route').GET;
let excelPipeline: typeof import('../excel-translation-pipeline');
let firstArtifactTask: Awaited<ReturnType<typeof createTaskFromExecution>>;
let secondArtifactTask: Awaited<ReturnType<typeof createTaskFromExecution>>;
let payloadTask: Awaited<ReturnType<typeof createTaskFromExecution>>;

describe('excel translation review', { concurrency: false }, () => {
before(async () => {
  [
    { createTaskFromExecution },
    { GET: getTranslationXlsx },
    { GET: getSkillPayload },
    excelPipeline
  ] = await Promise.all([
    import('@/lib/assistant/task-store'),
    import('../../../app/api/tasks/[taskId]/translation-xlsx/route'),
    import('../../../app/api/tasks/[taskId]/skill-payload/route'),
    import('../excel-translation-pipeline')
  ]);

  await rm(tempRoot, { recursive: true, force: true });
  firstArtifactTask = await createTaskWithArtifact('first.xlsx', 'first-task-artifact');
  secondArtifactTask = await createTaskWithArtifact('second.xlsx', 'second-task-artifact');
  payloadTask = await createTaskWithArtifact('payload.xlsx', 'payload-artifact');
});

function makeRequest(fileName: string): AssistantRequest {
  return {
    channel: 'web',
    role: 'sales',
    question: `翻译 ${fileName}`,
    files: [
      {
        name: fileName,
        size: 100,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    ],
    selectedSkillIds: ['excel-translator'],
    selectedTemplateId: 'translation-merge',
    taskType: 'feedback'
  };
}

function makeExcelPayload(fileName: string, translatedFilePath: string): ExcelTranslationSkillPayload {
  return {
    kind: 'excel_translation_skill_v1',
    fileName,
    taskType: 'feedback',
    summary: `${fileName} done`,
    reviewRequired: true,
    translatedFileName: translatedFilePath.split('/').pop() ?? fileName,
    translatedFilePath,
    sheets: [
      {
        sheetName: 'Sheet1',
        rowCount: 1,
        columnCount: 1,
        translatedCells: 1,
        failedCells: 0
      }
    ],
    totalCells: 1,
    translatedCells: 1,
    failedCells: 0,
    executionTimeMs: 10,
    parseFailedBatches: 1,
    translationBatchErrors: ['batch 1: parse_failed']
  };
}

function makeReply(payload: ExcelTranslationSkillPayload): AssistantReply {
  return {
    intent: 'feedback',
    intentLabel: '意见翻译',
    role: 'sales',
    status: 'pending_user_confirmation',
    statusLabel: '待人工确认',
    reviewStatus: 'not_submitted',
    reviewStatusLabel: '未提交审核',
    summary: payload.summary,
    nextActions: [],
    riskAlerts: [],
    draftDirection: '',
    taskType: 'feedback',
    taskTypeLabel: '意见翻译',
    skillCatalog: [],
    templates: [],
    selectedSkills: [],
    selectedTemplate: null,
    executionPlan: [],
    pendingConfirmations: [],
    blockingIssues: [],
    validationIssues: [],
    artifacts: [
      {
        title: 'Excel 翻译结果',
        kind: 'list',
        summary: payload.summary,
        fields: [
          {
            label: '翻译文件',
            value: payload.translatedFileName,
            structuredData: payload
          }
        ]
      }
    ],
    auditTrail: [],
    metadata: {
      needsHumanReview: true,
      skillPayload: payload
    }
  };
}

async function createTaskWithArtifact(fileName: string, body: string) {
  await mkdir(tempRoot, { recursive: true });
  const artifactPath = join(tempRoot, fileName);
  await writeFile(artifactPath, body, 'utf8');
  return createTaskFromExecution(
    makeRequest(fileName),
    makeReply(makeExcelPayload(fileName, artifactPath))
  );
}

type MockMcpCall = {
  id: number;
  name: string;
  arguments: Record<string, unknown>;
};

async function callMcpWithMockService(
  calls: MockMcpCall[],
  handler: (url: string) => { status?: number; payload: unknown }
) {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requestedPaths.push(url);
    const result = handler(url);

    response.statusCode = result.status ?? 200;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result.payload));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');

  const child = spawn(process.execPath, ['scripts/ting-pdf-mcp-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EXPORT_AGENT_BASE_URL: `http://127.0.0.1:${address.port}`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exitPromise = new Promise<number | null>((resolve) => child.on('exit', resolve));

  for (const call of calls) {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: call.id,
      method: 'tools/call',
      params: {
        name: call.name,
        arguments: call.arguments
      }
    })}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP response timed out. stderr: ${stderr}`)), 5000);
    child.stdout.on('data', () => {
      if (stdout.trim().split('\n').filter(Boolean).length >= calls.length) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  child.kill();
  const exitCode = await exitPromise;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert(exitCode === 0 || exitCode === null, stderr);
  const responses = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    requestedPaths,
    responses
  };
}

test('translation-xlsx route serves only the requested task artifact', { concurrency: false }, async () => {
  const firstResponse = await getTranslationXlsx(
    new Request(`http://localhost/api/tasks/${firstArtifactTask.task.id}/translation-xlsx?download=1`),
    { params: Promise.resolve({ taskId: firstArtifactTask.task.id }) }
  );
  const secondResponse = await getTranslationXlsx(
    new Request(`http://localhost/api/tasks/${secondArtifactTask.task.id}/translation-xlsx?download=1`),
    { params: Promise.resolve({ taskId: secondArtifactTask.task.id }) }
  );

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(await firstResponse.text(), 'first-task-artifact');
  assert.equal(await secondResponse.text(), 'second-task-artifact');
  assert.match(firstResponse.headers.get('content-disposition') ?? '', /first\.xlsx/);
  assert.match(secondResponse.headers.get('content-disposition') ?? '', /second\.xlsx/);
});

test('skill-payload route returns Excel payload with task-bound download URL', { concurrency: false }, async () => {
  const response = await getSkillPayload(new Request('http://localhost/unused'), {
    params: Promise.resolve({ taskId: payloadTask.task.id })
  });
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.kind, 'excel_translation_skill_v1');
  assert.equal(json.fileName, 'payload.xlsx');
  assert.equal(json.downloadUrl, `/api/tasks/${encodeURIComponent(payloadTask.task.id)}/translation-xlsx?download=1`);
  assert.equal(json.parseFailedBatches, 1);
  assert.deepEqual(json.translationBatchErrors, ['batch 1: parse_failed']);
});

test('skill-payload route does not attach Excel download URL to failed payloads', { concurrency: false }, async () => {
  const payload = makeExcelPayload('failed.xlsx', '');
  payload.summary = 'Excel 翻译失败：模型不可达';
  payload.translatedFileName = '';
  payload.translatedFilePath = '';
  payload.translatedCells = 0;
  payload.failedCells = 1;
  payload.error = '模型不可达';
  payload.translationBatchErrors = ['batch 1: 模型不可达'];

  const task = await createTaskFromExecution(
    makeRequest('failed.xlsx'),
    {
      ...makeReply(payload),
      status: 'failed',
      statusLabel: '执行失败',
      summary: payload.summary,
      riskAlerts: ['模型不可达'],
      artifacts: []
    }
  );

  const response = await getSkillPayload(new Request('http://localhost/unused'), {
    params: Promise.resolve({ taskId: task.task.id })
  });
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.kind, 'excel_translation_skill_v1');
  assert.equal(json.error, '模型不可达');
  assert.equal(json.downloadUrl, undefined);
});

test('translation-xlsx route rejects failed Excel payloads before filesystem lookup', { concurrency: false }, async () => {
  const payload = makeExcelPayload('failed-download.xlsx', '');
  payload.translatedFileName = '';
  payload.translatedFilePath = '';
  payload.error = '模型不可达';

  const task = await createTaskFromExecution(
    makeRequest('failed-download.xlsx'),
    {
      ...makeReply(payload),
      status: 'failed',
      statusLabel: '执行失败',
      artifacts: []
    }
  );

  const response = await getTranslationXlsx(
    new Request(`http://localhost/api/tasks/${task.task.id}/translation-xlsx?download=1`),
    { params: Promise.resolve({ taskId: task.task.id }) }
  );
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.match(json.error, /没有可下载|翻译 Excel/);
});

test('extractTextFromCells uses visible display values and skips blanks and errors', { concurrency: false }, () => {
  const worksheet: XLSX.WorkSheet = {
    '!ref': 'A1:F1',
    A1: { t: 's', v: ' SKU 123 ' },
    B1: { t: 'n', v: 42, w: '42 pcs' },
    C1: { t: 'b', v: true, w: 'TRUE' },
    D1: { t: 'n', v: 45292, w: '2024-01-01', z: 'yyyy-mm-dd' },
    E1: { t: 'n', f: 'A1', v: 7, w: 'cached formula result' },
    F1: { t: 'e', v: 15, w: '#VALUE!' }
  };

  assert.deepEqual(excelPipeline.extractTextFromCells(worksheet), [
    { cell: 'A1', text: 'SKU 123' },
    { cell: 'B1', text: '42 pcs' },
    { cell: 'C1', text: 'TRUE' },
    { cell: 'D1', text: '2024-01-01' },
    { cell: 'E1', text: 'cached formula result' }
  ]);
});

test('fallback translation parsing preserves batch length and reports parse failure', { concurrency: false }, () => {
  const normalized = excelPipeline.normalizeTranslationFallback('1. 第一行\n2. 第二行', [
    'one',
    'two',
    'three'
  ]);

  assert.deepEqual(normalized.translations, ['第一行', '第二行', 'three']);
  assert.equal(normalized.parseFailed, true);
  assert.match(normalized.error ?? '', /parse/i);
});

test('Excel translation fails instead of completing when all model batches fail', { concurrency: false }, async () => {
  const previousLocalUrl = process.env.LOCAL_OPENAI_API_URL;
  const previousLocalModel = process.env.LOCAL_OPENAI_MODEL_NAME;
  process.env.LOCAL_OPENAI_API_URL = 'http://127.0.0.1:9/v1';
  process.env.LOCAL_OPENAI_MODEL_NAME = 'qwen3.5-35b-a3b';

  try {
    await mkdir(tempRoot, { recursive: true });
    const sourcePath = join(tempRoot, 'model-down.xlsx');
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['SKU', 'Description'],
      ['A-1', 'Durable outdoor chair']
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, sourcePath);

    const result = await excelPipeline.translateExcelFile({
      filePath: sourcePath,
      fileName: 'model-down.xlsx',
      translationModelOverride: 'qwen3.5-35b-a3b'
    });

    assert.equal(result.success, false);
    assert.equal(result.translatedCells, 0);
    assert.equal(result.totalCells, 4);
    assert.match(result.error ?? '', /翻译模型未返回任何有效译文|无法连接本地模型服务/);
    assert.ok((result.translationBatchErrors?.length ?? 0) > 0);
  } finally {
    if (previousLocalUrl === undefined) {
      delete process.env.LOCAL_OPENAI_API_URL;
    } else {
      process.env.LOCAL_OPENAI_API_URL = previousLocalUrl;
    }
    if (previousLocalModel === undefined) {
      delete process.env.LOCAL_OPENAI_MODEL_NAME;
    } else {
      process.env.LOCAL_OPENAI_MODEL_NAME = previousLocalModel;
    }
  }
});

test('Excel MCP skill payload tool calls stable skill-payload endpoint', { concurrency: false }, async () => {
  const { requestedPaths, responses } = await callMcpWithMockService(
    [
      {
        id: 1,
        name: 'get_excel_translation_skill_payload',
        arguments: { taskId: 'task-mcp' }
      }
    ],
    (url) => {
      if (url === '/api/tasks/task-mcp/skill-payload') {
        return {
          payload: {
            kind: 'excel_translation_skill_v1',
            fileName: 'mcp.xlsx',
            summary: 'done',
            downloadUrl: '/api/tasks/task-mcp/translation-xlsx?download=1'
          }
        };
      }

      return {
        status: 500,
        payload: { error: 'raw task endpoint should not be used' }
      };
    }
  );

  const response = responses.find((message) => message.id === 1);

  assert.equal(response?.result?.structuredContent?.kind, 'excel_translation_skill_v1');
  assert.deepEqual(requestedPaths, ['/api/tasks/task-mcp/skill-payload']);
});

test('Excel MCP submit tool waits for skill payload and returns a compact result', { concurrency: false }, async () => {
  const { requestedPaths, responses } = await callMcpWithMockService(
    [
      {
        id: 1,
        name: 'submit_excel_translation_task',
        arguments: {
          question: '翻译 Excel',
          selectedSkillIds: ['excel-translator']
        }
      }
    ],
    (url) => {
      if (url === '/api/tasks') {
        return {
          payload: {
            task: { id: 'task-submit' },
            reply: {
              summary: 'queued',
              recentTasks: [{ id: 'noisy-task' }]
            }
          }
        };
      }

      if (url === '/api/tasks/task-submit/skill-payload') {
        return {
          payload: {
            kind: 'excel_translation_skill_v1',
            fileName: 'submit.xlsx',
            summary: 'Excel 翻译完成：1 个 sheet，2/2 个单元格已翻译。',
            translatedFileName: 'submit_翻译.xlsx',
            translatedFilePath: '/tmp/submit_翻译.xlsx',
            downloadUrl: '/api/tasks/task-submit/translation-xlsx?download=1',
            totalCells: 2,
            translatedCells: 2,
            failedCells: 0,
            executionTimeMs: 1000
          }
        };
      }

      return {
        status: 500,
        payload: { error: 'unexpected endpoint' }
      };
    }
  );

  const response = responses.find((message) => message.id === 1);
  const result = response?.result?.structuredContent;

  assert.equal(result?.kind, 'excel_translation_skill_v1');
  assert.equal(result?.taskId, 'task-submit');
  assert.equal(result?.status, 'completed');
  assert.match(
    String(result?.absoluteDownloadUrl),
    /^http:\/\/127\.0\.0\.1:\d+\/api\/tasks\/task-submit\/translation-xlsx\?download=1$/
  );
  assert.equal(result?.recentTasks, undefined);
  assert.deepEqual(requestedPaths, ['/api/tasks', '/api/tasks/task-submit/skill-payload']);
});

test('PDF MCP task and skill-payload tools keep their endpoint contracts', { concurrency: false }, async () => {
  const { requestedPaths, responses } = await callMcpWithMockService(
    [
      {
        id: 1,
        name: 'get_pdf_translation_task',
        arguments: { taskId: 'task-pdf' }
      },
      {
        id: 2,
        name: 'get_pdf_translation_skill_payload',
        arguments: { taskId: 'task-pdf' }
      }
    ],
    (url) => {
      if (url === '/api/tasks/task-pdf') {
        return {
          payload: {
            task: { id: 'task-pdf' },
            reply: { summary: 'task snapshot' }
          }
        };
      }

      if (url === '/api/tasks/task-pdf/skill-payload') {
        return {
          payload: {
            kind: 'ting_pdf_translation_v1',
            result: {
              deliveryPdfUrl: '/api/tasks/task-pdf/translation-pdf?download=1',
              artifactLinks: []
            }
          }
        };
      }

      return {
        status: 500,
        payload: { error: 'unexpected endpoint' }
      };
    }
  );

  const taskResponse = responses.find((message) => message.id === 1);
  const payloadResponse = responses.find((message) => message.id === 2);

  assert.equal(taskResponse?.result?.structuredContent?.reply?.summary, 'task snapshot');
  assert.equal(payloadResponse?.result?.structuredContent?.kind, 'ting_pdf_translation_v1');
  assert.deepEqual(requestedPaths, [
    '/api/tasks/task-pdf',
    '/api/tasks/task-pdf/skill-payload'
  ]);
});
});
