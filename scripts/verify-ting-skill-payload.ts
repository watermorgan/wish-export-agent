import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import {
  buildTingPdfTranslationPayload,
  getPdfTranslationSkillPayload
} from '@/lib/assistant/pdf-translation-skill';
import { getTask } from '@/lib/assistant/task-store';
import type { AssistantReply, AssistantRequest } from '@/lib/assistant/types';

type StepResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

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

async function verifyHelperBranches() {
  const stored = await getTask('task_ui_fixture_preview');
  assert(stored, 'fixture task task_ui_fixture_preview should exist');

  const metadataPayload = getPdfTranslationSkillPayload(stored.reply);
  assert(metadataPayload, 'metadata-first helper lookup should return payload');
  assert(metadataPayload.kind === 'pdf_translation_skill_v1', 'metadata payload kind mismatch');
  assert(
    metadataPayload.humanReviewGuide?.summary,
    'metadata payload should preserve human review guide summary'
  );
  assert(
    metadataPayload.deliveryPdfUrl === '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
    'metadata payload should expose deliveryPdfUrl'
  );
  assert(
    metadataPayload.artifactLinks[0]?.annotatedPreviewUrl === '/preview/task/task_ui_fixture_preview',
    'metadata payload should preserve fixture preview link'
  );

  const artifactOnlyReply: AssistantReply = stored.reply.metadata
    ? {
        ...stored.reply,
        metadata: {
          ...stored.reply.metadata,
          skillPayload: undefined
        }
      }
    : {
        ...stored.reply
      };
  const artifactPayload = getPdfTranslationSkillPayload(artifactOnlyReply);
  assert(artifactPayload, 'artifact fallback helper lookup should return payload');
  assert(artifactPayload.kind === 'pdf_translation_skill_v1', 'artifact payload kind mismatch');
  assert(
    artifactPayload.humanReviewGuide?.summary,
    'artifact payload should preserve human review guide summary'
  );
  assert(
    artifactPayload.deliveryPdfUrl === '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
    'artifact payload should preserve deliveryPdfUrl'
  );
  assert(
    artifactPayload.artifactLinks[0]?.annotatedPreviewUrl === '/preview/task/task_ui_fixture_preview',
    'artifact payload should preserve fixture preview link'
  );

  const wrapped = buildTingPdfTranslationPayload(stored.record, artifactOnlyReply);
  assert(wrapped, 'Ting wrapper should be built from artifact fallback payload');
  assert(wrapped.kind === 'ting_pdf_translation_v1', 'Ting payload kind mismatch');
  assert(wrapped.result.kind === 'pdf_translation_skill_v1', 'Ting nested payload kind mismatch');
  assert(
    wrapped.result.deliveryPdfUrl === '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
    'Ting payload should inject deliveryPdfUrl'
  );
}

async function createBlockedTask(baseUrl: string) {
  const requestBody: AssistantRequest = {
    channel: 'web',
    role: 'sales',
    question: '创建阻断态 adapter 回归任务',
    files: [],
    taskType: 'feedback',
    selectedSkillIds: ['missing-skill']
  };

  const response = await fetch(`${baseUrl}/api/assistant`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  assert(response.ok, `assistant route should create blocked task, got ${response.status}`);
  const payload = await response.json();
  assert(payload?.task?.id, 'assistant response should include task id for blocked regression task');
  return String(payload.task.id);
}

async function verifyRouteSuccess(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/tasks/task_ui_fixture_preview/skill-payload`);
  assert(response.ok, `fixture route should return 200, got ${response.status}`);
  const payload = await response.json();
  assert(payload.kind === 'ting_pdf_translation_v1', 'top-level Ting kind mismatch');
  assert(payload.result?.kind === 'pdf_translation_skill_v1', 'nested skill payload kind mismatch');
  assert(
    typeof payload.result?.humanReviewGuide?.summary === 'string' &&
      payload.result.humanReviewGuide.summary.length > 0,
    'result.humanReviewGuide.summary should be present'
  );
  assert(
    payload.result?.deliveryPdfUrl === '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
    'fixture route should expose deliveryPdfUrl'
  );
  assert(
    payload.result?.artifactLinks?.[0]?.annotatedPreviewUrl === '/preview/task/task_ui_fixture_preview',
    'fixture route should preserve preview link'
  );
}

async function verifyRouteConflict(baseUrl: string) {
  const blockedTaskId = await createBlockedTask(baseUrl);
  const response = await fetch(`${baseUrl}/api/tasks/${blockedTaskId}/skill-payload`);
  assert(response.status === 409, `blocked task should return 409, got ${response.status}`);
  const payload = await response.json();
  assert(
    payload?.error === '当前任务尚未生成可供 skill/Ting 外贸助手复用的 PDF 结果协议。',
    '409 response should preserve no-skill-payload contract'
  );
}

function resolveNextBinPath() {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.resolve(process.cwd(), '..', 'node_modules', 'next', 'dist', 'bin', 'next'),
    path.resolve(process.cwd(), '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next')
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(
      'Cannot locate next binary in node_modules. Run npm install in the current workspace or repo root.'
    );
  }
  return resolved;
}

async function main() {
  const steps: StepResult[] = [];
  try {
    await verifyHelperBranches();
    steps.push({ name: 'helper-branches', passed: true });

    if (!existsSync(path.resolve(process.cwd(), '.next'))) {
      throw new Error('Missing .next build output. Run `npm run build` first.');
    }

    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const nextBin = resolveNextBinPath();
    const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-ting-skill-payload');
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
      steps.push({ name: 'server', passed: true });

      await verifyRouteSuccess(baseUrl);
      steps.push({ name: 'route-success', passed: true });

      await verifyRouteConflict(baseUrl);
      steps.push({ name: 'route-409', passed: true });
    } finally {
      server.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 400));
      serverLog.end();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const lastStep = steps.at(-1)?.name ?? 'verify-ting-skill-payload';
    steps.push({ name: lastStep, passed: false, detail });
  }

  const failed = steps.filter((step) => !step.passed);
  if (failed.length > 0) {
    console.error('Ting skill payload verification failed:');
    for (const step of failed) {
      console.error(`- ${step.name}: ${step.detail ?? 'failed'}`);
    }
    process.exit(1);
  }

  console.log('Ting skill payload verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
