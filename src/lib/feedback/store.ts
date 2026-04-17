import path from 'node:path';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';

import type {
  FeedbackCase,
  FeedbackResolutionAction,
  PendingFeedbackCase,
} from './types';

const FEEDBACK_FILE_PATTERN = /^fb-\d{8}-\d+$/;
const FEEDBACK_FILE_NAME_PATTERN = /^fb-\d{8}-\d+\.json$/;

export type FeedbackResolutionUpdateInput = {
  status: 'resolved' | 'wont_fix';
  action: FeedbackResolutionAction;
  detail: string;
  commitRef?: string;
  resolvedAt?: string;
  resolvedBy: string;
};

function assertFeedbackId(id: string) {
  if (!FEEDBACK_FILE_PATTERN.test(id)) {
    throw new Error(`Invalid feedback case id: ${id}`);
  }

  return id;
}

function getFeedbackCasePath(dir: string, id: string) {
  return path.join(dir, `${assertFeedbackId(id)}.json`);
}

function trimRequired(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function trimOptional(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function serializeFeedbackCase(record: FeedbackCase) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function writeFeedbackCaseAtomically(filePath: string, record: FeedbackCase) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, serializeFeedbackCase(record), 'utf8');
  await rename(tempPath, filePath);
}

function assertResolutionUpdate(input: FeedbackResolutionUpdateInput) {
  const detail = trimRequired(input.detail, 'detail');
  const resolvedBy = trimRequired(input.resolvedBy, 'resolvedBy');
  const commitRef = trimOptional(input.commitRef);

  if (input.status === 'resolved' && (input.action === 'wont_fix' || input.action === 'duplicate')) {
    throw new Error('Resolved feedback cases must use a non-rejection resolution action.');
  }

  if (
    input.status === 'wont_fix' &&
    input.action !== 'wont_fix' &&
    input.action !== 'duplicate'
  ) {
    throw new Error('wont_fix feedback cases must use action "wont_fix" or "duplicate".');
  }

  const resolvedAt = trimOptional(input.resolvedAt) ?? new Date().toISOString();

  return {
    ...input,
    detail,
    resolvedBy,
    commitRef,
    resolvedAt,
  };
}

export async function reserveUniqueFeedbackFile(dir: string) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let count = 1; count <= 9999; count += 1) {
    const id = `fb-${today}-${String(count).padStart(3, '0')}`;
    const filePath = path.join(dir, `${id}.json`);

    try {
      const handle = await open(filePath, 'wx');
      return { id, filePath, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  throw new Error('Unable to reserve a unique feedback ID for today.');
}

export async function createFeedbackCase(dir: string, record: PendingFeedbackCase) {
  await mkdir(dir, { recursive: true });

  const { id, filePath, handle } = await reserveUniqueFeedbackFile(dir);
  const completeRecord: FeedbackCase = { id, ...record };

  try {
    await handle.writeFile(JSON.stringify(completeRecord, null, 2), 'utf8');
  } finally {
    await handle.close();
  }

  return { id, path: filePath, record: completeRecord };
}

export async function listFeedbackCases(dir: string) {
  let fileNames: string[];

  try {
    fileNames = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = fileNames.filter((name) => FEEDBACK_FILE_NAME_PATTERN.test(name));
  const items = await Promise.all(
    files.map(async (name) => {
      const content = await readFile(path.join(dir, name), 'utf8');
      return JSON.parse(content) as FeedbackCase;
    })
  );

  return items.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

export async function readFeedbackCase(dir: string, id: string) {
  const filePath = getFeedbackCasePath(dir, id);
  const content = await readFile(filePath, 'utf8');
  const record = JSON.parse(content) as FeedbackCase;

  if (record.id !== id) {
    throw new Error(`Feedback case ${id} has mismatched record id ${record.id}.`);
  }

  return { path: filePath, record };
}

export async function updateFeedbackCase(
  dir: string,
  id: string,
  updater: (current: FeedbackCase) => FeedbackCase
) {
  const { path: filePath, record: current } = await readFeedbackCase(dir, id);
  const next = updater(current);

  if (next.id !== current.id) {
    throw new Error('Feedback case updater must not change the case id.');
  }

  await writeFeedbackCaseAtomically(filePath, next);
  return { path: filePath, record: next };
}

export async function resolveFeedbackCase(
  dir: string,
  id: string,
  input: FeedbackResolutionUpdateInput
) {
  const resolution = assertResolutionUpdate(input);

  return updateFeedbackCase(dir, id, (current) => ({
    ...current,
    status: resolution.status,
    resolution: {
      action: resolution.action,
      detail: resolution.detail,
      commitRef: resolution.commitRef,
      resolvedAt: resolution.resolvedAt,
      resolvedBy: resolution.resolvedBy,
    },
  }));
}
