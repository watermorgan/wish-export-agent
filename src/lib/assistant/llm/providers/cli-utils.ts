import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseExtraArgs(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function runCliCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
) {
  return execFileAsync(command, args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env
  });
}

function shellEscape(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function runCliCommandViaShell(
  shell: string,
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
) {
  const commandLine = [command, ...args.map((arg) => shellEscape(arg))].join(' ');

  return execFileAsync(shell, ['-lc', commandLine], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env
  });
}
