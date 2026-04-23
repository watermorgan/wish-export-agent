import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const NODE20_BIN = '/Users/weitao/.nvm/versions/node/v20.20.0/bin/node';
const NODE22_BIN = '/Users/weitao/.nvm/versions/node/v22.22.2/bin/node';

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

class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = '';
  private readonly stdin: NonNullable<ReturnType<typeof spawn>['stdin']>;

  constructor(private readonly child: ReturnType<typeof spawn>) {
    if (!child.stdout || !child.stdin) {
      throw new Error('MCP child process must expose stdin/stdout pipes.');
    }

    this.stdin = child.stdin;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '').trim();
        if (!trimmed) {
          continue;
        }

        const message = JSON.parse(trimmed) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof message.id === 'number' && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message ?? 'MCP error'));
          } else {
            pending.resolve(message.result);
          }
        }
      }
    });
  }

  request(method: string, params?: unknown) {
    const id = this.nextId++;
    const json = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    });
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      this.stdin.write(`${json}\n`);
    });
  }

  notify(method: string, params?: unknown) {
    const json = JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params })
    });
    this.stdin.write(`${json}\n`);
  }
}

async function main() {
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const logsDir = path.resolve(process.cwd(), '.tmp', 'verify-ting-mcp-server');
  const serviceLogPath = path.join(logsDir, 'service.log');
  const mcpLogPath = path.join(logsDir, 'mcp.log');
  await mkdir(logsDir, { recursive: true });
  const serviceLog = createWriteStream(serviceLogPath, { flags: 'w' });
  const mcpLog = createWriteStream(mcpLogPath, { flags: 'w' });

  const service = spawn(
    NODE20_BIN,
    [nextBin, 'start', '-p', String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REWORK_PIPELINE_TIMEOUT_MS: '1',
        DATABASE_URL: '',
        DATABASE_JDBC_URL: '',
        JDBC_DATABASE_URL: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  service.stdout?.pipe(serviceLog);
  service.stderr?.pipe(serviceLog);

  await waitForServer(`${baseUrl}/api/health`);

  const mcpServer = spawn(
    NODE22_BIN,
    [path.resolve(process.cwd(), 'scripts/ting-pdf-mcp-server.mjs')],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXPORT_AGENT_BASE_URL: baseUrl
      },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  mcpServer.stderr?.pipe(mcpLog);
  const client = new McpClient(mcpServer);

  try {
    const initResult = (await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'verify-ting-mcp-server',
        version: '0.1.0'
      }
    })) as {
      protocolVersion: string;
      capabilities?: { tools?: unknown };
    };

    assert(initResult.protocolVersion === '2025-11-25', 'MCP server should negotiate protocol version');
    assert(initResult.capabilities?.tools, 'MCP server should advertise tools capability');
    client.notify('notifications/initialized');

    const listResult = (await client.request('tools/list')) as {
      tools: Array<{ name: string }>;
    };
    const toolNames = listResult.tools.map((tool) => tool.name);
    assert(toolNames.includes('submit_pdf_translation_task'), 'submit tool should be registered');
    assert(toolNames.includes('get_pdf_translation_task'), 'get-task tool should be registered');
    assert(
      toolNames.includes('get_pdf_translation_skill_payload'),
      'get-skill-payload tool should be registered'
    );
    assert(toolNames.includes('submit_task_overrides'), 'override tool should be registered');
    assert(toolNames.includes('request_task_rework'), 'rework tool should be registered');
    assert(toolNames.includes('get_task_revision'), 'get-revision tool should be registered');
    assert(toolNames.includes('submit_feedback_case'), 'feedback tool should be registered');

    const happy = (await client.request('tools/call', {
      name: 'get_pdf_translation_skill_payload',
      arguments: {
        taskId: 'task_ui_fixture_preview'
      }
    })) as {
      isError?: boolean;
      structuredContent?: {
        kind?: string;
        result?: {
          kind?: string;
          deliveryPdfUrl?: string;
          humanReviewGuide?: { summary?: string };
          artifactLinks?: Array<{ annotatedPreviewUrl?: string }>;
        };
      };
    };

    assert(!happy.isError, 'fixture skill payload tool call should succeed');
    assert(
      happy.structuredContent?.kind === 'ting_pdf_translation_v1',
      'fixture skill payload should preserve top-level kind'
    );
    assert(
      happy.structuredContent?.result?.kind === 'pdf_translation_skill_v1',
      'fixture skill payload should preserve nested skill payload kind'
    );
    assert(
      typeof happy.structuredContent?.result?.humanReviewGuide?.summary === 'string' &&
        happy.structuredContent.result.humanReviewGuide.summary.length > 0,
      'fixture skill payload should preserve human review guide summary'
    );
    assert(
      happy.structuredContent?.result?.deliveryPdfUrl ===
        '/api/tasks/task_ui_fixture_preview/translation-pdf?download=1',
      'fixture skill payload should expose deliveryPdfUrl'
    );
    assert(
      happy.structuredContent?.result?.artifactLinks?.[0]?.annotatedPreviewUrl ===
        '/preview/task/task_ui_fixture_preview',
      'fixture skill payload should preserve preview link'
    );

    const blockedSubmit = (await client.request('tools/call', {
      name: 'submit_pdf_translation_task',
      arguments: {
        question: '创建阻断态 MCP 回归任务',
        selectedSkillIds: ['missing-skill']
      }
    })) as {
      isError?: boolean;
      structuredContent?: {
        task?: { id?: string };
      };
    };

    assert(!blockedSubmit.isError, 'blocked submit should still create a task successfully');
    const blockedTaskId = blockedSubmit.structuredContent?.task?.id;
    assert(typeof blockedTaskId === 'string' && blockedTaskId.length > 0, 'blocked submit should return task id');

    const blockedTask = (await client.request('tools/call', {
      name: 'get_pdf_translation_task',
      arguments: {
        taskId: blockedTaskId
      }
    })) as {
      isError?: boolean;
      structuredContent?: {
        task?: { id?: string };
      };
    };
    assert(!blockedTask.isError, 'blocked task fetch should succeed');
    assert(blockedTask.structuredContent?.task?.id === blockedTaskId, 'get-task should return blocked task');

    const conflict = (await client.request('tools/call', {
      name: 'get_pdf_translation_skill_payload',
      arguments: {
        taskId: blockedTaskId
      }
    })) as {
      isError?: boolean;
      structuredContent?: {
        status?: number;
        error?: string;
      };
    };
    assert(conflict.isError === true, 'blocked task skill payload should report tool error');
    assert(conflict.structuredContent?.status === 409, 'blocked task skill payload should preserve 409');
    assert(
      conflict.structuredContent?.error === '当前任务尚未生成可供 skill/Ting 外贸助手复用的 PDF 结果协议。',
      'blocked task skill payload should preserve 409 error message'
    );

    const realSubmit = (await client.request('tools/call', {
      name: 'submit_pdf_translation_task',
      arguments: {
        question: '创建 override 失败态 MCP 回归任务',
        pdfPath: path.resolve(process.cwd(), 'data/test02/M415013.pdf')
      }
    })) as {
      structuredContent?: { task?: { id?: string } };
    };
    const realTaskId = realSubmit.structuredContent?.task?.id;
    assert(typeof realTaskId === 'string' && realTaskId.length > 0, 'real submit should return task id');

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const taskSnapshot = (await client.request('tools/call', {
        name: 'get_pdf_translation_task',
        arguments: {
          taskId: realTaskId
        }
      })) as {
        structuredContent?: {
          task?: { status?: string };
          reply?: { metadata?: { asyncProgress?: { phase?: string } } };
        };
      };
      const phase = taskSnapshot.structuredContent?.reply?.metadata?.asyncProgress?.phase;
      if (!phase || phase === 'completed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const failingOverride = (await client.request('tools/call', {
      name: 'request_task_rework',
      arguments: {
        taskId: realTaskId,
        actor: 'sales',
        scope: 'pages',
        pageNumbers: [1],
        instruction: 'force timeout failure path'
      }
    })) as {
      isError?: boolean;
      structuredContent?: {
        status?: number;
        failedRevisionId?: string;
        revisionLookupUrl?: string;
      };
    };
    assert(failingOverride.isError === true, 'failing rework should report tool error');
    assert(failingOverride.structuredContent?.status === 409, 'failing rework should preserve 409');
    assert(typeof failingOverride.structuredContent?.failedRevisionId === 'string', 'MCP should preserve failedRevisionId');
    assert(typeof failingOverride.structuredContent?.revisionLookupUrl === 'string', 'MCP should preserve revisionLookupUrl');

    process.stdout.write('Ting MCP server verification passed.\n');
  } finally {
    mcpServer.stdin.end();
    mcpServer.kill('SIGTERM');
    service.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
    serviceLog.end();
    mcpLog.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
