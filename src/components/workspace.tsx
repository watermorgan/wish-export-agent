'use client';

import { useDeferredValue, useEffect, useState, useTransition } from 'react';
import { FeedbackCapture } from '@/components/feedback/feedback-capture';
import {
  businessScenarioPresets,
  quickPrompts,
  roleOptions,
  skillCatalog,
  taskTypeOptions,
  workflowTemplates
} from '@/lib/assistant/catalog';
import {
  defaultTranslationModelId,
  defaultVisionModelId,
  translationModelOptions,
  visionModelOptions
} from '@/lib/assistant/model-options';
import type {
  AssistantReply,
  AssistantRole,
  PendingConfirmation,
  ReviewEntry,
  SkillDefinition,
  TaskRecord,
  TaskType,
  WorkspaceFeedbackSource,
  WorkflowTemplate
} from '@/lib/assistant/types';

type FileDescriptor = {
  name: string;
  size: number;
  type: string;
};

type ProviderHealth = {
  provider: 'local-openai' | 'dashscope' | 'modelscope';
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

function getConfirmationStatusLabel(status: PendingConfirmation['status']) {
  switch (status) {
    case 'required':
      return '必须确认';
    case 'recommended':
      return '建议确认';
    case 'confirmed':
      return '已确认';
    case 'returned':
      return '已退回';
  }
}

function getRoleLabel(role: AssistantRole) {
  return role === 'sales' ? '业务员' : '主管';
}

function getReviewDecisionLabel(decision: ReviewEntry['decision']) {
  return decision === 'approved' ? '审核通过' : '退回处理';
}

function buildTranslationHtmlDocument(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f4eb;
        color: #1f2a1f;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        background: #fffdf7;
        border: 1px solid #d9d1bf;
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 16px 40px rgba(31, 42, 31, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p.meta {
        margin: 0 0 24px;
        color: #5f6b63;
      }
      .fixture-section {
        margin-bottom: 20px;
        padding: 16px;
        border: 1px solid #e6dfd0;
        border-radius: 16px;
        background: #fff;
      }
      .fixture-section-header h3 {
        margin: 0 0 8px;
      }
      .fixture-section-header p {
        margin: 0 0 12px;
        color: #617063;
      }
      .bilingual-block {
        padding: 12px;
        border-radius: 12px;
        background: #f8faf6;
      }
      .source-line {
        margin: 0 0 8px;
        color: #243024;
        font-weight: 600;
        white-space: pre-wrap;
      }
      .translation-line {
        margin: 0;
        color: #0f5f3a;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p class="meta">当前内容来自本次接口返回的结构化翻译结果，可直接预览或下载，不依赖任务持久化接口。</p>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

function getCanonicalFeedbackSource(
  reply: AssistantReply | null
): WorkspaceFeedbackSource | null {
  const feedbackSource = reply?.metadata?.skillPayload?.feedbackSource;
  if (feedbackSource?.fileName) {
    return feedbackSource;
  }

  const items = reply?.metadata?.skillPayload?.snapshot?.items ?? [];
  const item =
    items.find(
      (candidate: (typeof items)[number]) =>
        typeof candidate.en === 'string' &&
        candidate.en.trim().length > 0 &&
        typeof candidate.zh === 'string' &&
        candidate.zh.trim().length > 0
    ) ??
    items.find(
      (candidate: (typeof items)[number]) =>
        typeof candidate.en === 'string' && candidate.en.trim().length > 0
    );

  if (!item) {
    return null;
  }

  return {
    fileName: reply?.metadata?.skillPayload?.fileName ?? reply?.task?.files[0]?.name ?? '',
    pageNumber: item.pageNumber,
    segmentId: item.regionId,
    sourceText: item.en,
    currentTranslation: item.zh
  };
}

export function Workspace() {
  const defaultTemplate = workflowTemplates.find(
    (template) => template.id === 'translation-merge'
  );
  const defaultTaskType: TaskType = 'feedback';
  const defaultSkillIds = ['comment-translator'];

  const [role, setRole] = useState<AssistantRole>('sales');
  const [taskType, setTaskType] = useState<TaskType>(defaultTaskType);
  const [question, setQuestion] = useState(quickPrompts[1]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    defaultTemplate?.id ?? null
  );
  const [visionModelOverride, setVisionModelOverride] = useState<string>(defaultVisionModelId);
  const [translationModelOverride, setTranslationModelOverride] = useState<string>(
    defaultTranslationModelId
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    defaultTemplate?.steps.filter((step) => step === 'comment-translator') ?? defaultSkillIds
  );
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [selectedRecentTaskIds, setSelectedRecentTaskIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const deferredQuestion = useDeferredValue(question);

  function onFileChange(nextFiles: FileList | null) {
    setFiles(nextFiles ? Array.from(nextFiles) : []);
  }

  function hydrateFromReply(nextReply: AssistantReply) {
    setReply(nextReply);
    setActiveTaskId(nextReply.task?.id ?? null);
    setRole(nextReply.role);
    setTaskType(nextReply.taskType);
    setQuestion(nextReply.task?.question ?? question);
    setSelectedTemplateId(nextReply.selectedTemplate?.id ?? null);
    setSelectedSkillIds((nextReply.selectedSkills ?? []).map((skill) => skill.id));
    setVisionModelOverride(
      nextReply.task?.visionModelOverride ?? defaultVisionModelId
    );
    setTranslationModelOverride(
      nextReply.task?.translationModelOverride ??
        nextReply.task?.modelOverride ??
        defaultTranslationModelId
    );
    setFiles([]);
  }

  async function refreshTasks() {
    const response = await fetch('/api/tasks', {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error('任务列表加载失败。');
    }

    const data = (await response.json()) as {
      tasks: TaskRecord[];
    };
    setRecentTasks(data.tasks);
  }

  useEffect(() => {
    refreshTasks().catch(() => {
      return;
    });
  }, []);

  useEffect(() => {
    fetch('/api/model-health')
      .then((response) => response.json())
      .then((data: { providers?: ProviderHealth[] }) => {
        setProviderHealth(data.providers ?? []);
      })
      .catch(() => {
        setProviderHealth([]);
      });
  }, []);

  useEffect(() => {
    setSelectedRecentTaskIds((current) =>
      current.filter((taskId) => recentTasks.some((task) => task.id === taskId))
    );
  }, [recentTasks]);

  function applyTemplate(template: WorkflowTemplate) {
    setTaskType(template.taskType);
    setSelectedTemplateId(template.id);
    setSelectedSkillIds(template.steps);
    const promptIndex =
      template.taskType === 'bom' ? 0 : template.taskType === 'feedback' ? 1 : 2;
    setQuestion(quickPrompts[promptIndex]);
  }

  function applyBusinessScenario(presetId: string) {
    const preset = businessScenarioPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    const relatedTemplate = workflowTemplates.find((template) => template.id === preset.templateId);

    setRole('sales');
    setTaskType(preset.taskType);
    setQuestion(preset.prompt);
    setSelectedTemplateId(relatedTemplate?.id ?? preset.templateId);
    setSelectedSkillIds(preset.skillIds);
    setShowAdvancedSettings(false);
  }

  function toggleSkill(skill: SkillDefinition) {
    setSelectedTemplateId(null);
    setTaskType(skill.taskTypes[0]);
    setSelectedSkillIds((current) =>
      current.includes(skill.id)
        ? current.filter((skillId) => skillId !== skill.id)
        : [...current, skill.id]
    );
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
        formData.append('role', role);
        formData.append('taskType', taskType);
        formData.append('question', question);
        formData.append('selectedSkillIds', JSON.stringify(selectedSkillIds));
        formData.append('modelOverride', translationModelOverride);
        formData.append('visionModelOverride', visionModelOverride);
        formData.append('translationModelOverride', translationModelOverride);

        if (selectedTemplateId) {
          formData.append('selectedTemplateId', selectedTemplateId);
        }

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

        const parsed = data as AssistantReply;
        hydrateFromReply(parsed);
        setRecentTasks(parsed.recentTasks ?? []);
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

  function startNewTranslationTask() {
    setReply(null);
    setActiveTaskId(null);
    setError(null);
    setTaskType(defaultTaskType);
    setQuestion(quickPrompts[1]);
    setSelectedTemplateId(defaultTemplate?.id ?? null);
    setSelectedSkillIds(defaultSkillIds);
    setVisionModelOverride(defaultVisionModelId);
    setTranslationModelOverride(defaultTranslationModelId);
    setFiles([]);
  }

  const fileDescriptors: FileDescriptor[] = files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type || '未知类型'
  }));

  const currentTask = reply?.task ?? null;
  const pendingReviewTasks = recentTasks.filter(
    (task) => task.reviewStatus === 'pending_review'
  );
  const visibleRecentTasks =
    role === 'supervisor'
      ? recentTasks
      : recentTasks.filter((task) => task.role === role);
  const visibleFiles =
    fileDescriptors.length > 0
      ? fileDescriptors
      : (currentTask?.files ?? []).map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type || '未知类型'
	        }));
  const canEditConfirmations = ['pending_user_confirmation', 'returned'].includes(
    currentTask?.status ?? ''
  );
  const reviewHistory = reply?.reviewHistory ?? [];
  const translationArtifact = (reply?.artifacts ?? [])
    .flatMap((section) =>
      section.fields
        .filter((field) => typeof field.richTextHtml === 'string' && field.richTextHtml.length > 0)
        .map((field) => ({
          title: `${section.title} · ${field.label}`,
          html: field.richTextHtml as string
        }))
    )
    .at(0);
  const translationHtml = translationArtifact?.html ?? null;
  const uploadedFileCount = fileDescriptors.length > 0 ? fileDescriptors.length : currentTask?.files.length ?? 0;
  const translationTiming = reply?.metadata?.translationTiming;
  const activeProvider = reply?.metadata?.activeProvider;
  const activeModel = reply?.metadata?.activeModel ?? translationModelOverride;
  const humanReviewGuide = reply?.metadata?.humanReviewGuide ?? null;
  const feedbackSegmentContext = getCanonicalFeedbackSource(reply);
  const feedbackSourceName =
    feedbackSegmentContext?.fileName ??
    reply?.metadata?.skillPayload?.fileName ??
    currentTask?.files[0]?.name ??
    files[0]?.name ??
    null;
  const feedbackContext: WorkspaceFeedbackSource | null = feedbackSourceName
    ? {
        taskId: activeTaskId ?? currentTask?.id ?? null,
        fileName: feedbackSourceName,
        pageNumber: feedbackSegmentContext?.pageNumber,
        segmentId: feedbackSegmentContext?.segmentId,
        sourceText: feedbackSegmentContext?.sourceText,
        currentTranslation: feedbackSegmentContext?.currentTranslation
      }
    : null;
  const translationHtmlDocument = translationHtml
    ? buildTranslationHtmlDocument(
        translationArtifact?.title ?? '翻译结果预览',
        translationHtml
      )
    : null;
  const primaryArtifactLink = reply?.metadata?.pdfArtifactLinks?.[0];
  const previewUrl =
    (primaryArtifactLink?.primary === 'annotated_preview'
      ? primaryArtifactLink.annotatedPreviewUrl
      : null) ??
    primaryArtifactLink?.annotatedPreviewUrl ??
    null;
  const downloadUrl =
    (primaryArtifactLink?.primary === 'bilingual_xlsx'
      ? primaryArtifactLink.bilingualXlsxUrl
      : null) ??
    primaryArtifactLink?.tableStylePdfUrl ??
    primaryArtifactLink?.bilingualXlsxUrl ??
    primaryArtifactLink?.annotatedPreviewUrl ??
    null;
  const guidanceText = isPending
    ? '正在处理文档：1. 抽取内容 2. 整理段落 3. 分段翻译 4. 生成结果与 PDF。'
    : uploadedFileCount === 0
      ? '先上传文件，再点击“开始翻译”。默认执行保留英文原文 + 中文翻译。'
      : currentTask
        ? '翻译结果已生成。先查看结果，再处理待确认项。'
        : `已上传 ${uploadedFileCount} 个文件。下一步点击“开始翻译”。`;
  const unhealthyProviders = providerHealth.filter((provider) => provider.status !== 'ok');

  function openTranslationResult() {
    const directUrl = previewUrl;
    if (directUrl) {
      const resultWindow = window.open(directUrl, '_blank', 'noopener,noreferrer');

      if (!resultWindow) {
        setError('浏览器阻止了新窗口，请允许弹窗后重试。');
      }
      return;
    }

    if (translationHtmlDocument) {
      const blob = new Blob([translationHtmlDocument], { type: 'text/html;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const resultWindow = window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

      if (!resultWindow) {
        setError('浏览器阻止了新窗口，请允许弹窗后重试。');
      }
      return;
    }

    if (!currentTask) {
      return;
    }

    const resultWindow = window.open(
      `/api/tasks/${currentTask.id}/translation-pdf`,
      '_blank',
      'noopener,noreferrer'
    );

    if (!resultWindow) {
      setError('浏览器阻止了新窗口，请允许弹窗后重试。');
    }
  }

  function downloadTranslationResult() {
    const directUrl = downloadUrl;
    if (directUrl) {
      const link = document.createElement('a');
      link.href = directUrl;
      link.download = '';
      link.click();
      return;
    }

    if (translationHtmlDocument) {
      const blob = new Blob([translationHtmlDocument], { type: 'text/html;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const fileBaseName = fileDescriptors[0]?.name?.replace(/\.[^.]+$/, '') ??
        currentTask?.title ??
        'translation-result';
      link.href = objectUrl;
      link.download = `${fileBaseName}.translated.html`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }

    if (!currentTask) {
      return;
    }

    const link = document.createElement('a');
    link.href = `/api/tasks/${currentTask.id}/translation-pdf?download=1`;
    link.click();
  }

  async function runTaskAction(
    endpoint: string,
    init?: RequestInit
  ) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      ...init
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? '任务操作失败。');
    }

    const nextReply = data.reply as AssistantReply;
    hydrateFromReply(nextReply);
    await refreshTasks();
  }

  function saveCurrentTask() {
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${currentTask.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role,
            taskType,
            question,
            selectedSkillIds,
            selectedTemplateId,
            modelOverride: translationModelOverride,
            visionModelOverride,
            translationModelOverride
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? '保存任务失败。');
        }

        const nextReply = data.reply as AssistantReply;
        hydrateFromReply(nextReply);
        await refreshTasks();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '保存任务失败。');
      }
    });
  }

  function openTask(taskId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'GET'
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? '任务详情加载失败。');
        }

        hydrateFromReply(data.reply as AssistantReply);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '任务详情加载失败。');
      }
    });
  }

  function toggleRecentTaskSelection(taskId: string) {
    setSelectedRecentTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    );
  }

  async function deleteSingleTask(taskId: string) {
    if (!window.confirm('确认删除这条任务吗？')) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'DELETE'
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? '删除任务失败。');
        }

        if (activeTaskId === taskId) {
          startNewTranslationTask();
        }

        await refreshTasks();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '删除任务失败。');
      }
    });
  }

  async function bulkDeleteTasks() {
    if (selectedRecentTaskIds.length === 0) {
      return;
    }

    if (!window.confirm(`确认删除已选中的 ${selectedRecentTaskIds.length} 条任务吗？`)) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/tasks', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            taskIds: selectedRecentTaskIds
          })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? '批量删除任务失败。');
        }

        if (activeTaskId && selectedRecentTaskIds.includes(activeTaskId)) {
          startNewTranslationTask();
        }

        setSelectedRecentTaskIds([]);
        setRecentTasks(data.recentTasks ?? []);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '批量删除任务失败。');
      }
    });
  }

  function submitForReview() {
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/submit`);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '提交审核失败。');
      }
    });
  }

  function reviewCurrentTask(decision: 'approved' | 'returned') {
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/review`, {
          body: JSON.stringify({
            decision,
            reviewer: role,
            comment:
              decision === 'returned'
                ? '当前示例为主管退回，请业务员继续处理待确认项。'
                : '当前示例为主管审核通过。'
          })
        });
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '审核失败。');
      }
    });
  }

  function exportCurrentTask() {
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/export`);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '导出失败。');
      }
    });
  }

  function updateConfirmationStatus(
    confirmationId: string,
    status: PendingConfirmation['status']
  ) {
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/confirmations/${confirmationId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        });
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '更新待确认项失败。');
      }
    });
  }

  return (
    <main id="main" className="shell">
      <section className="workspace-topbar">
        <div>
          <h1>外贸助手工作台</h1>
          <p>先选业务场景，再选细分需求；模型和工具只放在需要时的高级设置里。</p>
        </div>
        <div className="workspace-topbar-meta">
          <span className="tag">默认场景：批注翻译与归并</span>
          <span className="tag">待审核 {pendingReviewTasks.length}</span>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>业务场景优先</h2>
              <p>先按业务场景选入口，再补一句处理要求，减少模型术语干扰。</p>
            </div>
            <span className="tag">默认：保留英文原文 + 业务可读中文</span>
          </div>

            <div className="answer-card answer-callout guidance-card">
              <h3>当前指引</h3>
              <p>{guidanceText}</p>
              <ul>
                <li>支持 PDF、Word、Excel、邮件、TXT。</li>
                <li>默认不会做归并，也不会自动对外发送。</li>
                <li>价格、交期、认证、付款、物流等内容仍会进入待确认项。</li>
              </ul>
            </div>
            {providerHealth.length > 0 ? (
              <div className="answer-card answer-callout provider-health-card">
                <h3>模型状态</h3>
                <p>提交前先看这里。当前页面会优先提示本地服务、在线额度和 token 状态。</p>
                <div className="provider-health-list">
                  {providerHealth.map((provider) => (
                    <div
                      key={provider.provider}
                      className={`provider-health-item status-${provider.status}`}
                    >
                      <strong>{provider.label}</strong>
                      <span>{provider.detail}</span>
                    </div>
                  ))}
                </div>
                {unhealthyProviders.length > 0 ? (
                  <p className="meta-note">
                    当前存在不可用模型。若你选择的模型不可用，请先恢复服务或手动切换到可用模型后再提交。
                  </p>
                ) : null}
              </div>
            ) : null}

          <div className="section-stack">
            <div className="section-title">
              <h3>高频业务场景</h3>
              <p>先选这一块，系统会自动带入更像人工操作的默认配置。</p>
            </div>
            <div className="choice-grid" data-testid="business-scenario-options">
              {businessScenarioPresets.map((preset) => (
                <button
                  className="choice-card scene-card"
                  data-testid={`business-scenario-${preset.id}`}
                  key={preset.id}
                  type="button"
                  onClick={() => applyBusinessScenario(preset.id)}
                >
                  <span className="tag scene-card-tag">{preset.audienceHint}</span>
                  <strong>{preset.title}</strong>
                  <span>{preset.summary}</span>
                  <span className="scene-card-footer">点击后自动带入默认模板与处理要求</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dropzone">
            <span className="material-symbols-outlined dropzone-icon">cloud_upload</span>
            <strong>上传文件</strong>
            <p>把需要处理的 PDF、Excel 拖到这里，先看业务场景，再开始处理。</p>
            <input
              data-testid="file-input"
              aria-label="上传文件"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
              onChange={(event) => onFileChange(event.target.files)}
            />
          </div>

          {visibleFiles.length > 0 ? (
            <div className="file-list">
              {visibleFiles.map((file) => (
                <div className="file-item" key={`${file.name}-${file.size}`}>
                  <span className="file-name">{file.name}</span>
                  <span className="file-meta">
                    {file.type} · {formatBytes(file.size)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <details className="advanced-settings" open={showAdvancedSettings}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setShowAdvancedSettings((current) => !current);
              }}
            >
              {showAdvancedSettings ? '收起高级设置' : '展开高级设置'}
            </summary>

            {showAdvancedSettings ? (
              <div className="advanced-settings-body">
                <div className="section-stack">
                  <div className="section-title">
                    <h3>角色与职责</h3>
                    <p>业务员偏执行，主管偏复核。</p>
                  </div>
                  <div className="choice-grid compact-grid">
                    {roleOptions.map((option) => (
                      <button
                        className={`choice-card ${role === option.id ? 'choice-card-active' : ''}`}
                        key={option.id}
                        type="button"
                        onClick={() => setRole(option.id)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="section-stack">
                  <div className="section-title">
                    <h3>任务类型</h3>
                    <p>按业务目标选择，不要先从模型名开始。</p>
                  </div>
                  <div className="choice-grid">
                    {taskTypeOptions.map((option, index) => (
                      <button
                        className={`choice-card ${taskType === option.id ? 'choice-card-active' : ''}`}
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setTaskType(option.id);
                          setQuestion(quickPrompts[index]);
                        }}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="section-stack">
                  <div className="section-title">
                    <h3>工作模板</h3>
                    <p>模板决定默认步骤和处理深度，尽量按高频场景复用。</p>
                  </div>
                  <div className="choice-grid">
                    {workflowTemplates.map((template) => (
                      <button
                        className={`choice-card ${selectedTemplateId === template.id ? 'choice-card-active' : ''}`}
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template)}
                      >
                        <strong>{template.name}</strong>
                        <span>{template.goal}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="section-stack">
                  <div className="section-title">
                    <h3>工具链</h3>
                    <p>仅在业务场景需要时再手动拆分工具。</p>
                  </div>
                  <div className="choice-grid">
                    {skillCatalog.map((skill) => (
                      <button
                        className={`choice-card ${selectedSkillIds.includes(skill.id) ? 'choice-card-active' : ''}`}
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(skill)}
                      >
                        <strong>{skill.name}</strong>
                        <span>{skill.purpose}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="section-stack">
                  <div className="section-title">
                    <h3>识别模型（A）</h3>
                    <p>默认沿用系统建议，只有识别质量有特殊要求时才切换。</p>
                  </div>
                  <div className="choice-grid compact-grid" data-testid="vision-model-options">
                    {visionModelOptions.map((option) => (
                      <button
                        className={`choice-card ${visionModelOverride === option.id ? 'choice-card-active' : ''}`}
                        key={option.id}
                        type="button"
                        onClick={() => setVisionModelOverride(option.id)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="section-stack">
                  <div className="section-title">
                    <h3>翻译模型（B）</h3>
                    <p>高频场景优先保证业务术语一致，后续再微调文风。</p>
                  </div>
                  <div className="choice-grid compact-grid" data-testid="translation-model-options">
                    {translationModelOptions.map((option) => (
                      <button
                        className={`choice-card ${translationModelOverride === option.id ? 'choice-card-active' : ''}`}
                        key={option.id}
                        type="button"
                        onClick={() => setTranslationModelOverride(option.id)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </details>

          <div className="composer">
            <label htmlFor="question">处理要求</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：请保留英文原文，在每段下方增加中文翻译，仅做翻译，不做归并。"
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
                {activeTaskId ? `当前任务：${activeTaskId} · ` : ''}
                已上传 {uploadedFileCount} 个文件 · 输入 {deferredQuestion.trim().length} 字
              </span>
              <div className="submit-actions">
                <button
                  className="tertiary-button"
                  type="button"
                  disabled={isPending}
                  onClick={startNewTranslationTask}
                >
                  新建翻译任务
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isPending || !currentTask}
                  onClick={saveCurrentTask}
                >
                  保存当前任务
                </button>
                <button
                  data-testid="start-translation"
                  className="primary-button"
                  type="button"
                  disabled={isPending || uploadedFileCount === 0}
                  onClick={submit}
                >
                  {isPending ? '正在翻译...' : currentTask ? '重新翻译' : '开始翻译'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>翻译结果</h2>
              <p>结果生成后，优先在这里查看、打开或下载。</p>
            </div>
            <span className="tag">
              {reply ? `${reply.intentLabel} · ${reply.statusLabel}` : 'Waiting'}
            </span>
          </div>

          {error ? (
            <div
              className="answer-card error-card"
              data-testid="request-error"
            >
              <div className="error-card-header">
                <span className="material-symbols-outlined error-card-icon">error</span>
                <div>
                  <h3 className="error-card-title">请求失败</h3>
                  <p className="error-card-summary">
                    当前请求无法完成，请检查模型状态、文件输入或网络连接后重试。
                  </p>
                </div>
              </div>
              {error.length > 150 ? (
                <details className="error-card-details">
                  <summary>
                    <span className="material-symbols-outlined">expand_more</span>
                    查看详细错误日志
                  </summary>
                  <pre className="error-card-code">{error}</pre>
                </details>
              ) : (
                <p className="error-card-message">{error}</p>
              )}
            </div>
          ) : null}

          <div className="answer-grid">
	            <div className="answer-card result-highlight-card">
	              <div data-testid="result-summary">
	              <h3>结果总览</h3>
              <p>
                {reply?.summary ??
                  '处理完成后，这里会优先展示翻译摘要、当前状态和下一步建议。'}
              </p>
                <div className="result-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!translationHtml && !previewUrl && !currentTask}
                    onClick={openTranslationResult}
                  >
                    页面查看
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!translationHtml && !downloadUrl && !currentTask}
                    onClick={downloadTranslationResult}
                  >
                    下载翻译结果
                  </button>
                </div>
	              {currentTask ? (
	                <p className="meta-note" data-testid="task-id">
                  任务ID：{currentTask.id} · 审核状态：
                  {reply?.reviewStatusLabel ?? currentTask.reviewStatus}
                </p>
              ) : null}
              <p className="meta-note" data-testid="active-model">
                当前翻译模型：
                {translationModelOptions.find((option) => option.id === activeModel)?.label ??
                  activeModel}
                {activeProvider ? ` · Provider：${activeProvider}` : ''}
              </p>
	              {currentTask?.reviewedBy ? (
	                <p className="meta-note">
	                  最近审核人：{getRoleLabel(currentTask.reviewedBy)}
	                  {currentTask.reviewComment ? ` · 审核意见：${currentTask.reviewComment}` : ''}
	                </p>
	              ) : null}
                </div>
	            </div>

            <div className="answer-card answer-callout" data-testid="artifact-links">
              <h3>翻译结果入口</h3>
              {reply?.metadata?.skillPayload?.disclosure ? (
                <div
                  className={`disclosure-banner disclosure-banner--${
                    reply.metadata.skillPayload.disclosure.humanReviewRequired ? 'pending' : 'approved'
                  }`}
                  data-testid="ai-disclosure-banner"
                  role="note"
                >
                  <strong>AI 披露</strong>
                  <span>{reply.metadata.skillPayload.disclosure.disclosureZh}</span>
                </div>
              ) : null}
              <p className="meta-note">
                表格类（TP/BOM）优先提供双语 Excel；线稿/批注类优先提供预览页。链接由服务端生成，与下方 JSON 一致。
              </p>

              {reply?.metadata?.pdfArtifactLinks?.length ? (
                <ul className="confirmation-list">
                  {reply.metadata.pdfArtifactLinks.map((link) => (
                    <li key={link.fileName} className="confirmation-item">
                      <div className="confirmation-header">
                        <strong>{link.fileName}</strong>
                        <span className="tag">
                          {link.documentMainType} · {link.outputStrategy}
                        </span>
                      </div>

                      <div className="result-actions" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                        {link.bilingualXlsxUrl ? (
                          <a
                            className={link.primary === 'bilingual_xlsx' ? 'primary-button' : 'secondary-button'}
                            href={link.bilingualXlsxUrl}
                            download
                          >
                            下载双语 Excel
                          </a>
                        ) : null}

                        {link.annotatedPreviewUrl ? (
                          <a
                            className={link.primary === 'annotated_preview' ? 'primary-button' : 'secondary-button'}
                            href={link.annotatedPreviewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开翻译预览
                          </a>
                        ) : null}

                        {link.tableStylePdfUrl ? (
                          <a
                            className={link.primary === 'bilingual_xlsx' ? 'secondary-button' : 'primary-button'}
                            href={link.tableStylePdfUrl}
                            download
                          >
                            下载表格 PDF
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta-note">暂无可下载产物。</p>
              )}

              {reply?.metadata?.pipelineFallbackHints?.length ? (
                <div style={{ marginTop: 12 }}>
                  <p className="meta-note">
                    <strong>模型状态（脱敏）</strong>
                  </p>
                  <ul>
                    {reply.metadata.pipelineFallbackHints.map((hint) => (
                      <li key={hint} className="meta-note">
                        {hint}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="answer-card review-guide-card" data-testid="human-review-guide">
              <h3>人工复核建议</h3>
              <p className="meta-note">
                {humanReviewGuide?.summary ??
                  '翻译完成后，这里会提示先看哪些页、哪些细项最值得人工确认。'}
              </p>

              {humanReviewGuide?.focusPages?.length ? (
                <div className="page-chip-row">
                  {humanReviewGuide.focusPages.map((pageNumber) => (
                    <span key={`focus-page-${pageNumber}`} className="page-chip">
                      第 {pageNumber} 页
                    </span>
                  ))}
                </div>
              ) : null}

              {humanReviewGuide?.hints?.length ? (
                <ul className="review-guide-list">
                  {humanReviewGuide.hints.map((hint) => (
                    <li key={hint.id} className="review-guide-item">
                      <div className="review-guide-item-header">
                        <strong>{hint.title}</strong>
                        <span className={`tag review-priority review-priority-${hint.priority}`}>
                          {hint.priority === 'high' ? '高优先级' : '建议复核'}
                        </span>
                      </div>
                      <p>{hint.reason}</p>
                      {hint.pageNumbers.length ? (
                        <p className="meta-note">
                          关联页面：第 {hint.pageNumbers.join('、')} 页
                        </p>
                      ) : null}
                      {hint.examples?.length ? (
                        <p className="review-guide-examples">
                          典型原文：{hint.examples.join(' / ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {humanReviewGuide?.suggestedAction ? (
                <p className="review-guide-action">{humanReviewGuide.suggestedAction}</p>
              ) : null}
            </div>

            <div className="answer-card">
              <h3>下一步</h3>
              <ul>
                {(reply?.nextActions ?? [
                  '先上传资料并执行一次任务。',
                  '处理完待确认项后，再提交主管审核。',
                  '审核通过后再导出正式结果。'
                ]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="answer-card">
              <h3>翻译耗时</h3>
              {translationTiming ? (
                <div className="timing-stack">
                  <p>
                    总耗时：<strong>{(translationTiming.totalMs / 1000).toFixed(1)} 秒</strong>
                    {translationTiming.sourceBuildMs !== undefined
                      ? ` · 抽取整理 ${(translationTiming.sourceBuildMs / 1000).toFixed(1)} 秒`
                      : ''}
                    {translationTiming.renderPrepMs !== undefined
                      ? ` · 结果整理 ${(translationTiming.renderPrepMs / 1000).toFixed(1)} 秒`
                      : ''}
                  </p>
                  <ul className="timing-list">
                    {translationTiming.stages.map((stage) => (
                      <li key={stage.id} className="timing-item">
                        <strong>{stage.label}</strong>
                        <span>
                          {(stage.durationMs / 1000).toFixed(1)} 秒
                          {stage.chunkCount ? ` · ${stage.chunkCount} 个分块` : ''}
                          {stage.provider ? ` · ${stage.provider}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>翻译完成后，这里会展示抽取、分段翻译和结果整理耗时。</p>
              )}
            </div>

            <div className="answer-card translation-preview-card">
              <h3>页面内结果预览</h3>
              {translationHtml ? (
                <div
                  className="rich-text-output translation-preview"
                  dangerouslySetInnerHTML={{ __html: translationHtml }}
                />
              ) : (
                <p>翻译完成后，这里会优先展示双语结果预览。</p>
              )}
            </div>

            {feedbackContext ? <FeedbackCapture context={feedbackContext} /> : null}

	            <div className="answer-card">
	              <h3>待确认项</h3>
	              <ul className="confirmation-list">
	                {(reply?.pendingConfirmations ?? []).length > 0
	                  ? reply?.pendingConfirmations.map((item) => (
	                      <li key={item.id} className={`confirmation-item status-${item.status}`}>
	                        <div className="confirmation-header">
	                          <strong>{item.label}</strong>
	                          <span className={`tag ${item.status}`}>
	                            {getConfirmationStatusLabel(item.status)}
	                          </span>
	                        </div>
	                        <div className="confirmation-body">
	                          <span>
	                            责任人：{getRoleLabel(item.owner)} · 当前状态：
	                            {getConfirmationStatusLabel(item.status)}
	                          </span>
	                          <span className="reason">{item.reason}</span>
	                        </div>
	                        {canEditConfirmations && (
	                          <div className="confirmation-actions">
	                            <button
	                              type="button"
	                              className="secondary-button confirmation-button"
	                              onClick={() => updateConfirmationStatus(item.id, 'confirmed')}
	                              disabled={isPending || item.status === 'confirmed'}
	                            >
	                              标记已确认
	                            </button>
	                            <button
	                              type="button"
	                              className="secondary-button confirmation-button"
	                              onClick={() => updateConfirmationStatus(item.id, 'returned')}
	                              disabled={isPending || item.status === 'returned'}
	                            >
	                              标记退回
	                            </button>
	                          </div>
	                        )}
                      </li>
                    ))
                  : [
                      <li key="placeholder" className="placeholder-item">
                        价格、交期、认证、付款、物流等高风险内容会显示在这里。
                      </li>
                    ]}
              </ul>
            </div>

            <div className="answer-card">
              <h3>执行情况</h3>
              <p>
                {reply?.draftDirection ??
                  '后续这里会根据任务类型输出翻译结果、待确认项和后续动作。'}
              </p>
              <ul>
                {(reply?.executionPlan ?? []).length > 0
                  ? reply?.executionPlan.map((step) => (
                      <li key={step.id}>
                        {step.name} · {step.status === 'completed' ? '已生成' : '已阻断'} ·{' '}
                        {step.summary}
                      </li>
                    ))
                  : ['执行后这里会展示当前阶段和每一步处理状态。'].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
              </ul>
            </div>

            <details className="answer-card details-card">
              <summary>结构化结果</summary>
              <div className="artifact-stack">
                {(reply?.artifacts ?? []).length > 0
                  ? reply?.artifacts.map((section) => (
                      <details className="artifact-section artifact-section-collapsible" key={section.title}>
                        <summary>
                          <span>{section.title}</span>
                          <span className="artifact-summary">{section.summary}</span>
                        </summary>
                        <ul>
                          {section.fields.map((field) => (
                            <li key={`${section.title}-${field.label}`}>
                              <span className="artifact-field-label">{field.label}：</span>
                              {field.richTextHtml ? (
                                <div
                                  className="rich-text-output"
                                  dangerouslySetInnerHTML={{ __html: field.richTextHtml }}
                                />
                              ) : (
                                <span>
                                  {field.value}
                                  {field.confirmationStatus
                                    ? `（${field.confirmationStatus === 'required' ? '待确认' : '建议确认'}）`
                                    : ''}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))
                  : [
                      <p key="empty-artifacts">
                        执行后这里会分模块展示结构化产物，而不是只给一段长文本。
                      </p>
                    ]}
              </div>
            </details>

                    {reply?.status === 'exported' && reply.finalArtifact && (
                    <div className="answer-card export-card">
                    <div className="export-card-header">
                      <h3>最终产物已生成</h3>
                      <span className="tag export-card-tag">已导出</span>
                    </div>
                    <p className="meta-note export-card-note">
                      当前结果已写入正式产物，可以复制到剪贴板或作为后续导出依据。
                    </p>
                    <pre className="export-card-code">
                    {reply.finalArtifact}
                    </pre>
                    <button
                    className="primary-button export-card-button"
                    onClick={() => navigator.clipboard.writeText(reply.finalArtifact!)}
                    >
                    复制到剪贴板
                    </button>
                    </div>
                    )}

                    <details className="answer-card details-card">
                      <summary>审核历史</summary>
	              <ul className="review-history-list">
	                {reviewHistory.length > 0
	                  ? reviewHistory.map((item, index) => (
	                      <li className="review-item" key={`${item.createdAt}-${index}`}>
	                        <div className="review-item-header">
	                          <strong>{getReviewDecisionLabel(item.decision)}</strong>
	                          <span>{dateTimeFormatter.format(new Date(item.createdAt))}</span>
	                        </div>
	                        <p>
	                          审核人：{getRoleLabel(item.reviewer)}
	                          {item.comment ? ` · ${item.comment}` : ''}
	                        </p>
	                      </li>
	                    ))
	                  : [
	                      <li className="placeholder-item" key="review-placeholder">
	                        当前任务还没有审核记录。
	                      </li>
	                    ]}
	              </ul>
	            </details>

	            <details className="answer-card details-card">
                <summary>审计摘要</summary>
	              <ul className="audit-list">
	                {(reply?.auditTrail ?? []).length > 0
	                  ? reply?.auditTrail.map((item) => (
	                      <li className="audit-item" key={`${item.label}-${item.detail}`}>
	                        <strong>{item.label}</strong>
	                        <span>{item.detail}</span>
	                      </li>
	                    ))
	                  : [
                      '执行后这里会记录关键操作和状态变化。'
                    ].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>

            <div className="answer-card">
              <h3>任务动作</h3>
              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    isPending ||
                    !currentTask ||
                    role !== 'sales' ||
                    !['pending_user_confirmation', 'returned'].includes(reply?.status ?? '')
                  }
                  onClick={submitForReview}
                >
                  提交主管审核
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    isPending ||
                    !currentTask ||
                    role !== 'supervisor' ||
                    reply?.status !== 'pending_supervisor_review'
                  }
                  onClick={() => reviewCurrentTask('approved')}
                >
                  主管通过
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    isPending ||
                    !currentTask ||
                    role !== 'supervisor' ||
                    reply?.status !== 'pending_supervisor_review'
                  }
                  onClick={() => reviewCurrentTask('returned')}
                >
                  主管退回
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isPending || !currentTask || reply?.status !== 'approved'}
                  onClick={exportCurrentTask}
                >
                  导出任务
                </button>
              </div>
            </div>

            <details className="answer-card details-card">
              <summary>审核队列摘要</summary>
              <ul>
                {pendingReviewTasks.length > 0
                  ? pendingReviewTasks.slice(0, 5).map((task) => (
                      <li className="task-item" key={`review-${task.id}`}>
                        <span>
                          {task.title} · {task.taskTypeLabel} · 待确认
                          {task.pendingConfirmationCount} 项
                        </span>
                        <button
                          className="tertiary-button"
                          type="button"
                          disabled={isPending}
                          onClick={() => openTask(task.id)}
                        >
                          审核
                        </button>
                      </li>
                    ))
                  : [
                      role === 'supervisor'
                        ? '当前没有待审核任务。'
                        : '切换到主管角色后可查看待审核任务。'
                    ].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>

            <details className="answer-card details-card">
              <summary>最近任务</summary>
              <div className="recent-task-toolbar">
                <button
                  className="tertiary-button"
                  type="button"
                  disabled={isPending}
                  onClick={startNewTranslationTask}
                >
                  新建翻译任务
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isPending || selectedRecentTaskIds.length === 0}
                  onClick={bulkDeleteTasks}
                >
                  批量删除
                </button>
              </div>
              <ul>
                {visibleRecentTasks.length > 0
                  ? visibleRecentTasks.map((task) => (
                      <li className="task-item" key={task.id}>
                        <label className="task-item-select">
                          <input
                            type="checkbox"
                            checked={selectedRecentTaskIds.includes(task.id)}
                            onChange={() => toggleRecentTaskSelection(task.id)}
                          />
                        </label>
                        <span>
                          {task.title} · {task.taskTypeLabel} · {task.status} · 待确认
                          {task.pendingConfirmationCount} 项
                        </span>
                        <div className="task-item-actions">
                          <button
                            className="tertiary-button"
                            type="button"
                            disabled={isPending}
                            onClick={() => openTask(task.id)}
                          >
                            打开
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={isPending}
                            onClick={() => deleteSingleTask(task.id)}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    ))
                  : [
                      '执行一次任务后，这里会保留最近任务。'
                    ].map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>
          </div>
        </div>
      </section>
    </main>
  );
}
