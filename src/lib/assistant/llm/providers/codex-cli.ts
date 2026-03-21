import type { LlmProvider } from '@/lib/assistant/llm/types';
import { parseExtraArgs, runCliCommand } from '@/lib/assistant/llm/providers/cli-utils';

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const CODEX_EXTRA_ARGS = parseExtraArgs(process.env.CODEX_CLI_EXTRA_ARGS);

export const codexCliProvider: LlmProvider = {
  name: 'codex-cli',
  isAvailable: () => Boolean(CODEX_BIN),
  async generate(request) {
    const prompt = `${request.system}\n\n---\n\n${request.user}`;
    const { stdout, stderr } = await runCliCommand(
      CODEX_BIN,
      ['exec', prompt, '--skip-git-repo-check', ...CODEX_EXTRA_ARGS],
      request.timeoutMs ?? 45000,
      {
        ...process.env
      }
    );

    const text = stdout.trim();
    if (!text) {
      throw new Error(
        `codex CLI 未返回有效文本输出。${stderr.trim() ? ` stderr: ${stderr.trim()}` : ''}`
      );
    }

    return {
      provider: 'codex-cli',
      text
    };
  }
};
