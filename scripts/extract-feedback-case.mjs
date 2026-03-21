import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const caseId = process.env.FEEDBACK_CASE_ID ?? 'case-001';
const caseDir = path.resolve(process.cwd(), 'data', 'feedback-translation', caseId);
const inputPdfPath = path.join(caseDir, 'input', 'Hanna Lightweight Skirt.pdf');
const outputDir = path.resolve(process.cwd(), '.tmp', caseId);

const SECTION_DEFINITIONS = [
  { match: /^quality$/i, id: 'quality', title: 'Quality' },
  { match: /^details$/i, id: 'details-op1', title: 'Details OP1' },
  { match: /^inner shorts$/i, id: 'inner-shorts', title: 'Inner Shorts' },
  { match: /^option 2$/i, id: 'details-op2', title: 'Details OP2' },
  { match: /^references$/i, id: 'references', title: 'References' },
  { match: /^colours$/i, id: 'colours', title: 'Colours' }
];

function normalizeExtractedText(value) {
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

async function extractPdfTextFromPath(inputPath) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'export-agent-case-'));
  const outputPath = path.join(tempDir, 'output.txt');

  try {
    await execFileAsync('pdftotext', ['-layout', inputPath, outputPath]);
    return normalizeExtractedText(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function normalizeLine(value) {
  return value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();
}

function shouldSkipLine(line) {
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

function isStandaloneMarker(line) {
  return /^(FRONT|BACK)$/i.test(line);
}

function getSectionDefinition(line) {
  return SECTION_DEFINITIONS.find((definition) => definition.match.test(line)) ?? null;
}

function finalizeBuffer(buffer, segments, counters, sectionId) {
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

function pushStandaloneSegment(text, segments, counters, sectionId) {
  const nextIndex = (counters.get(sectionId) ?? 0) + 1;
  counters.set(sectionId, nextIndex);
  segments.push({
    id: `${sectionId}-${String(nextIndex).padStart(2, '0')}`,
    text
  });
}

function getOrCreateSection(sections, id, title) {
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

function expandSectionSegments(section) {
  return section.segments.flatMap((segment) => {
    let pieces = [segment.text];

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

    if ((section.id === 'details-op1' || section.id === 'details-op2') && /Glued hem/i.test(segment.text)) {
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
        const unique = new Set();
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

    if (section.id === 'overview' && /On body Clean sketch/i.test(segment.text)) {
      pieces = [];
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

function buildFeedbackSourceReference(file) {
  if (!file.contentText?.trim()) {
    return null;
  }

  const pages = file.contentText
    .split('\f')
    .map((page) => page.split('\n').map(normalizeLine));

  const sections = [];
  const counters = new Map();
  let currentSection = null;
  const buffer = [];

  const ensureDefaultSection = () => {
    if (!currentSection) {
      currentSection = getOrCreateSection(sections, 'overview', 'Overview');
    }
  };

  const flushBuffer = () => {
    if (!currentSection) {
      return;
    }

    finalizeBuffer(buffer, currentSection.segments, counters, currentSection.id);
  };

  for (const page of pages) {
    for (const rawLine of page) {
      if (!rawLine) {
        flushBuffer();
        continue;
      }

      if (shouldSkipLine(rawLine)) {
        continue;
      }

      const sectionDefinition = getSectionDefinition(rawLine);
      if (sectionDefinition) {
        flushBuffer();
        currentSection = getOrCreateSection(
          sections,
          sectionDefinition.id,
          sectionDefinition.title
        );
        continue;
      }

      ensureDefaultSection();
      const activeSection = currentSection;

      if (isStandaloneMarker(rawLine)) {
        flushBuffer();
        pushStandaloneSegment(rawLine, activeSection.segments, counters, activeSection.id);
        continue;
      }

      if (/^[-•]/.test(rawLine)) {
        flushBuffer();
        buffer.push(rawLine.replace(/^[-•]\s*/, ''));
        continue;
      }

      buffer.push(rawLine);
    }

    flushBuffer();
  }

  const normalizedSections = sections
    .map((section) => ({
      ...section,
      segments: expandSectionSegments(section).filter((segment) => segment.text.length > 0)
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

async function main() {
  await mkdir(outputDir, { recursive: true });
  const contentText = await extractPdfTextFromPath(inputPdfPath);
  const fileBuffer = await readFile(inputPdfPath);
  const sourceReference = buildFeedbackSourceReference({
    name: path.basename(inputPdfPath),
    size: fileBuffer.byteLength,
    type: 'application/pdf',
    contentText
  });

  if (!sourceReference) {
    throw new Error('未能从输入文件中抽取结构化源数据。');
  }

  const outputPath = path.join(outputDir, 'source-reference.json');
  await writeFile(outputPath, JSON.stringify(sourceReference, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        caseId,
        sourceFile: sourceReference.sourceFile,
        sections: sourceReference.sections.length,
        segments: sourceReference.sections.reduce(
          (count, section) => count + section.segments.length,
          0
        ),
        savedSourceReference: outputPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
