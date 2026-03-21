import type { LlmProvider } from '@/lib/assistant/llm/types';
import {
  parseExtraArgs,
  runCliCommand,
  runCliCommandViaShell
} from '@/lib/assistant/llm/providers/cli-utils';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_EXTRA_ARGS = parseExtraArgs(process.env.CLAUDE_CLI_EXTRA_ARGS);
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS || '90000');
const CLAUDE_USE_SHELL = process.env.CLAUDE_CLI_USE_SHELL === '1';
const CLAUDE_SHELL = process.env.CLAUDE_CLI_SHELL || process.env.SHELL || '/bin/zsh';

export const claudeCliProvider: LlmProvider = {
  name: 'claude-cli',
  isAvailable: () => Boolean(CLAUDE_BIN),
  async generate(request) {
    const prompt = `${request.system}\n\n---\n\n${request.user}`;
    const finalArgs = ['-p', '--output-format', 'text', ...CLAUDE_EXTRA_ARGS, prompt];
    const timeoutMs = request.timeoutMs ?? CLAUDE_TIMEOUT_MS;
    const finalEnv = {
      ...process.env
    };
    const { stdout, stderr } = CLAUDE_USE_SHELL
      ? await runCliCommandViaShell(CLAUDE_SHELL, CLAUDE_BIN, finalArgs, timeoutMs, finalEnv)
      : await runCliCommand(CLAUDE_BIN, finalArgs, timeoutMs, finalEnv);

    const text = stdout.trim();
    if (!text) {
      throw new Error(
        `claude CLI 未返回有效文本输出。${stderr.trim() ? ` stderr: ${stderr.trim()}` : ''}`
      );
    }

    return {
      provider: 'claude-cli',
      text
    };
  }
};
