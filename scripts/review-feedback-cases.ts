#!/usr/bin/env tsx

import path from 'node:path';

import { filterFeedbackCases } from '@/lib/feedback/review';
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
}

void main();
