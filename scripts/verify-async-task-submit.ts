import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-async-task-submit');
  const serverLogPath = path.join(logsDir, 'server.log');
  await mkdir(logsDir, { recursive: true });
  const serverLog = createWriteStream(serverLogPath, { flags: 'w' });

  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: '',
      DATABASE_JDBC_URL: '',
      JDBC_DATABASE_URL: '',
      ASSISTANT_FORCE_GOLDEN: '1',
      ASSISTANT_ASYNC_MIN_DELAY_MS: '1500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout?.pipe(serverLog);
  server.stderr?.pipe(serverLog);

  try {
    await waitForServer(`${baseUrl}/api/health`);

    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        channel: 'web',
        role: 'sales',
        question: '翻译这份PDF的批注内容为英文',
        taskType: 'feedback',
        selectedTemplateId: 'translation-merge',
        selectedSkillIds: ['comment-translator', 'comment-merger'],
        files: [
          {
            name: 'M422123.pdf',
            size: 1,
            type: 'application/pdf',
            storagePath: path.resolve(process.cwd(), 'data/test02/M422123.pdf')
          }
        ]
      })
    });
    assert(response.ok, `async submit should succeed, got ${response.status}`);
    const payload = (await response.json()) as {
      task?: { id?: string; status?: string };
      reply?: { status?: string; metadata?: { asyncProgress?: { phase?: string } } };
    };

    assert(payload.task?.id, 'async submit should return task.id');
    assert(payload.task?.status === 'validating', 'async submit should return validating task status');
    assert(payload.reply?.status === 'validating', 'async submit should return validating reply status');
    assert(
      payload.reply?.metadata?.asyncProgress?.phase === 'queued',
      'async submit should expose queued async progress'
    );

    const taskId = payload.task.id;
    const deadline = Date.now() + 30_000;
    let finalPayload: unknown = null;
    while (Date.now() < deadline) {
      const poll = await fetch(`${baseUrl}/api/tasks/${taskId}`);
      assert(poll.ok, `task poll should succeed, got ${poll.status}`);
      finalPayload = await poll.json();
      const status = (finalPayload as { task?: { status?: string } }).task?.status;
      if (status && status !== 'validating') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const done = finalPayload as {
      task?: { status?: string };
      reply?: { status?: string; metadata?: { asyncProgress?: { phase?: string } } };
    };
    assert(done.task?.status && done.task.status !== 'validating', 'task should eventually leave validating');
    assert(
      done.reply?.metadata?.asyncProgress?.phase === 'completed',
      'completed task should expose completed async progress'
    );

    process.stdout.write('Async task submit verification passed.\n');
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
