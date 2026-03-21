import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const caseId = process.env.FEEDBACK_CASE_ID ?? 'case-001';
const rootDir = process.cwd();
const outputDir = path.join(rootDir, '.tmp', caseId);
const responsePath = path.join(outputDir, 'response.json');
const goldenPath = path.join(
  rootDir,
  'data',
  'feedback-translation',
  caseId,
  'golden',
  'translation-reference.json'
);

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[，。；：,.!?()"“”]/g, '')
    .trim()
    .toLowerCase();
}

function tokenizeChineseAware(value) {
  const normalized = normalizeText(value);
  return normalized
    .split(/[\s/]+/)
    .flatMap((token) => token.match(/[\u4e00-\u9fff]{1}|[a-z0-9]+/g) ?? [])
    .filter(Boolean);
}

function jaccard(left, right) {
  const leftSet = new Set(tokenizeChineseAware(left));
  const rightSet = new Set(tokenizeChineseAware(right));
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }

  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function flattenSegments(reference) {
  return reference.sections.flatMap((section) =>
    section.segments.map((segment) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      source: segment.source,
      translation: segment.translation
    }))
  );
}

function extractStructuredResponse(response) {
  const field = response.artifacts?.[0]?.fields?.find((item) => item.structuredData);
  return field?.structuredData ?? null;
}

async function main() {
  const response = JSON.parse(await readFile(responsePath, 'utf8'));
  const golden = JSON.parse(await readFile(goldenPath, 'utf8'));
  const aiStructured = extractStructuredResponse(response);

  const reportPath = path.join(outputDir, 'evaluation.json');

  if (!aiStructured) {
    const report = {
      caseId,
      comparable: false,
      reason: 'response.json 中没有结构化 AI 输出，无法与 golden 对比。'
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const isFixture =
    typeof response.summary === 'string' &&
    (response.summary.includes('结构化人工标准答案') || response.summary.includes('golden fixture'));

  const goldenSegments = flattenSegments(golden);
  const aiSegments = flattenSegments(aiStructured);

  const segmentScores = goldenSegments.map((goldenSegment) => {
    const bestSourceMatch = aiSegments
      .map((aiSegment) => ({
        aiSegment,
        sourceScore: jaccard(goldenSegment.source, aiSegment.source),
        translationScore: jaccard(goldenSegment.translation, aiSegment.translation)
      }))
      .sort((left, right) => {
        if (right.sourceScore !== left.sourceScore) {
          return right.sourceScore - left.sourceScore;
        }
        return right.translationScore - left.translationScore;
      })[0];

    return {
      sectionTitle: goldenSegment.sectionTitle,
      source: goldenSegment.source,
      expectedTranslation: goldenSegment.translation,
      matchedSource: bestSourceMatch?.aiSegment.source ?? '',
      matchedTranslation: bestSourceMatch?.aiSegment.translation ?? '',
      sourceScore: Number((bestSourceMatch?.sourceScore ?? 0).toFixed(4)),
      translationScore: Number((bestSourceMatch?.translationScore ?? 0).toFixed(4))
    };
  });

  const avgSourceScore =
    segmentScores.reduce((sum, item) => sum + item.sourceScore, 0) / segmentScores.length;
  const avgTranslationScore =
    segmentScores.reduce((sum, item) => sum + item.translationScore, 0) / segmentScores.length;

  const report = {
    caseId,
    comparable: !isFixture,
    fixtureMode: isFixture,
    summary: isFixture
      ? '当前 response 来自 fixture 回退，评分仅用于校验评测链路，不代表真实 AI 表现。'
      : '当前评分基于 AI 输出与 golden 的结构化对比。',
    metrics: {
      goldenSectionCount: golden.sections.length,
      aiSectionCount: aiStructured.sections?.length ?? 0,
      goldenSegmentCount: goldenSegments.length,
      aiSegmentCount: aiSegments.length,
      sourceCoverage: Number((avgSourceScore * 100).toFixed(2)),
      translationAccuracy: Number((avgTranslationScore * 100).toFixed(2))
    },
    segmentScores
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
