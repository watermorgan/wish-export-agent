import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const runtimeDir = path.join(repoRoot, '.tmp', 'service');
const pidFile = path.join(runtimeDir, 'wish-export-agent.pid');
const logFile = path.join(runtimeDir, 'wish-export-agent.log');
const port = Number(process.env.PORT ?? '3000');
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

function ensureRuntimeDir() {
  mkdirSync(runtimeDir, { recursive: true });
}

function pidFromFile() {
  if (!existsSync(pidFile)) {
    return null;
  }
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortListening(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`service did not become healthy within ${timeoutMs}ms`);
}

async function start() {
  ensureRuntimeDir();

  const existingPid = pidFromFile();
  if (existingPid && isProcessAlive(existingPid)) {
    console.log(`already running pid=${existingPid}`);
    return;
  }

  if (await isPortListening(port)) {
    throw new Error(`port ${port} is already in use; refuse to start unmanaged duplicate`);
  }

  if (!existsSync(path.join(repoRoot, '.next'))) {
    throw new Error('missing .next build output; run npm run build first');
  }

  const logFd = openSync(logFile, 'a');

  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      DATABASE_JDBC_URL: process.env.DATABASE_JDBC_URL ?? '',
      JDBC_DATABASE_URL: process.env.JDBC_DATABASE_URL ?? ''
    }
  });

  child.unref();
  writeFileSync(pidFile, `${child.pid}\n`, 'utf8');

  // Mirror readiness through a health probe; keep a concise log anchor for ops.
  const health = await waitForHealth(healthUrl);
  writeFileSync(
    logFile,
    `[${new Date().toISOString()}] started pid=${child.pid} port=${port} health=${JSON.stringify(
      health
    )}\n`,
    { encoding: 'utf8', flag: 'a' }
  );
  console.log(`started pid=${child.pid} port=${port}`);
}

function stop() {
  const pid = pidFromFile();
  if (!pid) {
    console.log('not running');
    return;
  }
  if (!isProcessAlive(pid)) {
    rmSync(pidFile, { force: true });
    console.log(`stale pid removed pid=${pid}`);
    return;
  }
  process.kill(pid, 'SIGTERM');
  rmSync(pidFile, { force: true });
  writeFileSync(logFile, `[${new Date().toISOString()}] stopped pid=${pid}\n`, {
    encoding: 'utf8',
    flag: 'a'
  });
  console.log(`stopped pid=${pid}`);
}

async function status() {
  const pid = pidFromFile();
  const listening = await isPortListening(port);
  let healthy = false;
  try {
    const response = await fetch(healthUrl);
    healthy = response.ok;
  } catch {
    healthy = false;
  }
  if (!pid) {
    console.log(JSON.stringify({ running: false, pid: null, port, listening, healthy }, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      {
        running: isProcessAlive(pid),
        pid,
        port,
        listening,
        healthy,
        pidFile,
        logFile
      },
      null,
      2
    )
  );
}

async function health() {
  const response = await fetch(healthUrl);
  const payload = await response.json();
  console.log(JSON.stringify({ status: response.status, payload }, null, 2));
}

async function restart() {
  stop();
  await start();
}

const command = process.argv[2];

switch (command) {
  case 'start':
    await start();
    break;
  case 'stop':
    stop();
    break;
  case 'restart':
    await restart();
    break;
  case 'status':
    await status();
    break;
  case 'health':
    await health();
    break;
  default:
    console.error('usage: node scripts/manage-service.mjs <start|stop|restart|status|health>');
    process.exit(1);
}
