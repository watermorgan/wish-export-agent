import type { UploadedFile } from '@/lib/assistant/types';

export type FeedbackSourceSegment = {
  id: string;
  text: string;
};

export type FeedbackSourceSection = {
  id: string;
  title: string;
  segments: FeedbackSourceSegment[];
};

export type FeedbackSourceReference = {
  sourceFile: string;
  title: string;
  outputMode: 'source_sections';
  sections: FeedbackSourceSection[];
};

const SECTION_DEFINITIONS = [
  { match: /^quality$/i, id: 'quality', title: 'Quality' },
  { match: /^details$/i, id: 'details-op1', title: 'Details OP1' },
  { match: /^inner shorts$/i, id: 'inner-shorts', title: 'Inner Shorts' },
  { match: /^option 2$/i, id: 'details-op2', title: 'Details OP2' },
  { match: /^references$/i, id: 'references', title: 'References' },
  { match: /^colours$/i, id: 'colours', title: 'Colours' }
];

const COMMON_LAYOUT_LABELS = [
  'on body',
  'clean sketch',
  'technical sketch',
  'main fabric',
  'shell fabric',
  'lining fabric',
  'contrast fabric',
  'front view',
  'back view',
  'side view',
  'detail view',
  'fit reference',
  'reference image'
];

function normalizeLine(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();
}

type RawLineFragment = {
  start: number;
  text: string;
};

function splitRawLineFragments(rawLine: string) {
  const fragments: RawLineFragment[] = [];
  const matcher = /\S.*?(?=\s{4,}|$)/g;

  for (const match of rawLine.matchAll(matcher)) {
    const text = normalizeLine(match[0] ?? '');
    if (!text) {
      continue;
    }

    fragments.push({
      start: match.index ?? 0,
      text
    });
  }

  return fragments;
}

function getColumnBucket(start: number) {
  return Math.round(start / 8) * 8;
}

function shouldSkipLine(line: string) {
  return (
    line.length === 0 ||
    /^Style:/i.test(line) ||
    /^Created:/i.test(line) ||
    /^Updated:/i.test(line) ||
    /^Supplier:/i.test(line) ||
    /^Womenswear$/i.test(line) ||
    /^Season:/i.test(line)
  );
}

function isStandaloneMarker(line: string) {
  return /^(FRONT|BACK)$/i.test(line);
}

function getSectionDefinition(line: string) {
  return SECTION_DEFINITIONS.find((definition) => definition.match.test(line)) ?? null;
}

function splitCommonLayoutLabels(text: string) {
  const normalized = text.trim();
  const lowered = normalized.toLowerCase();

  const matches = COMMON_LAYOUT_LABELS
    .map((label) => {
      const index = lowered.indexOf(label);
      return index >= 0 ? { label, index, value: normalized.slice(index, index + label.length) } : null;
    })
    .filter((item): item is { label: string; index: number; value: string } => Boolean(item))
    .sort((left, right) => left.index - right.index);

  if (matches.length < 2) {
    return [normalized];
  }

  const pieces: string[] = [];
  for (const match of matches) {
    if (!pieces.some((item) => item.toLowerCase() === match.label)) {
      pieces.push(match.value);
    }
  }

  return pieces.length > 1 ? pieces : [normalized];
}

function splitShortLabelPairs(text: string) {
  const normalized = text.trim();

  if (/[.:;,#]/.test(normalized) || /^[-•]/.test(normalized)) {
    return [normalized];
  }

  const words = normalized.split(/\s+/);
  if (words.length < 4 || words.length > 6 || words.length % 2 !== 0) {
    return [normalized];
  }

  const looksLikeLabelPairs = words.every((word, index) =>
    index % 2 === 0 ? /^[A-Z][A-Za-z/+#-]*$/.test(word) : /^[a-z][A-Za-z/+#-]*$/.test(word)
  );

  if (!looksLikeLabelPairs) {
    return [normalized];
  }

  const pieces: string[] = [];
  for (let index = 0; index < words.length; index += 2) {
    pieces.push(`${words[index]} ${words[index + 1]}`);
  }

  return pieces;
}

function splitReferenceInstructionClauses(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  let pieces = [normalized];

  pieces = pieces.flatMap((piece) =>
    piece
      .split(/\s+(?=Ref(?:erence)?(?: image)?\b)/i)
      .map((item) => item.trim())
      .filter(Boolean)
  );

  pieces = pieces.flatMap((piece) =>
    piece
      .split(/\s+(?=Used at\b)/i)
      .map((item) => item.trim())
      .filter(Boolean)
  );

  pieces = pieces.flatMap((piece) => {
    const match = piece.match(/^(.*?\bwith visible\s+)(.+?\bas image\b)\s+(.+?\bas image\b)$/i);
    if (!match) {
      return [piece];
    }

    const [, prefix, firstImageLabel, secondImageLabel] = match;
    return [firstImageLabel.trim(), `${prefix}${secondImageLabel}`.trim()];
  });

  const stitched: string[] = [];
  for (const piece of pieces) {
    if (
      stitched.length > 0 &&
      /\battached\b/i.test(stitched[stitched.length - 1]) &&
      /^inside\b.*\bpocket\b/i.test(piece)
    ) {
      stitched[stitched.length - 1] = `${stitched[stitched.length - 1]} ${piece}`.trim();
      continue;
    }

    stitched.push(piece);
  }

  return stitched;
}

function finalizeBuffer(
  buffer: string[],
  segments: FeedbackSourceSegment[],
  counters: Map<string, number>,
  sectionId: string
) {
  const text = buffer.join(' ').trim();
  buffer.length = 0;

  if (!text) {
    return;
  }

  const nextIndex = (counters.get(sectionId) ?? 0) + 1;
  counters.set(sectionId, nextIndex);
  segments.push({
    id: `${sectionId}-${String(nextIndex).padStart(2, '0')}`,
    text
  });
}

function pushStandaloneSegment(
  text: string,
  segments: FeedbackSourceSegment[],
  counters: Map<string, number>,
  sectionId: string
) {
  const nextIndex = (counters.get(sectionId) ?? 0) + 1;
  counters.set(sectionId, nextIndex);
  segments.push({
    id: `${sectionId}-${String(nextIndex).padStart(2, '0')}`,
    text
  });
}

function getOrCreateSection(
  sections: FeedbackSourceSection[],
  id: string,
  title: string
) {
  const existing = sections.find((section) => section.id === id);
  if (existing) {
    return existing;
  }

  const created = {
    id,
    title,
    segments: []
  };
  sections.push(created);
  return created;
}

function expandSectionSegments(section: FeedbackSourceSection) {
  return section.segments.flatMap((segment) => {
    let pieces = [segment.text];

    pieces = pieces.flatMap((piece) => splitCommonLayoutLabels(piece));
    pieces = pieces.flatMap((piece) => splitShortLabelPairs(piece));
    pieces = pieces.flatMap((piece) => splitReferenceInstructionClauses(piece));

    if (section.id === 'references') {
      pieces = pieces.flatMap((piece) =>
        piece
          .split(/(?=Reference:)/)
          .map((item) => item.trim())
          .filter(Boolean)
      );
    }

    if (section.id === 'quality' && segment.id === 'quality-01') {
      const valueDriverMatch =
        segment.text.match(/VALUE DRIVER:\s*"Drop-in" side pockets/i) ??
        segment.text.match(/"Drop-in"\s+side pockets/i);
      const wrinkleMatch = segment.text.match(/Wrinkle free fabric/i);
      const gluedHemMatch = segment.text.match(/Glued bottom hem/i);
      const qualitySpec = segment.text
        .replace(/VALUE DRIVER:\s*"Drop-in" side pockets/i, '')
        .replace(/"Drop-in"\s+side pockets/i, '')
        .replace(/Wrinkle free fabric/i, '')
        .replace(/Glued bottom hem/i, '')
        .replace(/VALUE DRIVER:/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      pieces = [
        valueDriverMatch?.[0] ?? '',
        wrinkleMatch?.[0] ?? '',
        gluedHemMatch?.[0] ?? '',
        qualitySpec
      ].filter(Boolean);
    }

    if (
      (section.id === 'details-op1' || section.id === 'details-op2') &&
      /Glued hem/i.test(segment.text)
    ) {
      const splitIndex = segment.text.indexOf('Glued hem');
      const reverseSplitIndex = segment.text.indexOf('Rubber logo glued');
      if (splitIndex > 0) {
        pieces = [
          segment.text.slice(0, splitIndex).trim(),
          segment.text.slice(splitIndex).trim()
        ].filter(Boolean);
      } else if (reverseSplitIndex > 0) {
        pieces = [
          segment.text.slice(0, reverseSplitIndex).trim(),
          segment.text.slice(reverseSplitIndex).trim()
        ].filter(Boolean);
      }
    }

    if (section.id === 'inner-shorts' && /Logo rubber print/i.test(segment.text)) {
      const flatAppearanceIndex = segment.text.indexOf('Logo rubber print');
      if (flatAppearanceIndex > 0 && /inside leg/i.test(segment.text)) {
        pieces = [
          `${segment.text.slice(0, flatAppearanceIndex).trim()} glued hem for flat appearance`
            .replace(/\s+glued hem for flat appearance\s+glued hem for flat appearance/i, ' glued hem for flat appearance')
            .trim(),
          segment.text
            .slice(flatAppearanceIndex)
            .replace(/glued hem for flat\s*/i, '')
            .replace(/appearence/gi, 'appearance')
            .trim()
        ].filter(Boolean);
      }
    }

    if (section.id === 'colours') {
      const matches = segment.text.match(
        /(Body|Inner shorts|Thread|Piping|Bird|Macade logo):\s*[A-Za-z]+/g
      );
      if (matches && matches.length > 0) {
        const unique = new Set<string>();
        pieces = matches.filter((item) => {
          if (unique.has(item)) {
            return false;
          }
          unique.add(item);
          return true;
        });
      } else if (/^Option 1/i.test(segment.text)) {
        pieces = [];
      }
    }

    if (section.id === 'inner-shorts' && /^(FRONT|BACK)$/i.test(segment.text)) {
      pieces = [];
    }

    return pieces.map((piece, index) => ({
      id: pieces.length === 1 ? segment.id : `${segment.id}-${index + 1}`,
      text: piece
    }));
  });
}

function shouldMergeContinuation(previousText: string, currentText: string) {
  const previous = previousText.trim();
  const current = currentText.trim();
  if (!previous || !current) {
    return false;
  }

  const currentWordCount = current.split(/\s+/).length;
  const currentIsShort = currentWordCount <= 3 || current.length <= 24;
  const previousNeedsContinuation =
    /(?:[,/:-]$|\b(?:for|with|at|of|to|in|on|and|or|as|from|inside|outside|into|onto|visible|contrast|size|ref|must|see))$/i.test(
      previous
    );
  const currentLooksLikeContinuation = /^[a-z0-9#(]/.test(current) || currentIsShort;

  if (previousNeedsContinuation) {
    return true;
  }

  if (/[.!?]$/.test(previous)) {
    return false;
  }

  return currentLooksLikeContinuation;
}

function consolidateSectionSegments(section: FeedbackSourceSection) {
  if (!['details-op1', 'details-op2', 'inner-shorts'].includes(section.id)) {
    return section.segments.map((segment) => ({ ...segment }));
  }

  const consolidated: FeedbackSourceSegment[] = [];

  for (const segment of section.segments) {
    const previous = consolidated[consolidated.length - 1];
    if (previous && shouldMergeContinuation(previous.text, segment.text)) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    consolidated.push({ ...segment });
  }

  return consolidated;
}

export function buildFeedbackSourceReference(file: UploadedFile): FeedbackSourceReference | null {
  if (!file.contentText?.trim()) {
    return null;
  }

  const pages = file.contentText.split('\f').map((page) => page.split('\n'));

  const sections: FeedbackSourceSection[] = [];
  const counters = new Map<string, number>();
  let currentSection: FeedbackSourceSection | null = null;
  const columnBuffers = new Map<number, string[]>();

  const ensureDefaultSection = () => {
    if (!currentSection) {
      currentSection = getOrCreateSection(sections, 'overview', 'Overview');
    }
  };

  const flushColumnBuffer = (bucket: number) => {
    if (!currentSection) {
      return;
    }

    const buffer = columnBuffers.get(bucket);
    if (!buffer || buffer.length === 0) {
      columnBuffers.delete(bucket);
      return;
    }

    finalizeBuffer(buffer, currentSection.segments, counters, currentSection.id);
    columnBuffers.delete(bucket);
  };

  const flushAllBuffers = () => {
    for (const bucket of [...columnBuffers.keys()].sort((left, right) => left - right)) {
      flushColumnBuffer(bucket);
    }
  };

  for (const page of pages) {
    flushAllBuffers();

    for (const line of page) {
      const normalizedLine = normalizeLine(line);
      if (!normalizedLine) {
        flushAllBuffers();
        continue;
      }

      if (shouldSkipLine(normalizedLine)) {
        continue;
      }

      const sectionDefinition = getSectionDefinition(normalizedLine);
      if (sectionDefinition) {
        flushAllBuffers();
        currentSection = getOrCreateSection(
          sections,
          sectionDefinition.id,
          sectionDefinition.title
        );
        continue;
      }

      ensureDefaultSection();
      const activeSection = currentSection;
      if (!activeSection) {
        continue;
      }

      if (isStandaloneMarker(normalizedLine)) {
        flushAllBuffers();
        pushStandaloneSegment(normalizedLine, activeSection.segments, counters, activeSection.id);
        continue;
      }

      const fragments = splitRawLineFragments(line);
      if (fragments.length === 0) {
        continue;
      }

      const seenBuckets = new Set<number>();
      for (const fragment of fragments) {
        seenBuckets.add(getColumnBucket(fragment.start));
      }

      for (const bucket of [...columnBuffers.keys()]) {
        if (!seenBuckets.has(bucket)) {
          flushColumnBuffer(bucket);
        }
      }

      for (const fragment of fragments) {
        const bucket = getColumnBucket(fragment.start);
        const columnBuffer = columnBuffers.get(bucket) ?? [];

        if (/^[-•]/.test(fragment.text) && columnBuffer.length > 0) {
          flushColumnBuffer(bucket);
        }

        columnBuffer.push(fragment.text.replace(/^[-•]\s*/, ''));
        columnBuffers.set(bucket, columnBuffer);
      }
    }

    flushAllBuffers();
  }

  const normalizedSections = sections
    .map((section) => ({
      ...section,
      segments: consolidateSectionSegments({
        ...section,
        segments: expandSectionSegments(section).filter((segment) => segment.text.length > 0)
      })
    }))
    .filter((section) => section.segments.length > 0);

  if (normalizedSections.length === 0) {
    return null;
  }

  return {
    sourceFile: file.name,
    title: file.name.replace(/\.[^.]+$/, ''),
    outputMode: 'source_sections',
    sections: normalizedSections
  };
}
