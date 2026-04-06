import type { AssistantReply, AssistantRequest } from '@/lib/assistant/types';
import { buildAssistantReply } from '@/lib/assistant/mock-agent';
import { runPdfTranslationPipeline } from '@/lib/assistant/translation-pipeline';

export async function runAssistant(
  request: AssistantRequest
): Promise<AssistantReply> {
  const baseReply = buildAssistantReply({
    question: request.question,
    files: request.files
  });

  const pdfFiles = request.files.filter((file) => file.type.includes('pdf') && file.localPath);
  if (pdfFiles.length === 0) {
    return baseReply;
  }

  const pipelineResults = await Promise.all(
    pdfFiles.map((file) =>
      runPdfTranslationPipeline({
        filePath: file.localPath!,
        fileName: file.name
      })
    )
  );
  const totalSegments = pipelineResults.reduce((sum, item) => sum + item.segments.length, 0);
  const translatedSegments = pipelineResults.reduce(
    (sum, item) => sum + item.segments.filter((segment) => Boolean(segment.zh)).length,
    0
  );
  const aTriggered = pipelineResults.some((item) => item.diagnostics.aModelTriggered);
  const aExecuted = pipelineResults.some((item) => item.diagnostics.aModelExecuted);
  const bExecuted = pipelineResults.some((item) => item.diagnostics.bModelExecuted);
  const strategySummary = pipelineResults
    .map((item) => `${item.fileName}:${item.outputStrategy}`)
    .join(', ');

  return {
    ...baseReply,
    summary: `已执行真实主链：抽取 ${totalSegments} 段，翻译完成 ${translatedSegments} 段。`,
    draftDirection:
      `当前链路为：pdftotext -> first pass fusion -> early gate/low-confidence -> A辅助 -> second pass占位 -> B翻译 -> 渲染输出。输出策略：${strategySummary}`,
    metadata: {
      ...baseReply.metadata,
      providerHits: [
        aTriggered ? `A_triggered:${aExecuted ? 'executed' : 'fallback'}` : 'A_not_triggered',
        `B:${bExecuted ? 'executed' : 'fallback'}`
      ]
    },
    finalArtifact: JSON.stringify(
      pipelineResults.map((item) => ({
        artifactLinks: {
          bilingualXlsx:
            item.outputs.bilingualTableBundle?.downloadable?.relativePath
              ? `/api/assistant/artifacts?path=${encodeURIComponent(item.outputs.bilingualTableBundle.downloadable.relativePath)}`
              : null,
          annotatedPreview:
            item.outputs.annotatedPdf?.downloadable?.relativePath
              ? `/api/assistant/artifacts?path=${encodeURIComponent(item.outputs.annotatedPdf.downloadable.relativePath)}`
              : null
        },
        fileName: item.fileName,
        documentMainType: item.documentMainType,
        outputStrategy: item.outputStrategy,
        downloadable: item.outputs.bilingualTableBundle?.downloadable ?? null,
        diagnostics: item.diagnostics,
        segments: item.segments,
        outputs: item.outputs
      })),
      null,
      2
    )
  } as AssistantReply;
}
