import nodeAssert from 'node:assert/strict';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
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

function resolveNextBinPath() {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.resolve(process.cwd(), '..', 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.resolve(process.cwd(), '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next')
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error('Cannot locate next binary in node_modules.');
  }
  return resolved;
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

async function pollTaskReady(baseUrl: string, taskId: string, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}`);
    assert(response.ok, `GET /api/tasks/${taskId} failed: ${response.status}`);
    const body = (await response.json()) as {
      task?: { id?: string; reviewStatus?: string };
      reply?: {
        metadata?: { asyncProgress?: { phase?: string } };
        reviewStatus?: string;
      };
    };
    const phase = body.reply?.metadata?.asyncProgress?.phase;
    if (!phase || phase === 'completed') {
      return body;
    }
    if (phase === 'failed') {
      throw new Error(`task ${taskId} failed during async execution`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`task ${taskId} did not complete within ${timeoutMs}ms`);
}

async function main() {
  const pdfPath = path.resolve(process.argv[2] ?? path.resolve(process.cwd(), 'data/test02/M415013.pdf'));
  const st = await stat(pdfPath);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = resolveNextBinPath();
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-task-revision-flow');
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
  server.stdout?.pipe(serverLog);
  server.stderr?.pipe(serverLog);

  try {
    await waitForServer(`${baseUrl}/api/health`);

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: 'web',
        role: 'sales',
        question: '验证 revision flow',
        taskType: 'feedback',
        selectedTemplateId: 'translation-merge',
        selectedSkillIds: ['comment-translator', 'comment-merger'],
        files: [
          {
            name: path.basename(pdfPath),
            size: st.size,
            type: 'application/pdf',
            storagePath: pdfPath
          }
        ]
      })
    });
    assert(createResponse.ok, `POST /api/tasks failed: ${createResponse.status}`);
    const created = (await createResponse.json()) as { task?: { id?: string } };
    const taskId = created.task?.id;
    assert(taskId, 'taskId missing');

    const initialTask = (await pollTaskReady(baseUrl, taskId)) as {
      task?: { reviewStatus?: string; currentRevisionId?: string; revisionCount?: number };
    };
    assert(initialTask.task?.currentRevisionId, 'base revision missing');
    assert(initialTask.task?.revisionCount === 1, 'base revisionCount should be 1');
    assert(initialTask.task?.reviewStatus === 'not_submitted', 'review should remain task-level');
    const baseRevisionId = initialTask.task.currentRevisionId as string;

    const overrideResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/overrides`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'sales',
        reason: '强制第1页走 vision，并跳过第2页翻译',
        pageOverrides: {
          forceVisionPages: [1],
          skipTranslationPages: [2]
        }
      })
    });
    assert(overrideResponse.ok, `POST overrides failed: ${overrideResponse.status}`);
    const overrideBody = (await overrideResponse.json()) as {
      task?: { currentRevisionId?: string; revisionCount?: number };
    };
    const overrideRevisionId = overrideBody.task?.currentRevisionId;
    assert(overrideRevisionId && overrideRevisionId !== baseRevisionId, 'override should advance currentRevisionId');
    assert(overrideBody.task?.revisionCount === 2, 'override should increment revisionCount');

    const reworkResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/rework`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'sales',
        scope: 'pages',
        pageNumbers: [1],
        instruction: '重新识别并翻译第1页'
      })
    });
    assert(reworkResponse.ok, `POST rework failed: ${reworkResponse.status}`);
    const reworkBody = (await reworkResponse.json()) as {
      task?: { currentRevisionId?: string; revisionCount?: number; reviewStatus?: string };
      reply?: { metadata?: { taskIteration?: { latestRevision?: { kind?: string } } } };
    };
    const reworkRevisionId = reworkBody.task?.currentRevisionId;
    assert(reworkRevisionId && reworkRevisionId !== overrideRevisionId, 'rework should advance currentRevisionId');
    assert(reworkBody.task?.revisionCount === 3, 'rework should increment revisionCount');
    assert(
      reworkBody.reply?.metadata?.taskIteration?.latestRevision?.kind === 'rework',
      'latest revision kind should be rework'
    );
    assert(reworkBody.task?.reviewStatus === 'not_submitted', 'rework must not change task review semantics');

    const revisionResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/revisions/${overrideRevisionId}`);
    assert(revisionResponse.ok, `GET revision failed: ${revisionResponse.status}`);
    const revisionBody = (await revisionResponse.json()) as {
      revision?: { kind?: string; id?: string };
      current?: boolean;
    };
    assert(revisionBody.revision?.id === overrideRevisionId, 'historical revision id mismatch');
    assert(revisionBody.revision?.kind === 'override', 'historical revision kind mismatch');
    assert(revisionBody.current === false, 'historical revision should not be current');

    const skillPayloadResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/skill-payload`);
    assert(skillPayloadResponse.ok, `GET skill-payload failed: ${skillPayloadResponse.status}`);
    const skillPayload = (await skillPayloadResponse.json()) as {
      result?: {
        revision?: {
          id?: string;
          kind?: string;
          revisionCount?: number;
          currentControl?: { pageOverrides?: { skipTranslationPages?: number[] } };
        };
        diagnostics?: { skippedTranslationPages?: number[] };
      };
    };
    assert(skillPayload.result?.revision?.id === reworkRevisionId, 'skill payload should expose current revision');
    assert(skillPayload.result?.revision?.kind === 'rework', 'skill payload revision kind mismatch');
    assert(skillPayload.result?.revision?.revisionCount === 3, 'skill payload revisionCount mismatch');
    nodeAssert.deepEqual(
      skillPayload.result?.revision?.currentControl?.pageOverrides?.skipTranslationPages,
      [2],
      'rework should preserve prior skipTranslationPages'
    );
    nodeAssert.deepEqual(
      skillPayload.result?.diagnostics?.skippedTranslationPages,
      [2],
      'skill payload diagnostics should expose skipped pages'
    );

    const pdfResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/translation-pdf?download=1`);
    assert(pdfResponse.ok, `GET translation-pdf failed: ${pdfResponse.status}`);
    assert(
      pdfResponse.headers.get('content-type')?.includes('application/pdf'),
      'translation-pdf should return application/pdf'
    );

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          taskId,
          baseRevisionId,
          overrideRevisionId,
          reworkRevisionId
        },
        null,
        2
      ) + '\n'
    );
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    serverLog.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
