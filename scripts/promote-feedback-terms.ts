#!/usr/bin/env tsx

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import {
  extractGlossaryCandidates,
  filterFeedbackCases,
  mergeGlossaryCandidates,
  resolveGlossaryOrigin,
  type GlossaryCandidateEntry,
} from '@/lib/feedback/review';
import { listFeedbackCases } from '@/lib/feedback/store';

type GlossaryCandidatesFile = {
  version: string;
  updatedAt: string;
  entries: GlossaryCandidateEntry[];
};

const feedbackDir = path.join(process.cwd(), 'data', 'feedback-cases');
const glossaryPath = path.join(process.cwd(), 'data', 'glossary', 'candidates.json');

async function main() {
  const existing = JSON.parse(await readFile(glossaryPath, 'utf8')) as GlossaryCandidatesFile;
  const normalizedExisting: GlossaryCandidateEntry[] = existing.entries.map((entry) => ({
    ...entry,
    origin: resolveGlossaryOrigin((entry as { origin?: unknown }).origin),
  }));
  const openCases = filterFeedbackCases(await listFeedbackCases(feedbackDir), {
    status: 'open',
    category: 'term_correction',
  });
  const nextCandidates = extractGlossaryCandidates(openCases);
  const mergedEntries = mergeGlossaryCandidates(normalizedExisting, nextCandidates);
  const addedCount = mergedEntries.length - normalizedExisting.length;
  const schemaBackfillCount = normalizedExisting.filter(
    (entry, index) => (existing.entries[index] as { origin?: unknown }).origin !== entry.origin
  ).length;

  if (addedCount > 0 || schemaBackfillCount > 0) {
    await writeFile(
      glossaryPath,
      `${JSON.stringify(
        {
          ...existing,
          updatedAt: new Date().toISOString().slice(0, 10),
          entries: mergedEntries,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }

  const aiMinedCount = mergedEntries.filter((entry) => entry.origin === 'ai_feedback_mining').length;

  console.log(`added=${addedCount}`);
  console.log(`total=${mergedEntries.length}`);
  console.log(`origin.ai_feedback_mining=${aiMinedCount}`);
  if (schemaBackfillCount > 0) {
    console.log(`origin.backfilled=${schemaBackfillCount}`);
  }
}

void main();
