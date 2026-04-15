import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

type CliRun = {
  code: number;
  stdout: string;
  stderr: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCli(args: string[], stdinText?: string): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/ting-pdf-service.ts', ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });

    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

function parseJsonOutput(text: string) {
  return JSON.parse(text.trim());
}

async function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  assert(
    existsSync(path.resolve(process.cwd(), '.next')),
    'Missing .next build output. Run `npm run build` first.'
  );
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-ting-service-cli');
  const serverLogPath = path.join(logsDir, 'server.log');
  await mkdir(logsDir, { recursive: true });
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
  server.stdout.on('data', (chunk) => serverLog.write(chunk));
  server.stderr.on('data', (chunk) => serverLog.write(chunk));

  await waitForServer(`${baseUrl}/api/health`);

  try {
    const blockedRequest = {
      channel: 'web',
      role: 'sales',
      question: '创建阻断态 CLI 回归任务',
      files: [],
      taskType: 'feedback',
      selectedSkillIds: ['missing-skill']
    };

    const submit = await runCli(
      ['submit', '--base-url', baseUrl, '--stdin'],
      JSON.stringify(blockedRequest)
    );
    assert(
      submit.code === 0,
      `submit should succeed, got exit ${submit.code}: ${submit.stderr}`
    );
    const submitPayload = parseJsonOutput(submit.stdout);
    assert(submitPayload.task?.id, 'submit output should contain task.id');
    const blockedTaskId = String(submitPayload.task.id);

    const getTask = await runCli(['get-task', '--base-url', baseUrl, blockedTaskId]);
    assert(
      getTask.code === 0,
      `get-task should succeed, got exit ${getTask.code}: ${getTask.stderr}`
    );
    const taskPayload = parseJsonOutput(getTask.stdout);
    assert(taskPayload.task?.id === blockedTaskId, 'get-task should return the requested task');

    const fixturePayloadRun = await runCli([
      'get-skill-payload',
      '--base-url',
      baseUrl,
      'task_ui_fixture_preview'
    ]);
    assert(
      fixturePayloadRun.code === 0,
      `fixture skill payload should succeed, got exit ${fixturePayloadRun.code}: ${fixturePayloadRun.stderr}`
    );
    const fixturePayload = parseJsonOutput(fixturePayloadRun.stdout);
    assert(
      fixturePayload.kind === 'ting_pdf_translation_v1',
      'CLI payload should preserve top-level Ting kind'
    );
    assert(
      fixturePayload.result?.kind === 'pdf_translation_skill_v1',
      'CLI payload should preserve nested skill payload kind'
    );
    assert(
      typeof fixturePayload.result?.humanReviewGuide?.summary === 'string' &&
        fixturePayload.result.humanReviewGuide.summary.length > 0,
      'CLI payload should preserve human review guide summary'
    );
    assert(
      fixturePayload.result?.deliveryPdfUrl === '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
      'CLI payload should expose deliveryPdfUrl'
    );
    assert(
      fixturePayload.result?.artifactLinks?.[0]?.annotatedPreviewUrl ===
        '/preview/task/task_ui_fixture_preview',
      'CLI payload should preserve preview link'
    );

    const conflictRun = await runCli([
      'get-skill-payload',
      '--base-url',
      baseUrl,
      blockedTaskId
    ]);
    assert(
      conflictRun.code === 1,
      `blocked task payload should fail with exit 1, got ${conflictRun.code}`
    );
    const conflictPayload = parseJsonOutput(conflictRun.stderr);
    assert(conflictPayload.status === 409, 'blocked task payload should preserve 409 status');
    assert(
      conflictPayload.error === '当前任务尚未生成可供 skill/Ting 外贸助手复用的 PDF 结果协议。',
      'blocked task payload should preserve 409 error message'
    );

    process.stdout.write('Ting service CLI verification passed.\n');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
    serverLog.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
