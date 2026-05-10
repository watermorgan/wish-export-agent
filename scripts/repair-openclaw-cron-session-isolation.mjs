#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/Users/weitao/.openclaw';
const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json');
const BACKUP_DIR = join(OPENCLAW_HOME, 'backups');
const DIRECT_SESSION_PATTERN = /^agent:[^:]+:(?:dingtalk|feishu):direct:/;
const SESSION_TARGET_DIRECT_PATTERN = /^session:agent:[^:]+:(?:dingtalk|feishu):direct:/;
const CRON_CONTAMINATION_PATTERNS = [
  '[cron:',
  'weekly-memory-archive',
  '执行每周记忆归档'
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const resetPolluted = args.has('--reset-polluted-direct-sessions');

main();

function main() {
  const report = {
    cronJobsPath: CRON_JOBS_PATH,
    mode: checkOnly ? 'check' : 'apply',
    changed: false,
    cronJobsPatched: [],
    pollutedDirectSessions: [],
    directSessionsReset: [],
    backups: []
  };

  const rawJobs = readFileSync(CRON_JOBS_PATH, 'utf8');
  const jobsConfig = JSON.parse(rawJobs);
  let jobsChanged = false;

  for (const job of jobsConfig.jobs ?? []) {
    const before = {
      sessionKey: job.sessionKey,
      sessionTarget: job.sessionTarget
    };

    if (shouldIsolateCronJob(job)) {
      job.sessionTarget = 'isolated';
      if (typeof job.agentId === 'string' && job.agentId.trim()) {
        job.sessionKey = `agent:${job.agentId.trim()}:cron:${job.id}`;
      } else {
        delete job.sessionKey;
      }
    }

    if (before.sessionKey !== job.sessionKey || before.sessionTarget !== job.sessionTarget) {
      jobsChanged = true;
      report.cronJobsPatched.push({
        id: job.id,
        name: job.name,
        before,
        after: {
          sessionKey: job.sessionKey,
          sessionTarget: job.sessionTarget
        }
      });
    }
  }

  const directSessionReports = findPollutedDirectSessions();
  report.pollutedDirectSessions = directSessionReports.map(({ agentId, key, sessionId, sessionFile, reason }) => ({
    agentId,
    key,
    sessionId,
    sessionFile,
    reason
  }));

  if (!checkOnly && jobsChanged) {
    report.backups.push(backupFile(CRON_JOBS_PATH));
    writeFileSync(CRON_JOBS_PATH, `${JSON.stringify(jobsConfig, null, 2)}\n`, 'utf8');
    report.changed = true;
  }

  if (!checkOnly && resetPolluted) {
    for (const directSession of directSessionReports) {
      const reset = resetDirectSession(directSession);
      report.directSessionsReset.push(reset);
      report.backups.push(...reset.backups);
      report.changed = true;
    }
  }

  console.log(JSON.stringify({
    ...report,
    needsCronPatch: report.cronJobsPatched.length > 0,
    needsDirectSessionReset: report.pollutedDirectSessions.length > 0
  }, null, 2));
}

function shouldIsolateCronJob(job) {
  if (!job || typeof job !== 'object') {
    return false;
  }

  const payloadKind = job.payload?.kind;
  const sessionKey = typeof job.sessionKey === 'string' ? job.sessionKey : '';
  const sessionTarget = typeof job.sessionTarget === 'string' ? job.sessionTarget : '';

  if (payloadKind !== 'agentTurn') {
    return false;
  }

  return DIRECT_SESSION_PATTERN.test(sessionKey) || SESSION_TARGET_DIRECT_PATTERN.test(sessionTarget);
}

function findPollutedDirectSessions() {
  const reports = [];
  const agentsDir = join(OPENCLAW_HOME, 'agents');
  const agentIds = ['main', 'ting', 'adae', 'faq-bot'];

  for (const agentId of agentIds) {
    const storePath = join(agentsDir, agentId, 'sessions', 'sessions.json');
    if (!existsSync(storePath)) {
      continue;
    }

    const store = JSON.parse(readFileSync(storePath, 'utf8'));
    const sessions = getSessionMap(store);
    for (const [key, entry] of Object.entries(sessions)) {
      if (!DIRECT_SESSION_PATTERN.test(key)) {
        continue;
      }

      const sessionFile = entry?.sessionFile ?? (
        entry?.sessionId ? join(agentsDir, agentId, 'sessions', `${entry.sessionId}.jsonl`) : ''
      );
      if (!sessionFile || !existsSync(sessionFile)) {
        continue;
      }

      const content = readFileSync(sessionFile, 'utf8');
      const reason = CRON_CONTAMINATION_PATTERNS.find((pattern) => content.includes(pattern));
      if (reason) {
        reports.push({
          agentId,
          storePath,
          key,
          entry,
          sessionId: entry.sessionId,
          sessionFile,
          reason
        });
      }
    }
  }

  return reports;
}

function resetDirectSession(sessionReport) {
  const store = JSON.parse(readFileSync(sessionReport.storePath, 'utf8'));
  const sessions = getSessionMap(store);
  const entry = sessions[sessionReport.key];
  const backups = [
    backupFile(sessionReport.storePath),
    backupFile(sessionReport.sessionFile)
  ];

  delete sessions[sessionReport.key];
  writeFileSync(sessionReport.storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');

  return {
    agentId: sessionReport.agentId,
    key: sessionReport.key,
    removedSessionId: entry?.sessionId ?? sessionReport.sessionId,
    removedSessionFile: sessionReport.sessionFile,
    backups
  };
}

function getSessionMap(store) {
  if (store && typeof store === 'object' && store.sessions && typeof store.sessions === 'object') {
    return store.sessions;
  }
  return store && typeof store === 'object' ? store : {};
}

function backupFile(filePath) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const backupPath = join(BACKUP_DIR, `${basename(filePath)}.${stamp}.cron-session-isolation.bak`);
  writeFileSync(backupPath, readFileSync(filePath));
  return {
    source: filePath,
    backup: backupPath,
    size: statSync(filePath).size
  };
}
