import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TranslationSnapshot } from '@/lib/assistant/translation-pipeline';
import type { ArtifactField, AssistantRequest, AssistantReply } from '@/lib/assistant/types';

const execFileAsync = promisify(execFile);
const TASK_OUTPUT_DIR = join(process.cwd(), '.tmp', 'task-artifacts');

function isTranslationSnapshot(value: unknown): value is TranslationSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 'translation_snapshot_v1' &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeTaskFileName(value: string) {
  return value.replace(/[^\w.\-]+/g, '-');
}

async function resolveInputPdfPath(request: AssistantRequest) {
  const pdfFiles = request.files.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
  for (const file of pdfFiles) {
    if (file.storagePath && (await pathExists(file.storagePath))) {
      return {
        fileName: file.name,
        inputPath: file.storagePath
      };
    }
  }

  for (const file of pdfFiles) {
    const candidatePaths = [join(process.cwd(), 'data', 'test', file.name)];

    for (const candidate of candidatePaths) {
      if (await pathExists(candidate)) {
        return {
          fileName: file.name,
          inputPath: candidate
        };
      }
    }

    const uploadsDir = join(process.cwd(), '.tmp', 'task-uploads');
    if (await pathExists(uploadsDir)) {
      const uploadFiles = await readdir(uploadsDir);
      const matched = uploadFiles.find((entry) => entry.endsWith(`-${sanitizeTaskFileName(file.name)}`));
      if (matched) {
        return {
          fileName: file.name,
          inputPath: join(uploadsDir, matched)
        };
      }
    }
  }

  return null;
}

function findStructuredField(reply: AssistantReply): ArtifactField | null {
  for (const section of reply.artifacts) {
    for (const field of section.fields) {
      if (isTranslationSnapshot(field.structuredData)) {
        return field;
      }
    }
  }

  return null;
}

export async function ensureTranslationPdfArtifact(
  taskId: string,
  request: AssistantRequest,
  reply: AssistantReply
) {
  const structuredField = findStructuredField(reply);
  const resolvedSource = await resolveInputPdfPath(request);
  if (!resolvedSource) {
    return null;
  }

  const taskDir = join(TASK_OUTPUT_DIR, taskId);
  await mkdir(taskDir, { recursive: true });

  const responseJsonPath = join(taskDir, 'translator-response.json');
  const outputPdfName = `${resolvedSource.fileName.replace(/\.[^.]+$/, '')}.annotated.pdf`;
  const outputPdfPath = join(taskDir, outputPdfName);

  if (!structuredField || !isTranslationSnapshot(structuredField.structuredData)) {
    return null;
  }

  const payload = {
    summary: reply.summary,
    artifacts: [
      {
        title: '原文保留式双语翻译',
        kind: 'text',
        summary: '基于冻结的 pipeline snapshot 重新渲染正式标注 PDF。',
        fields: [
          {
            label: structuredField.label,
            value: structuredField.value,
            citation: resolvedSource.fileName,
            structuredData: structuredField.structuredData
          }
        ]
      }
    ]
  };

  await writeFile(responseJsonPath, JSON.stringify(payload, null, 2), 'utf8');

  // Use arch -arm64 on macOS to avoid x86_64/ARM64 .so mismatch in pdfplumber/charset_normalizer
  const useArch = process.platform === 'darwin';
  const execArgs = useArch
    ? ['-arm64', 'python3', join(process.cwd(), 'scripts', 'render_feedback_pdf.py'), resolvedSource.inputPath, responseJsonPath, outputPdfPath]
    : ['python3', join(process.cwd(), 'scripts', 'render_feedback_pdf.py'), resolvedSource.inputPath, responseJsonPath, outputPdfPath];
  await execFileAsync(useArch ? 'arch' : 'python3', execArgs);

  return {
    pdfPath: outputPdfPath,
    fileName: outputPdfName
  };
}

export async function readPdfBuffer(pdfPath: string) {
  return readFile(pdfPath);
}

export async function ensureTaskOutputDir(taskId: string) {
  const taskDir = join(TASK_OUTPUT_DIR, taskId);
  await mkdir(taskDir, { recursive: true });
  return taskDir;
}
