import { notFound } from 'next/navigation';
import Link from 'next/link';
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
  const humanReviewGuide = task.reply.metadata?.humanReviewGuide;

  return (
    <main id="main" className="shell preview-shell">
      <section className="preview-hero">
        <div className="preview-hero-copy">
          <span className="tag">任务预览</span>
          <h1>翻译结果预览</h1>
          <p>{sourceName}</p>
        </div>
        <div className="preview-hero-actions">
          <span className="tag">{task.reply.statusLabel}</span>
          <Link className="secondary-button" href="/">
            返回工作台
          </Link>
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="panel-header preview-header">
          <div>
            <h2>{translationArtifact.title}</h2>
            <p>
              该预览沿用当前任务的结构化翻译结果，仅用于业务核对和样式查看。
            </p>
          </div>
          <span className="tag">{task.reply.statusLabel}</span>
        </div>

        <div className="answer-card preview-summary-card">
          <div className="preview-summary-row">
            <span className="meta-note">任务 ID：{task.record.id}</span>
            <span className="meta-note">文件：{sourceName}</span>
            <span className="meta-note">审核状态：{task.reply.reviewStatusLabel}</span>
          </div>
          {humanReviewGuide ? (
            <div className="answer-card review-guide-card" style={{ marginBottom: 16 }}>
              <h3>人工复核建议</h3>
              <p className="meta-note">{humanReviewGuide.summary}</p>
              {humanReviewGuide.focusPages.length > 0 ? (
                <div className="page-chip-row">
                  {humanReviewGuide.focusPages.map((pageNumber) => (
                    <span key={`preview-focus-page-${pageNumber}`} className="page-chip">
                      第 {pageNumber} 页
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            className="rich-text-output translation-preview standalone-preview"
            dangerouslySetInnerHTML={{ __html: translationArtifact.html }}
          />
        </div>
      </section>
    </main>
  );
}
