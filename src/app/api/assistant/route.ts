import { NextResponse } from 'next/server';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MAX_FILES,
  formQuestionSchema,
  uploadedFileSchema
} from '@/lib/assistant/mock-agent';
import { runAssistant } from '@/lib/assistant/service';

export const runtime = 'nodejs';
const DEBUG_PIPELINE = process.env.ASSISTANT_DEBUG_PIPELINE === '1';

export async function POST(request: Request) {
  const requestId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const formData = await request.formData();
  const question = formQuestionSchema.parse(formData.get('question'));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'export-agent-'));

  try {
    const rawFiles = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json(
        {
          error: `一次最多上传 ${MAX_FILES} 个文件。`
        },
        { status: 400 }
      );
    }
    const files = await Promise.all(
      rawFiles.map(async (file, index) => {
        const normalized = uploadedFileSchema.parse({
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream'
        });
        const isPdf = normalized.type.includes('pdf') || normalized.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          return normalized;
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const localPath = path.join(tempDir, `${index}-${normalized.name}`);
        await writeFile(localPath, buffer);
        return {
          ...normalized,
          localPath
        };
      })
    );
    if (DEBUG_PIPELINE) {
      console.log(
        `[assistant:route] request.start ${JSON.stringify({
          requestId,
          fileCount: files.length,
          pdfCount: files.filter((file) => file.type.includes('pdf')).length
        })}`
      );
    }

    const payload = await runAssistant({
      channel: 'web',
      role: 'sales',
      question,
      files,
      selectedSkillIds: [],
      rawPayload: { source: 'web-route' }
    });
    if (DEBUG_PIPELINE) {
      console.log(
        `[assistant:route] request.done ${JSON.stringify({
          requestId,
          hasFinalArtifact: Boolean(payload.finalArtifact),
          providerHits: payload.metadata?.providerHits ?? []
        })}`
      );
    }

    return NextResponse.json(payload);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
