#!/usr/bin/env tsx

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  extractGlossaryCandidates,
  filterFeedbackCases,
  resolveGlossaryOrigin,
  type GlossaryCandidateEntry,
} from '@/lib/feedback/review';
import { listFeedbackCases } from '@/lib/feedback/store';

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const normalized = arg.slice(2);
    const [key, inlineValue] = normalized.split('=');

    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
      continue;
    }

    args.set(key, '');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
  const items = await listFeedbackCases(feedbackDir);
  const filtered = filterFeedbackCases(items, {
    status: args.get('status'),
    priority: args.get('priority'),
    category: args.get('category'),
  });

  for (const item of filtered) {
    const sourceText = item.source.sourceText ? ` ${item.source.sourceText}` : '';
    console.log(
      `[${item.priority}] ${item.id} ${item.category} ${item.source.fileName}${sourceText}`
    );
  }

  console.log(`total=${filtered.length}`);

  // 追加：把当前候选术语的 origin 也列出来，让主管在 review 时清楚哪些条目是 AI 挖出来的。
  // 做法：
  //   1) 从本次过滤结果里推导出将要写入的候选（pending 侧）——全部是 ai_feedback_mining；
  //   2) 从 candidates.json 读出已落盘候选，按 origin 兜底展示（历史条目视为 manual）。
  const pendingFromFeedback = extractGlossaryCandidates(filtered);
  const persistedCandidates = await loadPersistedCandidates();
  if (pendingFromFeedback.length === 0 && persistedCandidates.length === 0) {
    return;
  }

  console.log('--- glossary candidates ---');
  for (const entry of pendingFromFeedback) {
    console.log(`pending  [${entry.origin}] ${entry.en} → ${entry.zh}`);
  }
  for (const entry of persistedCandidates) {
    console.log(`on-disk  [${entry.origin}] ${entry.en} → ${entry.zh}`);
  }
  const aiCount =
    pendingFromFeedback.filter((entry) => entry.origin === 'ai_feedback_mining').length +
    persistedCandidates.filter((entry) => entry.origin === 'ai_feedback_mining').length;
  console.log(`glossary.ai_feedback_mining=${aiCount}`);
}

async function loadPersistedCandidates(): Promise<GlossaryCandidateEntry[]> {
  const glossaryPath = path.join(process.cwd(), 'data', 'glossary', 'candidates.json');
  try {
    const raw = JSON.parse(await readFile(glossaryPath, 'utf8')) as {
      entries?: GlossaryCandidateEntry[];
    };
    return (raw.entries ?? []).map((entry) => ({
      ...entry,
      origin: resolveGlossaryOrigin((entry as { origin?: unknown }).origin),
    }));
  } catch {
    // 文件缺失或解析失败时静默降级为空列表，review 脚本不应因术语库问题而阻塞反馈浏览。
    return [];
  }
}

void main();
