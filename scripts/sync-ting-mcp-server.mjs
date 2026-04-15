import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const repoRoot = process.cwd();
const source = path.join(repoRoot, 'scripts', 'ting-pdf-mcp-server.mjs');
const target = path.join(process.env.HOME ?? '', '.openclaw', 'mcp-servers', 'ting-pdf-mcp-server.mjs');

function sha256(filePath) {
  const raw = readFileSync(filePath);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

if (!existsSync(source)) {
  throw new Error(`source MCP server missing: ${source}`);
}

mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(source, target);

console.log(
  JSON.stringify(
    {
      synced: true,
      source,
      target,
      sha256: sha256(target)
    },
    null,
    2
  )
);
