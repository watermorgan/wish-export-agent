import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
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

async function runNodeScript(args: string[]): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
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

async function pollTaskReady(baseUrl: string, taskId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runCli(['get-task', '--base-url', baseUrl, taskId]);
    assert(run.code === 0, `get-task failed: ${run.stderr}`);
    const payload = parseJsonOutput(run.stdout);
    const phase = payload.reply?.metadata?.asyncProgress?.phase;
    if (!phase || phase === 'completed') {
      return payload;
    }
    if (phase === 'failed') {
      throw new Error(`task ${taskId} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`task ${taskId} did not complete in time`);
}

async function main() {
  assert(
    existsSync(path.resolve(process.cwd(), '.next')),
    'Missing .next build output. Run `npm run build` first.'
  );

  const pdfPath = path.resolve(process.argv[2] ?? path.resolve(process.cwd(), 'data/test02/M415013.pdf'));
  const st = await stat(pdfPath);
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-ting-adai-closed-loop');
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

  let createdFeedbackPath: string | null = null;

  try {
    await waitForServer(`${baseUrl}/api/health`);

    const submitPayload = {
      channel: 'web',
      role: 'sales',
      question: '请翻译这份 PDF 中的批注与意见为双语对照，并生成可下载产物。',
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
    };

    const submitRun = await runCli(
      ['submit', '--base-url', baseUrl, '--stdin'],
      JSON.stringify(submitPayload)
    );
    assert(submitRun.code === 0, `submit failed: ${submitRun.stderr}`);
    const created = parseJsonOutput(submitRun.stdout);
    const taskId = String(created.task?.id ?? '');
    assert(taskId.length > 0, 'submit output missing taskId');

    await pollTaskReady(baseUrl, taskId);

    const initialTaskRun = await runCli(['get-task', '--base-url', baseUrl, taskId]);
    assert(initialTaskRun.code === 0, `initial get-task failed: ${initialTaskRun.stderr}`);
    const initialTask = parseJsonOutput(initialTaskRun.stdout);
    assert(
      initialTask.reply?.metadata?.taskIteration?.revisionCount === 1,
      'base revisionCount should be 1'
    );

    const overrideRun = await runCli(
      ['override', '--base-url', baseUrl, taskId, '--stdin'],
      JSON.stringify({
        actor: 'sales',
        reason: '第2页保留原文，跳过翻译',
        pageOverrides: {
          skipTranslationPages: [2]
        }
      })
    );
    assert(overrideRun.code === 0, `override failed: ${overrideRun.stderr}`);
    const overridePayload = parseJsonOutput(overrideRun.stdout);
    const overrideRevisionId = String(overridePayload.task?.currentRevisionId ?? '');
    assert(overridePayload.reply?.metadata?.taskIteration?.latestRevision?.kind === 'override', 'override revision kind mismatch');

    // Verify override rejects forceVisionPages (must use rework)
    const overrideForceVisionRun = await runCli(
      ['override', '--base-url', baseUrl, taskId, '--stdin'],
      JSON.stringify({
        actor: 'sales',
        reason: 'should be rejected',
        pageOverrides: {
          forceVisionPages: [1]
        }
      })
    );
    assert(overrideForceVisionRun.code !== 0, 'override with forceVisionPages should fail');
    assert(
      overrideForceVisionRun.stderr.includes('forceVisionPages') || overrideForceVisionRun.stderr.includes('rework'),
      'override forceVisionPages rejection should mention rework'
    );

    const reworkRun = await runCli(
      ['rework', '--base-url', baseUrl, taskId, '--stdin'],
      JSON.stringify({
        actor: 'sales',
        scope: 'pages',
        pageNumbers: [1],
        instruction: '重新识别并翻译第1页，保持工艺单短句风格'
      })
    );
    assert(reworkRun.code === 0, `rework failed: ${reworkRun.stderr}`);
    const reworkPayload = parseJsonOutput(reworkRun.stdout);
    const reworkRevisionId = String(reworkPayload.task?.currentRevisionId ?? '');
    assert(reworkPayload.reply?.metadata?.taskIteration?.latestRevision?.kind === 'rework', 'rework revision kind mismatch');
    assert(reworkPayload.task?.reviewStatus === 'not_submitted', 'rework should not change task reviewStatus');

    const revisionRun = await runCli([
      'get-revision',
      '--base-url',
      baseUrl,
      taskId,
      overrideRevisionId
    ]);
    assert(revisionRun.code === 0, `get-revision failed: ${revisionRun.stderr}`);
    const revisionPayload = parseJsonOutput(revisionRun.stdout);
    assert(revisionPayload.revision?.id === overrideRevisionId, 'historical override revision lookup mismatch');
    assert(revisionPayload.current === false, 'historical revision should not be current');

    const finalSkillPayloadRun = await runCli([
      'get-skill-payload',
      '--base-url',
      baseUrl,
      taskId
    ]);
    assert(finalSkillPayloadRun.code === 0, `final get-skill-payload failed: ${finalSkillPayloadRun.stderr}`);
    const finalSkillPayload = parseJsonOutput(finalSkillPayloadRun.stdout);
    assert(finalSkillPayload.result?.revision?.id === reworkRevisionId, 'final payload should expose current rework revision');
    assert(
      JSON.stringify(finalSkillPayload.result?.diagnostics?.skippedTranslationPages ?? []) === JSON.stringify([2]),
      'final payload should expose skipped pages'
    );

    const feedbackRun = await runCli(
      ['submit-feedback', '--base-url', baseUrl, '--stdin'],
      JSON.stringify({
        category: 'translation_error',
        priority: 'high',
        source: {
          taskId,
          fileName: path.basename(pdfPath),
          pageNumber: 1,
          sourceText: 'MATCHING COLOR WITH OUTSHELL FABRIC',
          currentTranslation: '顺色',
          expectedTranslation: '配色同面布'
        },
        reporter: 'ting-closed-loop',
        tags: ['ting', 'closed-loop', 'runtime']
      })
    );
    assert(feedbackRun.code === 0, `submit-feedback failed: ${feedbackRun.stderr}`);
    const feedbackPayload = parseJsonOutput(feedbackRun.stdout);
    const feedbackId = String(feedbackPayload.id ?? '');
    createdFeedbackPath = typeof feedbackPayload.path === 'string' ? path.resolve(process.cwd(), feedbackPayload.path) : null;
    assert(feedbackId.length > 0, 'feedback id missing');

    const reviewRun = await runNodeScript([
      'scripts/review-feedback-cases.ts',
      '--status=open',
      '--priority=high'
    ]);
    assert(reviewRun.code === 0, `feedback review failed: ${reviewRun.stderr}`);
    assert(reviewRun.stdout.includes(feedbackId), 'feedback review output should include created feedback id');

    const resolveRun = await runNodeScript([
      'scripts/resolve-feedback-case.ts',
      '--id',
      feedbackId,
      '--status',
      'resolved',
      '--action',
      'normalize_rule_update',
      '--detail',
      'Closed-loop runtime verification',
      '--by',
      'adai-verify'
    ]);
    assert(resolveRun.code === 0, `feedback resolve failed: ${resolveRun.stderr}`);
    assert(resolveRun.stdout.includes(`updated=${feedbackId}`), 'feedback resolve should update created feedback id');

    const resolvedCase = JSON.parse(await readFile(createdFeedbackPath as string, 'utf8')) as {
      status?: string;
      resolution?: { action?: string };
    };
    assert(resolvedCase.status === 'resolved', 'resolved feedback status mismatch');
    assert(resolvedCase.resolution?.action === 'normalize_rule_update', 'resolved feedback action mismatch');

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          taskId,
          overrideRevisionId,
          reworkRevisionId,
          feedbackId
        },
        null,
        2
      ) + '\n'
    );
    process.stdout.write('Ting-led / 阿呆-assisted closed loop verification passed.\n');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
    serverLog.end();
    if (createdFeedbackPath) {
      await rm(createdFeedbackPath, { force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
