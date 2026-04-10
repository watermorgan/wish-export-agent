import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';

import { chromium } from 'playwright';

type StepResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

async function waitForServer(url: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function main() {
  const requestedPort = process.env.UI_SMOKE_PORT ? Number(process.env.UI_SMOKE_PORT) : null;
  const port =
    requestedPort ??
    (await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          server.close(() => reject(new Error('failed to allocate port')));
          return;
        }
        const nextPort = addr.port;
        server.close(() => resolve(nextPort));
      });
    }));

  const baseUrl = process.env.UI_SMOKE_BASE_URL ?? `http://localhost:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'ui-smoke');
  const serverLogPath = path.join(logsDir, 'server.log');

  console.log(`[verify:ui] baseUrl=${baseUrl}`);

  if (!existsSync(path.resolve(process.cwd(), '.next'))) {
    console.error('Missing .next build output. Run `npm run build` first.');
    process.exit(1);
  }

  await import('node:fs/promises').then(({ mkdir }) => mkdir(logsDir, { recursive: true }));

  const serverLog = createWriteStream(serverLogPath, { flags: 'w' });
  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: '',
      DATABASE_JDBC_URL: '',
      JDBC_DATABASE_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout?.pipe(serverLog);
  server.stderr?.pipe(serverLog);

  const steps: StepResult[] = [];
  try {
    console.log('[verify:ui] waiting for server');
    const healthy = await waitForServer(`${baseUrl}/api/health`);
    steps.push({
      name: 'server',
      passed: healthy,
      detail: healthy ? 'ok' : `not healthy within timeout; see ${serverLogPath}`
    });
    if (!healthy) {
      throw new Error('server not healthy');
    }

    console.log('[verify:ui] launching browser');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log('[verify:ui] open /');
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '外贸助手工作台' }).waitFor({ timeout: 30_000 });
    steps.push({ name: 'home', passed: true });

    console.log('[verify:ui] open preview fixture');
    await page.goto(`${baseUrl}/preview/task/task_ui_fixture_preview`, {
      waitUntil: 'domcontentloaded'
    });
    await page.getByRole('heading', { name: '翻译结果预览' }).waitFor({ timeout: 30_000 });
    await page.getByText('样例片段').waitFor({ timeout: 30_000 });
    steps.push({ name: 'preview', passed: true });

    if (pageErrors.length > 0 || consoleErrors.length > 0) {
      steps.push({
        name: 'console',
        passed: false,
        detail: [...pageErrors, ...consoleErrors].slice(0, 6).join(' ; ')
      });
    } else {
      steps.push({ name: 'console', passed: true });
    }

    await browser.close();
  } catch (error) {
    if (!steps.some((step) => step.name === 'home')) {
      steps.push({ name: 'home', passed: false, detail: String(error) });
    }
    if (!steps.some((step) => step.name === 'preview')) {
      steps.push({ name: 'preview', passed: false, detail: String(error) });
    }
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
    serverLog.end();
  }

  const failed = steps.filter((step) => !step.passed);
  if (failed.length > 0) {
    console.error('UI smoke failed:');
    for (const item of failed) {
      console.error(`- ${item.name}: ${item.detail ?? 'failed'}`);
    }
    process.exit(1);
  }

  console.log('UI smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
