import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const outputPath = path.join(rootDir, '.tmp', 'llm-provider-health.json');

function splitExtraArgs(value) {
  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function runCheck(name, command, args, timeoutMs = 20000) {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env }
    });

    return {
      name,
      ok: stdout.trim().length > 0,
      durationMs: Date.now() - startedAt,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const codexBin = process.env.CODEX_BIN || 'codex';
  const modelScopeApiKey = process.env.MODELSCOPE_API_KEY;
  const modelScopeUrl =
    process.env.MODELSCOPE_API_URL ?? 'https://api-inference.modelscope.cn/v1/chat/completions';
  const modelScopeModel = process.env.MODELSCOPE_MODEL ?? 'Qwen/Qwen3.5-35B-A3B';

  const checks = await Promise.all([
    modelScopeApiKey
      ? (async () => {
          const startedAt = Date.now();
          try {
            const response = await fetch(modelScopeUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${modelScopeApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: modelScopeModel,
                messages: [
                  {
                    role: 'user',
                    content: 'Reply with exactly HELLO'
                  }
                ]
              })
            });

            const text = await response.text();
            return {
              name: 'modelscope',
              ok: response.ok && text.length > 0,
              durationMs: Date.now() - startedAt,
              status: response.status,
              bodyPreview: text.slice(0, 400)
            };
          } catch (error) {
            return {
              name: 'modelscope',
              ok: false,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        })()
      : Promise.resolve({
          name: 'modelscope',
          ok: false,
          skipped: true,
          reason: 'MODELSCOPE_API_KEY not configured'
        }),
    runCheck(
      'claude-cli',
      claudeBin,
      [
        '-p',
        '--output-format',
        'text',
        ...splitExtraArgs(process.env.CLAUDE_CLI_EXTRA_ARGS),
        'Reply with exactly HELLO'
      ],
      Number(process.env.CLAUDE_CLI_TIMEOUT_MS || '90000')
    ),
    runCheck('codex-cli', codexBin, [
      'exec',
      'Reply with exactly HELLO',
      '--skip-git-repo-check',
      ...splitExtraArgs(process.env.CODEX_CLI_EXTRA_ARGS)
    ])
  ]);

  const report = {
    checkedAt: new Date().toISOString(),
    checks
  };

  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
