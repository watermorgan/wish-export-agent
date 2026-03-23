import { notFound } from 'next/navigation';
import { getTask } from '@/lib/assistant/task-store';

type PageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function TaskPreviewPage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await getTask(taskId);

  if (!task) {
    notFound();
  }

  const translationArtifact = task.reply.artifacts
    .flatMap((section) =>
      section.fields
        .filter((field) => typeof field.richTextHtml === 'string' && field.richTextHtml.length > 0)
        .map((field) => ({
          title: `${section.title} · ${field.label}`,
          html: field.richTextHtml as string
        }))
    )
    .at(0);

  if (!translationArtifact) {
    notFound();
  }

  const sourceName = task.record.files[0]?.name ?? task.record.title;

  return (
    <main className="shell preview-shell">
      <section className="panel preview-panel">
        <div className="panel-header preview-header">
          <div>
            <h1>翻译结果预览</h1>
            <p>{sourceName}</p>
          </div>
          <span className="tag">{task.reply.statusLabel}</span>
        </div>

        <div className="answer-card">
          <h3>{translationArtifact.title}</h3>
          <div
            className="rich-text-output translation-preview standalone-preview"
            dangerouslySetInnerHTML={{ __html: translationArtifact.html }}
          />
        </div>
      </section>
    </main>
  );
}
