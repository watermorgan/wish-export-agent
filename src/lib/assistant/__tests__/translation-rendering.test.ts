import assert from 'node:assert/strict';
import test from 'node:test';

import type { PipelineResult } from '../translation-pipeline';
import { __translationPipelineInternals } from '../translation-pipeline';

function makeSegment(
  overrides: Partial<PipelineResult['segments'][number]> = {}
): PipelineResult['segments'][number] {
  return {
    id: 'seg-1',
    text: 'coil zipper on middle front facing opening',
    zh: '圈型拉鍊在前中開口位',
    pageNumber: 1,
    regionId: 'r-1',
    extractionMeta: {
      sourceType: 'vision',
      layoutConfidence: 1,
      mergeConfidence: 1,
      pageLayoutType: 'sketch',
      bbox: { x: 100, y: 100, w: 220, h: 60 }
    },
    ...overrides
  };
}

test('normalizeFashionTranslation keeps simplified Chinese and nylon zipper terminology', () => {
  const normalized = __translationPipelineInternals.normalizeFashionTranslation(
    'coil zipper on middle front facing opening',
    '圈型拉鍊在前中開口位'
  );

  assert.equal(normalized, '前中止口位尼龙拉链');
});

test('sketch comment notes default to footnote mode instead of inline overlay', () => {
  const segment = makeSegment();
  const shouldInline = __translationPipelineInternals.shouldUseInlineAnnotatedNote(
    segment,
    '前中止口位尼龙拉链',
    'sketch_comment'
  );

  assert.equal(shouldInline, false);
});
