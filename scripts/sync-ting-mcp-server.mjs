import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const repoRoot = process.cwd();
const source = path.join(repoRoot, 'scripts', 'ting-pdf-mcp-server.mjs');
const home = process.env.HOME ?? '';
const targets = [
  path.join(home, '.openclaw', 'mcp-servers', 'ting-pdf-mcp-server.mjs'),
  path.join(home, '.hermes', 'profiles', 'ting', 'workspace', 'ting-pdf-mcp-server.mjs')
];

function sha256(filePath) {
  const raw = readFileSync(filePath);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

if (!existsSync(source)) {
  throw new Error(`source MCP server missing: ${source}`);
}

const syncedTargets = targets.map((target) => {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  return {
    target,
    sha256: sha256(target)
  };
});

console.log(
  JSON.stringify(
    {
      synced: true,
      source,
      targets: syncedTargets
    },
    null,
    2
  )
);
