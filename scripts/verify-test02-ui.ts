import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

import {
  ensureRunDirectories,
  loadManifest,
  nowRunId,
  resolveManifestPath,
  resolveRepoPath,
  writeJson,
  writeMarkdown
} from './lib/test02-harness';

type UiSampleResult = {
  sampleId: string;
  sourcePdf: string | null;
  pageLoaded: boolean;
  assistantStatus: number | null;
  assistantOk: boolean;
  requestError: string | null;
  taskId: string | null;
  apiSmoke: {
    tasksStatus: number | null;
    taskStatus: number | null;
    translationPdfStatus: number | null;
  };
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  apiResponses: Array<{
    url: string;
    status: number;
  }>;
  screenshotPath: string | null;
  passed: boolean;
  failureReasons: string[];
};

function parseArgs() {
  return {
    manifestPath: resolveManifestPath(process.argv[2] ?? 'data/test02/manifest.json'),
    runId: process.argv[3] ?? nowRunId(),
    baseUrl: process.argv[4] ?? process.env.TEST02_BASE_URL ?? 'http://localhost:3000',
    modelLabel: process.env.TEST02_MODEL_LABEL ?? 'Qwen 3.5 397B'
  };
}

function toMarkdown(baseUrl: string, results: UiSampleResult[]) {
  const lines: string[] = [];
  lines.push('# test02 UI Verification');
  lines.push('');
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Sample | Page | Assistant | Task | /api/tasks | /api/tasks/:id | /translation-pdf | Passed | Notes |');
  lines.push('| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- |');

  for (const result of results) {
    lines.push(
      `| ${result.sampleId} | ${result.pageLoaded ? 'ok' : 'fail'} | ${result.assistantStatus ?? '-'} | ${result.taskId ?? '-'} | ${result.apiSmoke.tasksStatus ?? '-'} | ${result.apiSmoke.taskStatus ?? '-'} | ${result.apiSmoke.translationPdfStatus ?? '-'} | ${result.passed ? 'yes' : 'no'} | ${[result.requestError, ...result.failureReasons].filter(Boolean).join(' ; ') || '-'} |`
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function safeJson(response: { json(): Promise<unknown> }) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  const { manifestPath, runId, baseUrl, modelLabel } = parseArgs();
  const dirs = await ensureRunDirectories(runId);
  const uiDir = dirs.uiDir;
  await mkdir(uiDir, { recursive: true });

  const manifest = await loadManifest(manifestPath);
  const browser = await chromium.launch({ headless: true });
  const results: UiSampleResult[] = [];

  try {
    for (const sample of manifest.samples) {
      const sourcePdf = sample.source.find((item) => item.role === 'source_pdf')?.path ?? null;
      const sourcePath = sourcePdf ? resolveRepoPath(sourcePdf) : null;
      const sourceFileName = sourcePath ? path.basename(sourcePath) : null;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const requestFailures: string[] = [];
      const apiResponses: Array<{ url: string; status: number }> = [];
      const failureReasons: string[] = [];

      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('requestfailed', (request) => {
        requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`);
      });
      page.on('response', (response) => {
        if (response.url().includes('/api/')) {
          apiResponses.push({
            url: response.url(),
            status: response.status()
          });
        }
      });

      let pageLoaded = false;
      let assistantStatus: number | null = null;
      let assistantOk = false;
      let requestError: string | null = null;
      let taskId: string | null = null;
      let tasksStatus: number | null = null;
      let taskStatus: number | null = null;
      let translationPdfStatus: number | null = null;

      try {
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 });
        pageLoaded = true;

        if (await page.getByText('展开高级设置').isVisible().catch(() => false)) {
          await page.getByText('展开高级设置').click();
        }

        await page.getByRole('button', { name: '意见翻译与归并' }).click();
        await page.getByRole('button', { name: new RegExp(modelLabel) }).click();

        if (!sourcePath) {
          failureReasons.push('missing source pdf');
        } else {
          await page.locator('[data-testid="file-input"]').setInputFiles(sourcePath);
          if (sourceFileName) {
            await page.getByText(sourceFileName).waitFor({ timeout: 10000 });
          }

          const assistantResponsePromise = page.waitForResponse(
            (response) =>
              response.url().includes('/api/assistant') && response.request().method() === 'POST',
            { timeout: 180000 }
          );

          await page.locator('[data-testid="start-translation"]').click();
          const assistantResponse = await assistantResponsePromise;
          assistantStatus = assistantResponse.status();
          assistantOk = assistantResponse.ok();

          const assistantJson = await safeJson(assistantResponse);
          if (!assistantOk) {
            const assistantError =
              assistantJson &&
              typeof assistantJson === 'object' &&
              'error' in assistantJson &&
              typeof assistantJson.error === 'string'
                ? assistantJson.error
                : null;
            requestError =
              assistantError || 'assistant request failed';
            if (requestError) {
              failureReasons.push(requestError);
            }
          } else {
            await page.locator('[data-testid="result-summary"]').waitFor({ timeout: 30000 });
            const taskText = await page.locator('[data-testid="task-id"]').textContent();
            const taskMatch = taskText?.match(/任务ID：([^\s·]+)/);
            taskId = taskMatch?.[1] ?? null;
            if (!taskId) {
              failureReasons.push('task id not rendered');
            }
          }
        }

        const tasksResponse = await page.request.get(`${baseUrl}/api/tasks`);
        tasksStatus = tasksResponse.status();
        if (!tasksResponse.ok()) {
          failureReasons.push(`/api/tasks => ${tasksStatus}`);
        }

        if (taskId) {
          const taskResponse = await page.request.get(`${baseUrl}/api/tasks/${taskId}`);
          taskStatus = taskResponse.status();
          if (!taskResponse.ok()) {
            failureReasons.push(`/api/tasks/${taskId} => ${taskStatus}`);
          }

          const translationPdfResponse = await page.request.get(
            `${baseUrl}/api/tasks/${taskId}/translation-pdf`
          );
          translationPdfStatus = translationPdfResponse.status();
          if (!translationPdfResponse.ok()) {
            failureReasons.push(`/translation-pdf => ${translationPdfStatus}`);
          }
        }

        if (pageErrors.some((message) => message.includes('Cannot read properties of undefined'))) {
          failureReasons.push('frontend undefined property crash');
        }
        if (consoleErrors.length > 0) {
          failureReasons.push(`console errors: ${consoleErrors.length}`);
        }
        if (requestFailures.length > 0) {
          failureReasons.push(`request failures: ${requestFailures.length}`);
        }
      } catch (error) {
        failureReasons.push(error instanceof Error ? error.message : 'ui verification failed');
      }

      const screenshotPath = path.join(uiDir, `${sample.sample_id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      const result: UiSampleResult = {
        sampleId: sample.sample_id,
        sourcePdf,
        pageLoaded,
        assistantStatus,
        assistantOk,
        requestError,
        taskId,
        apiSmoke: {
          tasksStatus,
          taskStatus,
          translationPdfStatus
        },
        consoleErrors,
        pageErrors,
        requestFailures,
        apiResponses,
        screenshotPath: path.relative(process.cwd(), screenshotPath),
        passed:
          pageLoaded &&
          assistantOk &&
          Boolean(taskId) &&
          tasksStatus === 200 &&
          taskStatus === 200 &&
          translationPdfStatus === 200 &&
          consoleErrors.length === 0 &&
          pageErrors.length === 0 &&
          requestFailures.length === 0,
        failureReasons
      };

      await writeJson(path.join(uiDir, `${sample.sample_id}.json`), result);
      results.push(result);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const summary = {
    runId,
    baseUrl,
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results
  };

  await writeJson(path.join(uiDir, 'summary.json'), summary);
  await writeMarkdown(path.join(uiDir, 'summary.md'), toMarkdown(baseUrl, results));
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
