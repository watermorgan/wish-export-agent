import assert from 'node:assert/strict';
import test from 'node:test';

import { __translationPipelineInternals } from '../translation-pipeline';

function makeSegment(
  id: string,
  pageLayoutType: 'sketch' | 'table' | 'reference' | 'mixed'
) {
  return {
    id,
    text: `segment-${id}`,
    zh: `翻译-${id}`,
    pageNumber: 1,
    regionId: `r-${id}`,
    extractionMeta: {
      sourceType: 'text_layer',
      layoutConfidence: 1,
      mergeConfidence: 1,
      pageLayoutType
    }
  };
}

test('selectBilingualBundleSegments keeps full bundle for sketch_comment annotated output', () => {
  const segments = [makeSegment('a', 'sketch'), makeSegment('b', 'sketch')];
  const selected = __translationPipelineInternals.selectBilingualBundleSegments(
    segments,
    'sketch_comment',
    'annotated_pdf'
  );

  assert.deepEqual(selected, segments);
});

test('selectBilingualBundleSegments keeps only mixed supplements for mixed annotated output', () => {
  const sketch = makeSegment('a', 'sketch');
  const table = makeSegment('b', 'table');
  const reference = makeSegment('c', 'reference');
  const selected = __translationPipelineInternals.selectBilingualBundleSegments(
    [sketch, table, reference],
    'mixed',
    'annotated_pdf'
  );

  assert.deepEqual(selected, [table, reference]);
});

test('selectBilingualBundleSegments keeps all rows for bilingual table bundle output', () => {
  const segments = [makeSegment('a', 'table'), makeSegment('b', 'reference')];
  const selected = __translationPipelineInternals.selectBilingualBundleSegments(
    segments,
    'tp_bom_table_heavy',
    'bilingual_table_bundle'
  );

  assert.deepEqual(selected, segments);
});
