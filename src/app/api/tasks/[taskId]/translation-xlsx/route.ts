import { NextResponse } from 'next/server';
import { readFile, access, constants } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  AssistantTaskServiceError,
  getAssistantTaskSnapshot
} from '@/lib/assistant/service';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/tasks/:taskId/translation-xlsx
 *
 * Serves the translated xlsx artifact for a given task.
 */
export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const searchParams = new URL(request.url).searchParams;

  try {
    const snapshot = await getAssistantTaskSnapshot(taskId);
    const payload = snapshot.reply.metadata?.skillPayload;

    if (
      !payload ||
      payload.kind !== 'excel_translation_skill_v1' ||
      payload.error ||
      !payload.translatedFilePath
    ) {
      return NextResponse.json(
        { error: '当前任务没有可下载的翻译 Excel 文件。' },
        { status: 400 }
      );
    }

    const filePath = payload.translatedFilePath;

    if (!(await pathExists(filePath))) {
      return NextResponse.json(
        { error: '翻译文件未找到。' },
        { status: 404 }
      );
    }

    const buffer = await readFile(filePath);
    const disposition = searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const fileName = payload.translatedFileName || basename(filePath);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': String(buffer.byteLength),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`
      }
    });
  } catch (error) {
    if (error instanceof AssistantTaskServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: '读取翻译文件失败。' },
      { status: 500 }
    );
  }
}
