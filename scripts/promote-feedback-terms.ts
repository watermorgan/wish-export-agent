#!/usr/bin/env tsx

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import {
  extractGlossaryCandidates,
  filterFeedbackCases,
  mergeGlossaryCandidates,
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
  const openCases = filterFeedbackCases(await listFeedbackCases(feedbackDir), {
    status: 'open',
    category: 'term_correction',
  });
  const nextCandidates = extractGlossaryCandidates(openCases);
  const mergedEntries = mergeGlossaryCandidates(existing.entries, nextCandidates);
  const addedCount = mergedEntries.length - existing.entries.length;

  if (addedCount > 0) {
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

  console.log(`added=${addedCount}`);
  console.log(`total=${mergedEntries.length}`);
}

void main();
