#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts', 'repair-openclaw-cron-session-isolation.mjs');
const home = mkdtempSync(join(tmpdir(), 'openclaw-cron-isolation-'));
const cronDir = join(home, 'cron');
const tingSessionsDir = join(home, 'agents', 'ting', 'sessions');

mkdirSync(cronDir, { recursive: true });
mkdirSync(tingSessionsDir, { recursive: true });

const sessionId = 'polluted-session';
const sessionKey = 'agent:ting:dingtalk:direct:12443063651233525';
const sessionFile = join(tingSessionsDir, `${sessionId}.jsonl`);

writeFileSync(join(cronDir, 'jobs.json'), `${JSON.stringify({
  version: 1,
  jobs: [
    {
      id: 'weekly-job',
      agentId: 'ting',
      sessionKey,
      name: 'weekly-memory-archive',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 22 * * 0', tz: 'Asia/Shanghai' },
      sessionTarget: `session:${sessionKey}`,
      payload: {
        kind: 'agentTurn',
        message: '执行每周记忆归档'
      },
      delivery: {
        mode: 'announce',
        channel: 'dingtalk',
        to: '12443063651233525'
      }
    },
    {
      id: 'already-isolated',
      agentId: 'ting',
      sessionKey: 'agent:ting:cron:already-isolated',
      name: 'already-isolated',
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'noop' }
    }
  ]
}, null, 2)}\n`, 'utf8');

writeFileSync(join(tingSessionsDir, 'sessions.json'), `${JSON.stringify({
  [sessionKey]: {
    sessionId,
    sessionFile,
    updatedAt: Date.now()
  },
  'agent:ting:main': {
    sessionId: 'main'
  }
}, null, 2)}\n`, 'utf8');
writeFileSync(sessionFile, '{"type":"message","message":{"content":"[cron:weekly-job weekly-memory-archive] 执行每周记忆归档"}}\n', 'utf8');

const check = run('--check');
assert.equal(check.needsCronPatch, true);
assert.equal(check.needsDirectSessionReset, true);
assert.equal(check.cronJobsPatched.length, 1);
assert.equal(check.pollutedDirectSessions.length, 1);

const applied = run('--reset-polluted-direct-sessions');
assert.equal(applied.changed, true);
assert.equal(applied.cronJobsPatched.length, 1);
assert.equal(applied.directSessionsReset.length, 1);

const jobs = JSON.parse(readFileSync(join(cronDir, 'jobs.json'), 'utf8'));
const weeklyJob = jobs.jobs.find((job) => job.id === 'weekly-job');
assert.equal(weeklyJob.sessionTarget, 'isolated');
assert.equal(weeklyJob.sessionKey, 'agent:ting:cron:weekly-job');

const sessions = JSON.parse(readFileSync(join(tingSessionsDir, 'sessions.json'), 'utf8'));
assert.equal(Object.hasOwn(sessions, sessionKey), false);
assert.equal(Object.hasOwn(sessions, 'agent:ting:main'), true);

const after = run('--check');
assert.equal(after.needsCronPatch, false);
assert.equal(after.needsDirectSessionReset, false);

console.log(JSON.stringify({
  status: 'ok',
  fixtureHome: home,
  checked: {
    cronIsolation: true,
    pollutedDirectSessionReset: true,
    idempotentAfterApply: true
  }
}, null, 2));

function run(...args) {
  const output = execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENCLAW_HOME: home
    },
    encoding: 'utf8'
  });
  return JSON.parse(output);
}
