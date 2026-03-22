"use client";

import React from "react";
import type {
  AssistantRole,
  TaskRecord,
} from "@/lib/assistant/types";

interface TaskHistoryProps {
  recentTasks: TaskRecord[];
  pendingReviewTasks: TaskRecord[];
  role: AssistantRole;
  openTask: (id: string) => void;
  isPending: boolean;
}

export function TaskHistory({
  recentTasks,
  pendingReviewTasks,
  role,
  openTask,
  isPending,
}: TaskHistoryProps) {
  const visibleRecentTasks =
    role === "supervisor"
      ? recentTasks
      : recentTasks.filter((task) => task.role === role);

  const visiblePendingTasks =
    role === "supervisor"
      ? pendingReviewTasks
      : pendingReviewTasks.filter((task) => task.role === role);

  return (
    <div className="space-y-10">
      {/* Review Queue (only for supervisors or showing count) */}
      <div>
        <div className="flex items-center gap-3 px-2 mb-6">
          <span className="text-xl">📝</span>
          <h3 className="font-bold text-on-surface">
            审核队列 (Audit Queue)
          </h3>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft border border-outline divide-y divide-outline overflow-hidden">
          {visiblePendingTasks.length > 0 ? (
            visiblePendingTasks.slice(0, 5).map((task) => (
              <div
                key={`review-${task.id}`}
                className="p-6 bg-risk-soft/40 hover:bg-risk-soft/70 transition-all group flex items-center justify-between border-b border-risk-soft last:border-0"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-risk-coral shadow-[0_0_8px_rgba(201,95,45,0.4)]" />
                    <p className="text-sm font-black text-on-surface group-hover:text-risk-coral transition-colors truncate">
                      {task.title}
                    </p>
                  </div>
                  <p className="text-[10px] text-muted font-bold uppercase tracking-wider ml-3.5">
                    {task.taskTypeLabel} · 待确认 {task.pendingConfirmationCount} 项
                  </p>
                </div>
                <button
                  onClick={() => openTask(task.id)}
                  disabled={isPending}
                  className="bg-risk-coral text-white px-5 py-2 rounded-xl text-xs font-black shadow-lg shadow-risk-coral/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                >
                  审核
                </button>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-muted text-sm">
              {role === "supervisor"
                ? "当前没有待审核任务。"
                : "切换到主管角色后可查看待审核任务。"}
            </div>
          )}
        </div>
      </div>

      {/* Recent Tasks */}
      <div>
        <div className="flex items-center gap-3 px-2 mb-6">
          <span className="text-xl">📚</span>
          <h3 className="font-bold text-on-surface">
            最近任务 (Recent Tasks)
          </h3>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft border border-outline divide-y divide-outline overflow-hidden">
          {visibleRecentTasks.length > 0 ? (
            visibleRecentTasks.slice(0, 10).map((task) => (
              <div
                key={task.id}
                className="p-6 bg-surface hover-float transition-all group flex items-center justify-between border-b border-outline/5 last:border-0"
              >
                <div className="space-y-1">
                  <p className="text-sm font-black text-on-surface group-hover:text-primary transition-colors truncate">
                    {task.title}
                  </p>
                  <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                    {task.taskTypeLabel} · {task.status} · 待确认 {task.pendingConfirmationCount} 项
                  </p>
                </div>
                <button
                  onClick={() => openTask(task.id)}
                  disabled={isPending}
                  className="bg-accent-soft text-primary px-4 py-2 rounded-xl text-xs font-black hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                >
                  打开
                </button>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-muted text-sm">
              执行一次任务后，这里会保留最近任务。
            </div>
          )}
        </div>
        <button
          className="w-full mt-6 py-4 border-2 border-dashed border-outline rounded-2xl text-muted text-sm font-black hover:bg-surface hover:border-primary/20 hover:text-primary transition-all"
        >
          View All History 📖
        </button>
      </div>
    </div>
  );
}
