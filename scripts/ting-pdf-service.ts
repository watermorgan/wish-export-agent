import { readFile } from 'node:fs/promises';

import {
  AssistantTaskServiceError,
} from '@/lib/assistant/service';
import { parseAssistantJsonPayload } from '@/lib/assistant/task-input';

type Command = 'submit' | 'get-task' | 'get-skill-payload';
const USAGE =
  '用法: submit --base-url <url> --json-file <path>|--stdin | get-task --base-url <url> <taskId> | get-skill-payload --base-url <url> <taskId>';

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printError(status: number, message: string) {
  process.stderr.write(
    `${JSON.stringify(
      {
        status,
        error: message
      },
      null,
      2
    )}\n`
  );
}

function getCommand(argv: string[]): Command {
  const command = argv[0];

  if (command === 'submit' || command === 'get-task' || command === 'get-skill-payload') {
    return command;
  }

  throw new AssistantTaskServiceError(
    400,
    USAGE
  );
}

function getOptionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

function stripOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) {
    return args;
  }

  return args.filter((_, position) => position !== index && position !== index + 1);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
}

async function requestRemote(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new AssistantTaskServiceError(
      response.status,
      typeof payload?.error === 'string' ? payload.error : `请求失败: ${response.status}`
    );
  }

  return payload;
}

async function readJsonInput(args: string[]) {
  const jsonFileIndex = args.indexOf('--json-file');
  if (jsonFileIndex >= 0) {
    const filePath = args[jsonFileIndex + 1];
    if (!filePath) {
      throw new AssistantTaskServiceError(400, '--json-file 缺少路径。');
    }

    return parseAssistantJsonPayload(JSON.parse(await readFile(filePath, 'utf8')));
  }

  if (args.includes('--stdin')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (!input) {
      throw new AssistantTaskServiceError(400, '--stdin 未收到 JSON 输入。');
    }
    return parseAssistantJsonPayload(JSON.parse(input));
  }

  throw new AssistantTaskServiceError(400, 'submit 需要 --json-file <path> 或 --stdin。');
}

async function main() {
  try {
    const [, , ...argv] = process.argv;
    const command = getCommand(argv);
    const baseUrl = getOptionValue(argv, '--base-url');
    const commandArgs = stripOption(argv, '--base-url');

    if (!baseUrl) {
      throw new AssistantTaskServiceError(
        400,
        'Ting 外贸助手 CLI helper 必须通过 --base-url 指向已运行的 export-agent 服务实例。'
      );
    }

    if (command === 'submit') {
      const input = await readJsonInput(commandArgs.slice(1));
      printJson(
        await requestRemote(baseUrl, '/api/tasks', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(input)
        })
      );
      return;
    }

    const taskId = commandArgs[1];
    if (!taskId) {
      throw new AssistantTaskServiceError(400, `${command} 缺少 taskId。`);
    }

    if (command === 'get-task') {
      printJson(await requestRemote(baseUrl, `/api/tasks/${taskId}`));
      return;
    }

    printJson(await requestRemote(baseUrl, `/api/tasks/${taskId}/skill-payload`));
  } catch (error) {
    if (error instanceof AssistantTaskServiceError) {
      printError(error.status, error.message);
      process.exit(1);
    }

    if (error instanceof SyntaxError) {
      printError(400, `JSON 解析失败: ${error.message}`);
      process.exit(1);
    }

    const message = error instanceof Error ? error.message : String(error);
    printError(500, message);
    process.exit(1);
  }
}

main();
