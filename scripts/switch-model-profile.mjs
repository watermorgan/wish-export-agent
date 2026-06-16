#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const profileName = process.argv[2]?.trim();

if (!profileName || !/^[a-z0-9][a-z0-9_-]*$/i.test(profileName)) {
  console.error('usage: node scripts/switch-model-profile.mjs <profile-name>');
  process.exit(1);
}

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env.local');
const profilePath = path.join(rootDir, `.env.profile.${profileName}.local`);

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    values.set(line.slice(0, equalsIndex).trim(), line.slice(equalsIndex + 1));
  }
  return values;
}

function upsertEnv(baseContent, updates) {
  const seen = new Set();
  const lines = baseContent.split(/\r?\n/).map((line) => {
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) return line;

    const key = line.slice(0, equalsIndex).trim();
    if (!updates.has(key)) return line;

    seen.add(key);
    return `${key}=${updates.get(key) ?? ''}`;
  });

  const missing = [...updates.entries()].filter(([key]) => !seen.has(key));
  if (missing.length > 0) {
    if (lines.at(-1) !== '') lines.push('');
    lines.push(`# model profile: ${profileName}`);
    for (const [key, value] of missing) {
      lines.push(`${key}=${value ?? ''}`);
    }
  }

  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

const [envContent, profileContent] = await Promise.all([
  readFile(envPath, 'utf8'),
  readFile(profilePath, 'utf8'),
]);
const profileValues = parseEnv(profileContent);

if (profileValues.size === 0) {
  throw new Error(`profile has no env entries: ${profilePath}`);
}

await writeFile(envPath, upsertEnv(envContent, profileValues), 'utf8');
console.log(`model profile applied: ${profileName}`);
console.log(`updated keys: ${[...profileValues.keys()].join(', ')}`);
