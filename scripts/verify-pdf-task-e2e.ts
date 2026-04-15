/**
 * 端到端：POST /api/tasks（异步）→ 轮询任务 → GET skill-payload → 可选探测产物 URL。
 * 用法: npx tsx scripts/verify-pdf-task-e2e.ts [pdf绝对路径]
 * 默认 PDF: data/test02/M415013.pdf
 */
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

type TingPayload = {
  kind: string;
  result?: {
    kind: string;
    deliveryPdfUrl?: string | null;
    artifactLinks?: Array<{
      primary?: string;
      bilingualXlsxUrl?: string | null;
      annotatedPreviewUrl?: string | null;
      annotatedPdfUrl?: string | null;
      tableStylePdfUrl?: string | null;
    }>;
    diagnostics?: Record<string, unknown>;
    summary?: string;
  };
};

async function main() {
  const defaultPdf = path.resolve(process.cwd(), 'data/test02/M415013.pdf');
  const pdfPath = path.resolve(process.argv[2] ?? defaultPdf);
  const st = await stat(pdfPath);

  if (!process.env.ASSISTANT_FORCE_GOLDEN) {
    process.stdout.write(
      '[verify-pdf-task-e2e] 使用真实 PDF pipeline（未设置 ASSISTANT_FORCE_GOLDEN）。\n'
    );
  }

  assert(
    existsSync(path.resolve(process.cwd(), '.next')),
    '缺少 .next，请先执行 npm run build'
  );

  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-pdf-task-e2e');
  const serverLogPath = path.join(logsDir, 'server.log');
  await mkdir(logsDir, { recursive: true });
  const serverLog = createWriteStream(serverLogPath, { flags: 'w' });

  const pollIntervalMs = Math.max(2000, Number(process.env.E2E_POLL_MS ?? '3000'));
  const maxWaitMs = Math.max(60_000, Number(process.env.E2E_MAX_WAIT_MS ?? `${45 * 60 * 1000}`));

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

    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
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
      })
    });
    assert(response.ok, `POST /api/tasks 应成功，实际 ${response.status}`);
    const created = (await response.json()) as {
      task?: { id?: string; status?: string };
      reply?: { metadata?: { asyncProgress?: { phase?: string } } };
    };
    assert(created.task?.id, '响应应包含 task.id');
    const taskId = created.task.id as string;
    process.stdout.write(`[verify-pdf-task-e2e] taskId=${taskId}\n`);

    const deadline = Date.now() + maxWaitMs;
    let lastPhase = '';
    while (Date.now() < deadline) {
      const poll = await fetch(`${baseUrl}/api/tasks/${taskId}`);
      assert(poll.ok, `GET /api/tasks/${taskId} 应成功，实际 ${poll.status}`);
      const body = (await poll.json()) as {
        task?: { status?: string };
        reply?: { status?: string; metadata?: { asyncProgress?: { phase?: string; stage?: string } } };
      };
      const phase = body.reply?.metadata?.asyncProgress?.phase ?? '';
      const stage = body.reply?.metadata?.asyncProgress?.stage ?? '';
      if (phase !== lastPhase) {
        lastPhase = phase;
        process.stdout.write(`[verify-pdf-task-e2e] asyncProgress.phase=${phase} stage=${stage}\n`);
      }
      if (phase === 'failed') {
        throw new Error('异步任务 phase=failed，见 .tmp/verify-pdf-task-e2e/server.log');
      }
      if (phase === 'completed') {
        assert(
          body.task?.status && body.task.status !== 'validating',
          'completed 时 task.status 应离开 validating'
        );
        break;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    assert(Date.now() < deadline, `等待完成超时（${maxWaitMs}ms），见 server.log`);

    const spRes = await fetch(`${baseUrl}/api/tasks/${taskId}/skill-payload`);
    assert(spRes.ok, `GET skill-payload 应成功，实际 ${spRes.status}`);
    const ting = (await spRes.json()) as TingPayload;
    assert(ting.kind === 'ting_pdf_translation_v1', '顶层 kind 应为 ting_pdf_translation_v1');
    assert(ting.result?.kind === 'pdf_translation_skill_v1', 'result.kind 应为 pdf_translation_skill_v1');
    assert(ting.result?.deliveryPdfUrl, '应包含 deliveryPdfUrl（原文标注翻译 PDF）');
    const links = ting.result?.artifactLinks ?? [];
    assert(links.length > 0, 'artifactLinks 不应为空');

    const preview = links.find((l) => l.annotatedPreviewUrl);
    const tableEntry = links.find((l) => l.primary === 'bilingual_xlsx' || l.bilingualXlsxUrl);
    const annotatedEntry = links.find((l) => l.annotatedPdfUrl);

    assert(preview?.annotatedPreviewUrl, '应包含 annotated 预览 URL');
    assert(annotatedEntry?.annotatedPdfUrl, '应包含 annotatedPdfUrl');
    assert(tableEntry?.bilingualXlsxUrl, '应包含 bilingual xlsx URL');
    assert(
      tableEntry?.tableStylePdfUrl,
      '应包含 tableStylePdfUrl（表格排版 PDF）；若缺失请检查 CJK 字体与 materialize 日志'
    );

    for (const label of ['delivery', 'preview', 'xlsx', 'pdf'] as const) {
      const urlPath =
        label === 'delivery'
          ? ting.result?.deliveryPdfUrl
          : label === 'preview'
          ? preview?.annotatedPreviewUrl
          : label === 'xlsx'
            ? tableEntry?.bilingualXlsxUrl
            : tableEntry?.tableStylePdfUrl;
      assert(urlPath && urlPath.startsWith('/'), `${label} 应为站内 path`);
      const head = await fetch(`${baseUrl}${urlPath}`, { method: 'GET' });
      assert(head.ok, `产物 GET ${urlPath} 应200，实际 ${head.status}`);
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          taskId,
          summary: ting.result?.summary,
          diagnostics: ting.result?.diagnostics,
          artifactLinks: links.map((l) => ({
            primary: l.primary,
            bilingualXlsxUrl: l.bilingualXlsxUrl,
            annotatedPreviewUrl: l.annotatedPreviewUrl,
            annotatedPdfUrl: l.annotatedPdfUrl,
            tableStylePdfUrl: l.tableStylePdfUrl
          }))
        },
        null,
        2
      ) + '\n'
    );
    process.stdout.write('[verify-pdf-task-e2e] 全链路通过。\n');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    serverLog.end();
    process.stdout.write(`[verify-pdf-task-e2e] server 日志: ${serverLogPath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
