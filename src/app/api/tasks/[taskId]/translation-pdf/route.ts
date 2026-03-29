import { NextResponse } from 'next/server';
import { runAssistant } from '@/lib/assistant/service';
import { getTask, updateTaskFromExecution } from '@/lib/assistant/task-store';
import { ensureTranslationPdfArtifact, readPdfBuffer } from '@/lib/assistant/translation-pdf';

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

function isTranslatorTask(skillIds: string[]) {
  return skillIds.includes('comment-translator');
}

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  let task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  }

  if (task.record.taskType !== 'feedback' || !isTranslatorTask(task.record.selectedSkillIds)) {
    return NextResponse.json({ error: '当前任务没有可生成的翻译 PDF。' }, { status: 400 });
  }

  let artifact = await ensureTranslationPdfArtifact(taskId, task.request, task.reply);

  if (!artifact) {
    const rerunReply = await runAssistant(task.request);
    const snapshot = await updateTaskFromExecution(taskId, task.request, rerunReply);
    if (snapshot) {
      task = await getTask(taskId);
    }

    if (!task) {
      return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
    }

    artifact = await ensureTranslationPdfArtifact(taskId, task.request, task.reply);
  }

  if (!artifact) {
    return NextResponse.json(
      { error: '当前任务未包含可重渲染的 translation snapshot，请重新执行翻译以生成新的正式 PDF 快照。' },
      { status: 409 }
    );
  }

  const pdfBuffer = await readPdfBuffer(artifact.pdfPath);
  const searchParams = new URL(request.url).searchParams;
  const disposition = searchParams.get('download') === '1' ? 'attachment' : 'inline';

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdfBuffer.byteLength),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`
    }
  });
}
