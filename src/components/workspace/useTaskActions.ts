"use client";

import { useDeferredValue, useState, useTransition, useEffect } from "react";
import {
  workflowTemplates,
  quickPrompts,
} from "@/lib/assistant/catalog";
import type {
  AssistantReply,
  AssistantRole,
  PendingConfirmation,
  SkillDefinition,
  TaskRecord,
  TaskType,
  WorkflowTemplate,
} from "@/lib/assistant/types";

export function useTaskActions() {
  const defaultTemplate = workflowTemplates.find(
    (template) => template.taskType === "reply",
  );

  const [role, setRole] = useState<AssistantRole>("sales");
  const [taskType, setTaskType] = useState<TaskType>("reply");
  const [question, setQuestion] = useState(quickPrompts[2]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    defaultTemplate?.id ?? null,
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    defaultTemplate?.steps ?? ["comment-translator", "customer-reply-drafter"],
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
    const response = await fetch("/api/tasks", {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error("任务列表加载失败。");
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

  function applyTemplate(template: WorkflowTemplate) {
    setTaskType(template.taskType);
    setSelectedTemplateId(template.id);
    setSelectedSkillIds(template.steps);
    const promptIndex =
      template.taskType === "bom"
        ? 0
        : template.taskType === "feedback"
          ? 1
          : 2;
    setQuestion(quickPrompts[promptIndex]);
  }

  function toggleSkill(skill: SkillDefinition) {
    setSelectedTemplateId(null);
    setTaskType(skill.taskTypes[0]);
    setSelectedSkillIds((current) =>
      current.includes(skill.id)
        ? current.filter((skillId) => skillId !== skill.id)
        : [...current, skill.id],
    );
  }

  function submit() {
    setError(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("role", role);
        formData.append("taskType", taskType);
        formData.append("question", question);
        formData.append("selectedSkillIds", JSON.stringify(selectedSkillIds));

        if (selectedTemplateId) {
          formData.append("selectedTemplateId", selectedTemplateId);
        }

        for (const file of files) {
          formData.append("files", file);
        }

        const response = await fetch("/api/assistant", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "请求失败，请稍后再试。");
        }

        const parsed = data as AssistantReply;
        hydrateFromReply(parsed);
        setRecentTasks(parsed.recentTasks ?? []);
      } catch (submitError) {
        setReply(null);
        setError(
          submitError instanceof Error
            ? submitError.message
            : "请求失败，请稍后再试。",
        );
      }
    });
  }

  async function runTaskAction(endpoint: string, init?: RequestInit) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      ...init,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "任务操作失败。");
    }

    const nextReply = data.reply as AssistantReply;
    hydrateFromReply(nextReply);
    await refreshTasks();
  }

  function saveCurrentTask() {
    const currentTask = reply?.task;
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${currentTask.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role,
            taskType,
            question,
            selectedSkillIds,
            selectedTemplateId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "保存任务失败。");
        }

        const nextReply = data.reply as AssistantReply;
        hydrateFromReply(nextReply);
        await refreshTasks();
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "保存任务失败。",
        );
      }
    });
  }

  function openTask(taskId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "GET",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "任务详情加载失败。");
        }

        hydrateFromReply(data.reply as AssistantReply);
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "任务详情加载失败。",
        );
      }
    });
  }

  function submitForReview() {
    const currentTask = reply?.task;
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/submit`);
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "提交审核失败。",
        );
      }
    });
  }

  function reviewCurrentTask(decision: "approved" | "returned") {
    const currentTask = reply?.task;
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
              decision === "returned"
                ? "当前示例为主管退回，请业务员继续处理待确认项。"
                : "当前示例为主管审核通过。",
          }),
        });
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "审核失败。",
        );
      }
    });
  }

  function exportCurrentTask() {
    const currentTask = reply?.task;
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(`/api/tasks/${currentTask.id}/export`);
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "导出失败。",
        );
      }
    });
  }

  function updateConfirmationStatus(
    confirmationId: string,
    status: PendingConfirmation["status"],
  ) {
    const currentTask = reply?.task;
    if (!currentTask) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await runTaskAction(
          `/api/tasks/${currentTask.id}/confirmations/${confirmationId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status }),
          },
        );
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "更新待确认项失败。",
        );
      }
    });
  }

  return {
    role,
    setRole,
    taskType,
    setTaskType,
    question,
    setQuestion,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedSkillIds,
    setSelectedSkillIds,
    files,
    onFileChange,
    reply,
    activeTaskId,
    recentTasks,
    error,
    setError,
    isPending,
    deferredQuestion,
    applyTemplate,
    toggleSkill,
    submit,
    saveCurrentTask,
    openTask,
    submitForReview,
    reviewCurrentTask,
    exportCurrentTask,
    updateConfirmationStatus,
    refreshTasks,
  };
}
