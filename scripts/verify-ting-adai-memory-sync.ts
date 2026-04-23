import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

function mustInclude(content: string, token: string, context: string): Check {
  return {
    name: context,
    ok: content.includes(token),
    detail: content.includes(token) ? undefined : `missing token: ${token}`,
  };
}

function mustExclude(content: string, token: string, context: string): Check {
  return {
    name: context,
    ok: !content.includes(token),
    detail: !content.includes(token) ? undefined : `unexpected token: ${token}`,
  };
}

async function readFromRoot(...segments: string[]) {
  const filePath = path.join(process.cwd(), ...segments);
  return readFile(filePath, 'utf8');
}

async function main() {
  const checks: Check[] = [];

  const manifest = await readFromRoot('memory', 'manifest.json');
  const tingMemory = await readFromRoot('memory', 'ting-runtime-memory.md');
  const adaiMemory = await readFromRoot('memory', 'adai-runtime-memory.md');
  const tingPrompt = await readFromRoot('docs', 'project', 'ting-system-prompt-20260420.md');
  const adaiPrompt = await readFromRoot('docs', 'project', 'adai-runtime-prompt-20260420.md');
  const routingSpec = await readFromRoot(
    'docs',
    'project',
    'override-rework-feedback-routing-spec-20260420.md'
  );

  checks.push(
    mustInclude(manifest, './ting-runtime-memory.md', 'manifest includes Ting memory file'),
    mustInclude(manifest, './adai-runtime-memory.md', 'manifest includes ADai memory file'),
    mustInclude(tingPrompt, 'Runtime memory sync source: `memory/ting-runtime-memory.md`', 'Ting prompt anchors memory source'),
    mustInclude(adaiPrompt, 'Runtime memory sync source: `memory/adai-runtime-memory.md`', 'ADai prompt anchors memory source'),
    mustInclude(tingMemory, '语义消歧是 Ting 的责任，不是业务的责任。', 'Ting memory keeps ownership boundary'),
    mustInclude(adaiMemory, '先检查 Ting 是否执行了 A/B 消歧协议', 'ADai memory keeps triage-first rule'),
    mustInclude(
      tingPrompt,
      '若同一请求同时包含“原文识别问题 + 译文表达问题”，先走 override(forceVisionPages) 刷新原文，再视结果补 rework',
      'Ting prompt uses override-first mixed-intent rule'
    ),
    mustInclude(
      routingSpec,
      '先执行 `override`（`forceVisionPages`）',
      'Routing spec uses override-first mixed-intent rule'
    ),
    mustInclude(
      routingSpec,
      'forceVisionPages` 和 `force_vision` 属于 override 输入，不属于 rework',
      'Routing spec maps forceVisionPages to override'
    ),
    mustExclude(
      tingPrompt,
      'rework 与 override 冲突时，先 rework',
      'Old rework-first conflict removed from Ting prompt'
    ),
    mustExclude(
      routingSpec,
      'forceVisionPages` 和 `force_vision` 不允许出现在 override 中',
      'Old forceVisionPages contradiction removed from routing spec'
    )
  );

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error('Ting/ADai memory sync verification failed:');
    for (const check of failed) {
      console.error(`- ${check.name}: ${check.detail ?? 'failed'}`);
    }
    process.exit(1);
  }

  console.log(`Ting/ADai memory sync verification passed (${checks.length}/${checks.length}).`);
}

void main();
