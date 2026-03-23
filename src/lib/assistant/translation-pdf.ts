import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ArtifactField, AssistantRequest, AssistantReply } from '@/lib/assistant/types';

const execFileAsync = promisify(execFile);
const TASK_OUTPUT_DIR = join(process.cwd(), '.tmp', 'task-artifacts');

type StructuredTranslationPayload = {
  sections: Array<unknown>;
};

function isStructuredTranslation(value: unknown): value is StructuredTranslationPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { sections?: unknown }).sections)
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
      if (isStructuredTranslation(field.structuredData)) {
        return field;
      }
    }
  }

  return null;
}

async function findCachedTranslatorResponse(sourceFileName: string) {
  const tmpDir = join(process.cwd(), '.tmp');
  if (!(await pathExists(tmpDir))) {
    return null;
  }

  const entries = await readdir(tmpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const responsePath = join(tmpDir, entry.name, 'translator-response.json');
    if (!(await pathExists(responsePath))) {
      continue;
    }

    try {
      const payload = JSON.parse(await readFile(responsePath, 'utf8')) as {
        artifacts?: Array<{
          fields?: Array<{
            citation?: string;
            structuredData?: {
              sourceFile?: string;
            };
          }>;
        }>;
      };
      const firstField = payload.artifacts?.[0]?.fields?.[0];
      const candidateSource =
        firstField?.structuredData?.sourceFile ?? firstField?.citation ?? null;
      if (candidateSource === sourceFileName) {
        return responsePath;
      }
    } catch {
      continue;
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

  if (await pathExists(outputPdfPath)) {
    return {
      pdfPath: outputPdfPath,
      fileName: outputPdfName
    };
  }

  if (structuredField) {
    const payload = {
      summary: reply.summary,
      artifacts: [
        {
          title: '原文保留式双语翻译',
          kind: 'text',
          summary: '基于任务结果生成的双语标注 PDF。',
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
  } else {
    const cachedResponsePath = await findCachedTranslatorResponse(resolvedSource.fileName);
    if (!cachedResponsePath) {
      return null;
    }

    await writeFile(responseJsonPath, await readFile(cachedResponsePath, 'utf8'), 'utf8');
  }

  await execFileAsync('python3', [
    join(process.cwd(), 'scripts', 'render_feedback_pdf.py'),
    resolvedSource.inputPath,
    responseJsonPath,
    outputPdfPath
  ]);

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
