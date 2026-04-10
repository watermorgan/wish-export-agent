import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type SourceMapping = {
  sampleId: string;
  sourcePath: string;
};

const MAPPINGS: SourceMapping[] = [
  {
    sampleId: 'ata001-smock-jacket',
    sourcePath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/ata001-smock-jacket/pipeline-result.json'
  },
  {
    sampleId: 'ata019-shell-jacket',
    sourcePath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/ata019-shell-jacket/pipeline-result.json'
  },
  {
    sampleId: 'hanna-lightweight-skirt',
    sourcePath: 'data/test02/runs/20260329-human-ai-rerun-v1/samples/hanna-lightweight-skirt/pipeline-result.json'
  },
  {
    sampleId: 'm415013',
    sourcePath: 'data/test02/runs/20260403-m415013-rightlower-v1/samples/m415013/pipeline-result.json'
  },
  {
    sampleId: 'm422123',
    sourcePath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m422123/pipeline-result.json'
  },
  {
    sampleId: 'm441083',
    sourcePath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m441083/pipeline-result.json'
  },
  {
    sampleId: 'm445033',
    sourcePath: 'data/test02/runs/20260331-sketch-batch-arrayrecover-v1/samples/m445033/pipeline-result.json'
  },
  {
    sampleId: 'm4e002-soft-puffy-down-jkt',
    sourcePath: 'data/test02/runs/20260329-m4e002-localb-v8/samples/m4e002-soft-puffy-down-jkt/pipeline-result.json'
  }
];

function resolveRepoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

async function main() {
  for (const mapping of MAPPINGS) {
    const inputPath = resolveRepoPath(mapping.sourcePath);
    const raw = await readFile(inputPath, 'utf8');
    const outputDir = resolveRepoPath(path.join('data/test02/golden-pipeline', mapping.sampleId));
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'pipeline-result.json');
    await writeFile(outputPath, raw, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
