import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PipelineResult = {
  fileName: string;
  segments: Array<{
    id: string;
    text: string;
    pageNumber: number;
    zh?: string | null;
  }>;
};

type TranslationReference = {
  caseId: string;
  sourceFile: string;
  title: string;
  outputMode: string;
  sections: Array<{
    id: string;
    title: string;
    summary?: string;
    segments: Array<{
      source: string;
      translation: string;
    }>;
  }>;
};

type SourceMapping = {
  caseId: string;
  sourceFile: string;
  pipelineResultPath: string;
};

const MAPPINGS: SourceMapping[] = [
  {
    caseId: 'case-002-ata001-smock-jacket',
    sourceFile: 'ATA001 MEN\'S SMOCK JACKET头样工艺单.pdf',
    pipelineResultPath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/ata001-smock-jacket/pipeline-result.json'
  },
  {
    caseId: 'case-003-ata019-shell-jacket',
    sourceFile: 'ATA019 MEN\'S WP 3.5L SHELL JACKET TECHPACK.pdf',
    pipelineResultPath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/ata019-shell-jacket/pipeline-result.json'
  },
  {
    caseId: 'case-004-hanna-lightweight-skirt',
    sourceFile: 'Hanna Lightweight Skirt.pdf',
    pipelineResultPath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/hanna-lightweight-skirt/pipeline-result.json'
  },
  {
    caseId: 'case-005-m415013',
    sourceFile: 'M415013.pdf',
    pipelineResultPath: 'data/test02/runs/20260403-m415013-rightlower-v1/samples/m415013/pipeline-result.json'
  },
  {
    caseId: 'case-006-m422123',
    sourceFile: 'M422123.pdf',
    pipelineResultPath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m422123/pipeline-result.json'
  },
  {
    caseId: 'case-007-m441083',
    sourceFile: 'M441083.pdf',
    pipelineResultPath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m441083/pipeline-result.json'
  },
  {
    caseId: 'case-008-m445033',
    sourceFile: 'M445033.pdf',
    pipelineResultPath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m445033/pipeline-result.json'
  },
  {
    caseId: 'case-009-m4e002-soft-puffy-down-jkt',
    sourceFile: 'M4E002 soft puffy down jkt.pdf',
    pipelineResultPath: 'data/test02/runs/20260329-m4e002-localb-v8/samples/m4e002-soft-puffy-down-jkt/pipeline-result.json'
  }
];

function resolveRepoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function groupByPage(result: PipelineResult) {
  const grouped = new Map<number, Array<{ source: string; translation: string }>>();

  for (const segment of result.segments) {
    const translation = segment.zh?.trim();
    if (!translation) {
      continue;
    }

    const bucket = grouped.get(segment.pageNumber) ?? [];
    bucket.push({
      source: segment.text.trim(),
      translation
    });
    grouped.set(segment.pageNumber, bucket);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, segments]) => ({
      id: `page-${pageNumber}`,
      title: `Page ${pageNumber}`,
      summary: `${segments.length} 条英中对照`,
      segments
    }));
}

async function main() {
  for (const mapping of MAPPINGS) {
    const inputPath = resolveRepoPath(mapping.pipelineResultPath);
    const raw = await readFile(inputPath, 'utf8');
    const result = JSON.parse(raw) as PipelineResult;
    const reference: TranslationReference = {
      caseId: mapping.caseId,
      sourceFile: mapping.sourceFile,
      title: mapping.sourceFile,
      outputMode: 'bilingual_sections',
      sections: groupByPage(result)
    };

    const goldenDir = resolveRepoPath(path.join('data/feedback-translation', mapping.caseId, 'golden'));
    await mkdir(goldenDir, { recursive: true });
    const outputPath = path.join(goldenDir, 'translation-reference.json');
    await writeFile(outputPath, `${JSON.stringify(reference, null, 2)}\n`, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
