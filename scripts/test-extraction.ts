/**
 * Test extraction chain: file-extractor -> feedback-source
 */
import { extractPdfText } from '../src/lib/assistant/file-extractor';
import { buildFeedbackSourceReferenceWithDiagnostics } from '../src/lib/assistant/feedback-source';

async function main() {
  const pdfPath = process.argv[2] ?? 'data/test/sample-sketch.pdf';

  console.log('Extracting PDF:', pdfPath);
  const extracted = await extractPdfText(pdfPath);

  if (!extracted.success) {
    console.error('Extraction failed:', extracted.error);
    process.exit(1);
  }

  console.log('Pages:', extracted.pages.length);
  for (const p of extracted.pages) {
    console.log(`  Page ${p.pageNumber}: ${p.lines.length} lines`);
  }

  const { reference: ref, diagnostics } = buildFeedbackSourceReferenceWithDiagnostics(extracted, {
    name: pdfPath
  });
  const regionByPage = new Map<number, Set<string>>();
  for (const section of ref.sections) {
    const page = section.segments[0]?.pageNumber;
    if (!page) continue;
    if (!regionByPage.has(page)) regionByPage.set(page, new Set());
    for (const seg of section.segments) {
      regionByPage.get(page)!.add(seg.regionId);
    }
  }

  console.log('\nRegions per page:');
  for (const page of extracted.pages) {
    const count = regionByPage.get(page.pageNumber)?.size ?? 0;
    console.log(`  Page ${page.pageNumber}: ${count} regions`);
  }

  console.log('\nSections:', ref.sections.length);
  for (const s of ref.sections) {
    console.log(
      `  ${s.id} [${s.pageLayoutType}]: ${s.segments.length} segments`
    );
    for (const seg of s.segments.slice(0, 3)) {
      console.log(
        `    - ${seg.text.slice(0, 60)}... [${seg.extractionMeta.sourceType} conf=${seg.extractionMeta.layoutConfidence}]`
      );
    }
  }

  console.log('\nDiagnostics:');
  console.log('  earlyGatePages:', diagnostics.earlyGatePages.join(', ') || 'none');
  console.log('  lowConfidencePages:', diagnostics.lowConfidencePages.join(', ') || 'none');
  console.log('  secondPassRequired:', diagnostics.secondPassRequired ? 'yes' : 'no');
  console.log('  secondPassExecuted:', diagnostics.secondPassExecuted ? 'yes' : 'no');

  console.log('\nOK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
