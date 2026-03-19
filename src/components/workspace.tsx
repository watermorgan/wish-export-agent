'use client';

import { useDeferredValue, useState, useTransition } from 'react';
import type { AssistantReply } from '@/lib/assistant/mock-agent';

const quickPrompts = [
  '帮我提炼这份询盘邮件的重点，并列出还缺哪些报价信息。',
  '根据客户附件，生成一封更专业的英文初次回复。',
  '总结客户的采购需求，并判断适合转给谁继续跟进。'
];

type FileDescriptor = {
  name: string;
  size: number;
  type: string;
};

export function Workspace() {
  const [question, setQuestion] = useState(quickPrompts[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredQuestion = useDeferredValue(question);

  function onFileChange(nextFiles: FileList | null) {
    setFiles(nextFiles ? Array.from(nextFiles) : []);
  }

  function formatBytes(size: number) {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function submit() {
    setError(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('question', question);

        for (const file of files) {
          formData.append('files', file);
        }

        const response = await fetch('/api/assistant', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? '请求失败，请稍后再试。');
        }

        setReply(data as AssistantReply);
      } catch (submitError) {
        setReply(null);
        setError(
          submitError instanceof Error
            ? submitError.message
            : '请求失败，请稍后再试。'
        );
      }
    });
  }

  const fileDescriptors: FileDescriptor[] = files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type || '未知类型'
  }));

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-card">
          <span className="eyebrow">Export Desk</span>
          <h1>上传资料，直接得到外贸动作建议。</h1>
          <p>
            这是一个为非技术外贸人员准备的工作台骨架。当前版本支持上传文件、输入业务问题，
            然后由后台智能体返回摘要、风险提示、下一步动作和回复草稿方向。
          </p>

          <div className="hero-grid">
            <div className="hero-metric">
              <strong>3步</strong>
              <span>上传资料、提出问题、拿到执行建议</span>
            </div>
            <div className="hero-metric">
              <strong>双语</strong>
              <span>后续适合扩展为中英回复与报价支持</span>
            </div>
            <div className="hero-metric">
              <strong>PWA</strong>
              <span>网页先上线，后续可像应用一样安装</span>
            </div>
          </div>
        </div>

        <aside className="status-card">
          <h2>当前骨架内置能力</h2>
          <div className="signal-row">
            <span className="signal-label">上传文件</span>
            <span className="signal-value">已接线</span>
          </div>
          <div className="signal-row">
            <span className="signal-label">问答 API</span>
            <span className="signal-value">Mock Agent</span>
          </div>
          <div className="signal-row">
            <span className="signal-label">PWA 安装</span>
            <span className="signal-value">已预留</span>
          </div>
          <div className="signal-row">
            <span className="signal-label">真实模型</span>
            <span className="signal-value">待接入</span>
          </div>
        </aside>
      </section>

      <section className="workspace-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>上传与提问</h2>
              <p>支持邮件、报价单、产品资料、聊天记录、Excel、PDF 等外贸常见文件。</p>
            </div>
            <span className="tag">MVP</span>
          </div>

          <div className="dropzone">
            <strong>拖入文件，或点击选择</strong>
            <p>
              推荐先上传客户询盘、产品规格、报价草稿，再输入你想让智能体帮你完成的事。
            </p>
            <input
              aria-label="上传文件"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
              onChange={(event) => onFileChange(event.target.files)}
            />
          </div>

          {fileDescriptors.length > 0 ? (
            <div className="file-list">
              {fileDescriptors.map((file) => (
                <div className="file-item" key={`${file.name}-${file.size}`}>
                  <span className="file-name">{file.name}</span>
                  <span className="file-meta">
                    {file.type} · {formatBytes(file.size)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="composer">
            <label htmlFor="question">告诉外贸助手你要完成什么</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：请帮我总结客户需求，并生成英文初次回复草稿。"
            />

            <div className="chip-row">
              {quickPrompts.map((prompt) => (
                <button
                  className="chip"
                  key={prompt}
                  type="button"
                  onClick={() => setQuestion(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="submit-row">
              <span className="submit-hint">
                当前问题长度：{deferredQuestion.trim().length} 字
              </span>
              <button
                className="primary-button"
                type="button"
                disabled={isPending}
                onClick={submit}
              >
                {isPending ? '处理中...' : '生成建议'}
              </button>
            </div>
          </div>

          <p className="footer-note">
            现在返回的是本地 mock 流程，后面会替换成真实智能体，包括文件解析、知识检索、回复草拟和人工接管规则。
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>智能体输出预览</h2>
              <p>先给摘要，再给风险，再给下一步动作，避免一上来就是长篇聊天记录。</p>
            </div>
            <span className="tag">{reply?.intentLabel ?? 'Waiting'}</span>
          </div>

          {error ? (
            <div className="answer-card answer-callout">
              <h3>请求失败</h3>
              <p>{error}</p>
            </div>
          ) : null}

          <div className="answer-grid">
            <div className="answer-card">
              <h3>摘要</h3>
              <p>
                {reply?.summary ??
                  '上传文件并提交问题后，这里会展示客户需求、文件重点和智能体的第一结论。'}
              </p>
            </div>

            <div className="answer-card">
              <h3>建议动作</h3>
              <ul>
                {(reply?.nextActions ?? [
                  '先定义“询盘解析 / 回复草拟 / 报价前检查”三条 MVP 工作流。',
                  '明确哪些字段由系统抽取，哪些字段必须人工确认。',
                  '把真实大模型和知识库接到当前 API 路由。'
                ]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="answer-card">
              <h3>待确认项</h3>
              <ul>
                {(reply?.riskAlerts ?? [
                  '价格、交期、认证和付款条件不应由系统直接承诺。',
                  '如果客户资料涉及隐私，需要定义脱敏与审计规则。'
                ]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="answer-card">
              <h3>回复草稿方向</h3>
              <p>
                {reply?.draftDirection ??
                  '后续这里会输出双语回复框架，例如英文首封回复、报价补充问题清单和内部交接建议。'}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
