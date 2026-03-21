import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LlmProvider } from '@/lib/assistant/llm/types';
import { parseExtraArgs, runCliCommand } from '@/lib/assistant/llm/providers/cli-utils';

const DEFAULT_GEMINI_BIN = join(dirname(process.execPath), 'gemini');
const GEMINI_BIN = process.env.GEMINI_BIN || DEFAULT_GEMINI_BIN;
const GEMINI_EXTRA_ARGS = parseExtraArgs(process.env.GEMINI_CLI_EXTRA_ARGS);

async function resolveGeminiCommand() {
  const resolved = await realpath(GEMINI_BIN).catch(() => GEMINI_BIN);

  if (resolved.endsWith('.js')) {
    return {
      command: process.execPath,
      preArgs: [resolved]
    };
  }

  return {
    command: GEMINI_BIN,
    preArgs: []
  };
}

export const geminiCliProvider: LlmProvider = {
  name: 'gemini-cli',
  isAvailable: () => Boolean(GEMINI_BIN),
  async generate(request) {
    const prompt = `${request.system}\n\n---\n\n${request.user}`;
    const geminiCommand = await resolveGeminiCommand();
    const { stdout, stderr } = await runCliCommand(
      geminiCommand.command,
      [
        ...geminiCommand.preArgs,
        '-p',
        prompt,
        '-o',
        'text',
        '--approval-mode',
        'plan',
        ...GEMINI_EXTRA_ARGS
      ],
      request.timeoutMs ?? 45000,
      {
        ...process.env
      }
    );

    const text = stdout.trim();

    if (!text) {
      throw new Error(
        `gemini CLI 未返回有效文本输出。${stderr.trim() ? ` stderr: ${stderr.trim()}` : ''}`
      );
    }

    return {
      provider: 'gemini-cli',
      text
    };
  }
};
