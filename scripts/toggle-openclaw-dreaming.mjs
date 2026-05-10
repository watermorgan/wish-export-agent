#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OPENCLAW_CONFIG = '/Users/weitao/.openclaw/openclaw.json';
const BACKUP_DIR = '/Users/weitao/.openclaw/backups';

const args = new Set(process.argv.slice(2));
const mode = args.has('--enable') ? 'enable' : args.has('--disable') ? 'disable' : 'status';

main();

function main() {
  const raw = readFileSync(OPENCLAW_CONFIG, 'utf8');
  const config = JSON.parse(raw);
  const dreaming = config.plugins?.entries?.['memory-core']?.config?.dreaming ?? null;

  if (!dreaming || typeof dreaming !== 'object') {
    throw new Error('memory-core dreaming config not found in openclaw.json');
  }

  const before = Boolean(dreaming.enabled);

  if (mode === 'status') {
    console.log(JSON.stringify(buildReport(before, before), null, 2));
    return;
  }

  const next = mode === 'enable';
  if (before === next) {
    console.log(JSON.stringify(buildReport(before, next), null, 2));
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const backupPath = join(BACKUP_DIR, `openclaw.json.${stamp}.dreaming-toggle.bak`);
  writeFileSync(backupPath, raw, 'utf8');

  dreaming.enabled = next;
  writeFileSync(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ...buildReport(before, next),
    backupPath,
    configSize: statSync(OPENCLAW_CONFIG).size
  }, null, 2));
}

function buildReport(before, after) {
  return {
    config: OPENCLAW_CONFIG,
    mode,
    changed: before !== after,
    dreamingEnabledBefore: before,
    dreamingEnabledAfter: after,
    note: 'Run npm run service:reload-gateway after changing this flag.'
  };
}
