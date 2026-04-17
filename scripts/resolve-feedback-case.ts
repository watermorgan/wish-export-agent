#!/usr/bin/env tsx

import path from 'node:path';

import { resolveFeedbackCase } from '@/lib/feedback/store';
import { FEEDBACK_RESOLUTION_ACTIONS, type FeedbackResolutionAction } from '@/lib/feedback/types';

type ResolutionStatus = 'resolved' | 'wont_fix';

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

function printUsage() {
  console.error(
    [
      'Usage:',
      '  npm run feedback:resolve -- --id <fb-YYYYMMDD-NNN> --status <resolved|wont_fix> --action <action> --detail <text> --by <name> [--commit <sha>] [--resolved-at <iso>] [--dir <feedback-dir>]',
      '',
      `Actions: ${FEEDBACK_RESOLUTION_ACTIONS.join(', ')}`,
    ].join('\n')
  );
}

function requireArg(args: Map<string, string>, key: string) {
  const value = args.get(key)?.trim();

  if (!value) {
    throw new Error(`Missing required argument: --${key}`);
  }

  return value;
}

function parseResolutionStatus(value: string): ResolutionStatus {
  if (value === 'resolved' || value === 'wont_fix') {
    return value;
  }

  throw new Error('status must be "resolved" or "wont_fix".');
}

function parseResolutionAction(value: string): FeedbackResolutionAction {
  if (FEEDBACK_RESOLUTION_ACTIONS.includes(value as FeedbackResolutionAction)) {
    return value as FeedbackResolutionAction;
  }

  throw new Error(`action must be one of: ${FEEDBACK_RESOLUTION_ACTIONS.join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.has('help')) {
    printUsage();
    return;
  }

  const feedbackDir = args.get('dir')
    ? path.resolve(args.get('dir') as string)
    : path.join(process.cwd(), 'data', 'feedback-cases');
  const id = requireArg(args, 'id');
  const status = parseResolutionStatus(requireArg(args, 'status'));
  const action = parseResolutionAction(requireArg(args, 'action'));
  const detail = requireArg(args, 'detail');
  const resolvedBy = requireArg(args, 'by');
  const commitRef = args.get('commit')?.trim() || undefined;
  const resolvedAt = args.get('resolved-at')?.trim() || undefined;

  const updated = await resolveFeedbackCase(feedbackDir, id, {
    status,
    action,
    detail,
    commitRef,
    resolvedAt,
    resolvedBy,
  });

  console.log(`updated=${updated.record.id}`);
  console.log(`status=${updated.record.status}`);
  console.log(`action=${updated.record.resolution?.action ?? 'none'}`);
  console.log(`path=${updated.path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
