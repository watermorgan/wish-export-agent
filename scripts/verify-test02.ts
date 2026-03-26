import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  ensureRunDirectories,
  nowRunId,
  resolveManifestPath,
  writeJson,
  writeMarkdown
} from './lib/test02-harness';

type StepResult = {
  name: string;
  command: string;
  exitCode: number | null;
  passed: boolean;
  outputPath: string;
};

function parseArgs() {
  const runId = process.argv[2] ?? nowRunId();
  const manifestPath = resolveManifestPath(process.argv[3] ?? 'data/test02/manifest.json');
  const port = Number(process.env.TEST02_UI_PORT ?? '3106');
  const baseUrl = `http://localhost:${port}`;

  return { runId, manifestPath, port, baseUrl };
}

async function runCommand(
  name: string,
  command: string,
  args: string[],
  outputPath: string,
  extraEnv: Record<string, string> = {}
) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const fileHandle = await open(outputPath, 'w');

  return new Promise<StepResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', async (chunk) => {
      await fileHandle.appendFile(chunk);
    });
    child.stderr.on('data', async (chunk) => {
      await fileHandle.appendFile(chunk);
    });
    child.on('close', async (exitCode) => {
      await fileHandle.close();
      resolve({
        name,
        command: `${command} ${args.join(' ')}`.trim(),
        exitCode,
        passed: exitCode === 0,
        outputPath: path.relative(process.cwd(), outputPath)
      });
    });
  });
}

async function waitForServer(url: string, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return true;
      }
    } catch {
      // keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

function toMarkdown(
  runId: string,
  baseUrl: string,
  steps: StepResult[],
  gate: {
    samplesAllOk: boolean;
    comparisonsAllReady: boolean;
    uiAllPassed: boolean;
  },
  details: {
    summaryPath: string | null;
    uiSummaryPath: string | null;
  }
) {
  const lines: string[] = [];
  lines.push('# test02 Final Verification');
  lines.push('');
  lines.push(`- Run ID: \`${runId}\``);
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Step Results');
  lines.push('');
  lines.push('| Step | Passed | Exit Code | Log |');
  lines.push('| --- | --- | ---: | --- |');
  for (const step of steps) {
    lines.push(
      `| ${step.name} | ${step.passed ? 'yes' : 'no'} | ${step.exitCode ?? '-'} | \`${step.outputPath}\` |`
    );
  }
  lines.push('');
  lines.push('## Gate Checks');
  lines.push('');
  lines.push(`- 8 组脚本回归全部成功：${gate.samplesAllOk ? 'yes' : 'no'}`);
  lines.push(`- 8 组 comparison 全部生成：${gate.comparisonsAllReady ? 'yes' : 'no'}`);
  lines.push(`- 8 组页面自动回归全部通过：${gate.uiAllPassed ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Summary: \`${details.summaryPath ?? '-'}\``);
  lines.push(`- UI Summary: \`${details.uiSummaryPath ?? '-'}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { runId, manifestPath, port, baseUrl } = parseArgs();
  const dirs = await ensureRunDirectories(runId);
  const logsDir = path.join(dirs.reportsDir, 'logs');
  await mkdir(logsDir, { recursive: true });

  const nodeBinDir = process.env.TEST02_NODE_BIN_DIR ?? '/Users/weitao/.nvm/versions/node/v20.20.0/bin';
  const nodePath = process.env.TEST02_NODE_PATH ?? path.join(nodeBinDir, 'node');
  const npmPath = process.env.TEST02_NPM_PATH ?? path.join(nodeBinDir, 'npm');
  const npxPath = process.env.TEST02_NPX_PATH ?? path.join(nodeBinDir, 'npx');
  const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const baseEnv = {
    PATH: `${nodeBinDir}:${process.env.PATH ?? ''}`
  };

  const steps: StepResult[] = [];
  steps.push(
    await runCommand('lint', npmPath, ['run', 'lint'], path.join(logsDir, 'lint.log'), baseEnv)
  );
  steps.push(
    await runCommand(
      'build',
      npmPath,
      ['run', 'build'],
      path.join(logsDir, 'build.log'),
      {
        ...baseEnv,
        DATABASE_URL: '',
        DATABASE_JDBC_URL: '',
        JDBC_DATABASE_URL: ''
      }
    )
  );
  steps.push(
    await runCommand(
      'eval:test02',
      npmPath,
      ['run', 'eval:test02', '--', path.relative(process.cwd(), manifestPath), runId],
      path.join(logsDir, 'eval-test02.log'),
      baseEnv
    )
  );
  steps.push(
    await runCommand(
      'compare:test02',
      npmPath,
      ['run', 'compare:test02', '--', path.relative(process.cwd(), manifestPath), runId],
      path.join(logsDir, 'compare-test02.log'),
      baseEnv
    )
  );
  steps.push(
    await runCommand(
      'playwright:install',
      npxPath,
      ['playwright', 'install', 'chromium'],
      path.join(logsDir, 'playwright-install.log'),
      baseEnv
    )
  );

  let serverProcess: ReturnType<typeof spawn> | null = null;
  const serverLogPath = path.join(logsDir, 'server.log');
  let uiStep: StepResult = {
    name: 'verify:test02:ui',
    command: '',
    exitCode: null,
    passed: false,
    outputPath: path.relative(process.cwd(), path.join(logsDir, 'verify-test02-ui.log'))
  };

  if (steps.every((step) => step.passed)) {
    const serverLog = await open(serverLogPath, 'w');
    serverProcess = spawn(nodePath, [nextBin, 'start', '-p', String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...baseEnv,
        DATABASE_URL: '',
        DATABASE_JDBC_URL: '',
        JDBC_DATABASE_URL: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout?.on('data', async (chunk) => {
      await serverLog.appendFile(chunk);
    });
    serverProcess.stderr?.on('data', async (chunk) => {
      await serverLog.appendFile(chunk);
    });

    const healthy = await waitForServer(baseUrl);
    if (!healthy) {
      uiStep = {
        name: 'verify:test02:ui',
        command: `${nodePath} ${nextBin} start -p ${port}`,
        exitCode: 1,
        passed: false,
        outputPath: path.relative(process.cwd(), serverLogPath)
      };
    } else {
      uiStep = await runCommand(
        'verify:test02:ui',
        npmPath,
        ['run', 'verify:test02:ui', '--', path.relative(process.cwd(), manifestPath), runId, baseUrl],
        path.join(logsDir, 'verify-test02-ui.log'),
        baseEnv
      );
    }

    await serverLog.close();
  }

  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  steps.push(uiStep);

  const summaryPath = path.join(dirs.reportsDir, 'summary.json');
  const uiSummaryPath = path.join(dirs.uiDir, 'summary.json');
  const summary = existsSync(summaryPath)
    ? (JSON.parse(await readFile(summaryPath, 'utf8')) as {
        summaries: Array<{ status: string; comparisonReady?: boolean }>;
      })
    : null;
  const uiSummary = existsSync(uiSummaryPath)
    ? (JSON.parse(await readFile(uiSummaryPath, 'utf8')) as {
        failed: number;
      })
    : null;

  const gate = {
    samplesAllOk: Boolean(summary?.summaries?.length) && summary!.summaries.every((item) => item.status === 'ok'),
    comparisonsAllReady:
      Boolean(summary?.summaries?.length) && summary!.summaries.every((item) => item.comparisonReady === true),
    uiAllPassed: Boolean(uiSummary) && uiSummary!.failed === 0
  };

  const verification = {
    runId,
    manifestPath: path.relative(process.cwd(), manifestPath),
    baseUrl,
    generatedAt: new Date().toISOString(),
    steps,
    gate,
    passed:
      steps.every((step) => step.passed) &&
      gate.samplesAllOk &&
      gate.comparisonsAllReady &&
      gate.uiAllPassed
  };

  await writeJson(path.join(dirs.reportsDir, 'final-verification.json'), verification);
  await writeMarkdown(
    path.join(dirs.reportsDir, 'final-verification.md'),
    toMarkdown(runId, baseUrl, steps, gate, {
      summaryPath: existsSync(summaryPath) ? path.relative(process.cwd(), summaryPath) : null,
      uiSummaryPath: existsSync(uiSummaryPath) ? path.relative(process.cwd(), uiSummaryPath) : null
    })
  );

  console.log(JSON.stringify(verification, null, 2));
  if (!verification.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
