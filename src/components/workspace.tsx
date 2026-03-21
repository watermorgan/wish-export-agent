'use client';

import { useDeferredValue, useEffect, useState, useTransition } from 'react';
import { workflowTemplates } from '@/lib/assistant/catalog';
import type {
  AssistantReply,
  AssistantRole,
  PendingConfirmation,
  TaskRecord,
  TaskType
} from '@/lib/assistant/types';
import { WorkspaceLayout, TaskInitiation, TaskResults, TaskHistory } from './workspace/index';

const quickPrompts = [
  '请整理工艺单附件，输出结构化 BOM，并列出缺失字段。',
  '请保留英文原文，在每段下方增加中文翻译，仅做翻译，不做归并。',
  '请基于客户邮件和附件，生成英文回复草稿，并把高风险承诺单独列出。'
];

export function Workspace() {
  const defaultTemplate = workflowTemplates.find(
    (template) => template.taskType === 'reply'
  );

  const [role, setRole] = useState<AssistantRole>('sales');
  const [taskType, setTaskType] = useState<TaskType>('reply');
  const [question, setQuestion] = useState(quickPrompts[2]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    defaultTemplate?.id ?? null
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    defaultTemplate?.steps ?? ['comment-translator', 'customer-reply-drafter']
  );
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    setSelectedSkillIds(nextReply.selectedSkills.map((skill) => skill.id));
    setFiles([]);
  }

  async function refreshTasks() {
    const response = await fetch('/api/tasks');
    if (!response.ok) throw new Error('任务列表加载失败。');
    const data = (await response.json()) as { tasks: TaskRecord[] };
    setRecentTasks(data.tasks);
  }

  useEffect(() => {
    refreshTasks().catch(() => {});
  }, []);

  function onTaskTypeChange(type: TaskType) {
    setTaskType(type);
    const template = workflowTemplates.find(t => t.taskType === type);
    if (template) {
      setSelectedTemplateId(template.id);
      setSelectedSkillIds(template.steps);
    }
    const promptIndex = type === 'bom' ? 0 : type === 'feedback' ? 1 : 2;
    setQuestion(quickPrompts[promptIndex]);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('role', role);
        formData.append('taskType', taskType);
        formData.append('question', deferredQuestion);
        formData.append('selectedSkillIds', JSON.stringify(selectedSkillIds));
        if (selectedTemplateId) formData.append('selectedTemplateId', selectedTemplateId);
        for (const file of files) formData.append('files', file);

        const response = await fetch('/api/assistant', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '请求失败，请稍后再试。');
        
        const parsed = data as AssistantReply;
        hydrateFromReply(parsed);
        await refreshTasks();
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      }
    });
  }

  async function runTaskAction(endpoint: string, init?: RequestInit) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...init
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '任务操作失败。');
    hydrateFromReply(data.reply as AssistantReply);
    await refreshTasks();
  }

  function submitForReview() {
    if (!activeTaskId) return;
    setError(null);
    startTransition(async () => {
      try { await runTaskAction(`/api/tasks/${activeTaskId}/submit`); }
      catch (err) { setError(err instanceof Error ? err.message : '提交审核失败。'); }
    });
  }

  function reviewCurrentTask(decision: 'approved' | 'returned') {
    if (!activeTaskId) return;
    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${activeTaskId}/review`, {
          body: JSON.stringify({
            decision,
            reviewer: role,
            comment: decision === 'returned' ? '请业务员继续处理待确认项。' : '审核通过。'
          })
        });
      } catch (err) { setError(err instanceof Error ? err.message : '审核失败。'); }
    });
  }

  function exportCurrentTask() {
    if (!activeTaskId) return;
    setError(null);
    startTransition(async () => {
      try { await runTaskAction(`/api/tasks/${activeTaskId}/export`); }
      catch (err) { setError(err instanceof Error ? err.message : '导出失败。'); }
    });
  }

  function updateConfirmationStatus(id: string, status: PendingConfirmation['status']) {
    if (!activeTaskId) return;
    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${activeTaskId}/confirmations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        });
      } catch (err) { setError(err instanceof Error ? err.message : '更新失败。'); }
    });
  }

  const getRoleLabel = (r: AssistantRole) => r === 'sales' ? '业务员' : '主管';

  const visibleRecentTasks = role === 'supervisor'
    ? recentTasks
    : recentTasks.filter((task) => task.role === role);

  const canEditConfirmations = ['pending_user_confirmation', 'returned'].includes(
    reply?.task?.status ?? ''
  );

  return (
    <WorkspaceLayout role={role} onRoleChange={setRole}>
      {error && (
        <div className="lg:col-span-12 bg-red-50 text-red-600 p-4 rounded-xl border border-red-200">
          ⚠️ {error}
        </div>
      )}
      
      <TaskInitiation
        taskType={taskType}
        onTaskTypeChange={onTaskTypeChange}
        question={question}
        onQuestionChange={setQuestion}
        files={files}
        onFileChange={onFileChange}
        onSubmit={submit}
        isPending={isPending}
      />
      
      {reply ? (
        <TaskResults
          reply={reply}
          currentTask={reply.task ?? null}
          role={role}
          isPending={isPending}
          canEditConfirmations={canEditConfirmations}
          onUpdateConfirmationStatus={updateConfirmationStatus}
          onSubmitForReview={submitForReview}
          onReviewCurrentTask={reviewCurrentTask}
          onExportCurrentTask={exportCurrentTask}
          getRoleLabel={getRoleLabel}
        />
      ) : (
        <aside className="lg:col-span-5 space-y-10">
          <TaskHistory tasks={visibleRecentTasks} role={role} />
          
          <div className="relative overflow-hidden h-44 rounded-3xl bg-gradient-to-br from-indigo-400 to-indigo-600 p-8 flex items-end shadow-xl shadow-indigo-400/20">
            <div className="relative z-10">
              <p className="text-white font-black text-2xl leading-tight">Create with <br/> Confidence.</p>
              <p className="text-white/60 text-xs font-bold mt-2 uppercase tracking-widest">Workspace v1.0 ✨</p>
            </div>
            <span className="absolute -right-6 -top-6 text-9xl opacity-10 rotate-12">🚀</span>
          </div>
        </aside>
      )}
    </WorkspaceLayout>
  );
}